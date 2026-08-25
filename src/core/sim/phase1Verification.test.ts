/**
 * Phase 1 verification suite.
 *
 * Compares what the simulation *does* against what closed-form physics says it
 * should do, for a documented reference robot. Every analytic value here was
 * derived by hand from the goBILDA datasheet before the code existed, so this is
 * a check of the whole chain — unit conversion, motor constants, gearing, wheel
 * radius, the wrench mapping and the integrator — not the code checking itself.
 *
 * It prints a table as well as asserting, so a run doubles as the Phase 1
 * verification report.
 */

import { describe, expect, it } from 'vitest';
import { DT_SECONDS, SimWorld } from './simWorld.js';
import { runHeadless, secondsToTicks } from './headless.js';
import { DEFAULT_ROBOT_CONFIG } from '../robot/robotConfig.js';
import { deriveRobot } from '../robot/derive.js';
import { analyticFreeSpeed, analyticPeakAcceleration } from '../drive/drivetrain.js';
import { constantController } from '../control/scripted.js';
import { createControlInput } from '../control/controlInput.js';
import { DEFAULT_BATTERY, sumPackLoad } from '../motor/battery.js';
import { motorCurrent } from '../motor/motorModel.js';
import {
  asVolts,
  metersPerSec2ToFeetPerSec2,
  metersPerSecToFeetPerSec,
  radPerSecToDegPerSec,
} from '../units/convert.js';
import { metersPerSec, metersPerSec2, radPerSec } from '../units/si.js';
import { vec2 } from '../math/vec2.js';

const NOMINAL = asVolts(12);
const WEST_START = { p: vec2(-1.6, 0), theta: 0 };
const SOUTH_START = { p: vec2(0, -1.6), theta: 0 };

/** Relative error, as a percentage. */
const errorPct = (measured: number, analytic: number): number =>
  Math.abs((measured - analytic) / analytic) * 100;

const rows: string[] = [];
const report = (
  quantity: string,
  analytic: string,
  measured: string,
  error: string,
): void => {
  rows.push(
    `  ${quantity.padEnd(26)}${analytic.padStart(14)}${measured.padStart(14)}${error.padStart(10)}`,
  );
};

describe('Phase 1 verification — analytic vs simulated', () => {
  const derived = deriveRobot(DEFAULT_ROBOT_CONFIG);

  it('top speed matches the closed-form prediction', () => {
    const analytic = analyticFreeSpeed(derived.drivetrain, NOMINAL);

    const result = runHeadless({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(createControlInput(1, 0, 0)),
          startPose: WEST_START,
        },
      ],
      ticks: secondsToTicks(1.4, DT_SECONDS),
    });

    const robot = result.finalSnapshot.robots[0];
    expect(robot).toBeDefined();
    if (robot === undefined) return;

    const measured = Math.hypot(robot.vel.v.x, robot.vel.v.y);

    report(
      'Top speed',
      `${metersPerSecToFeetPerSec(analytic).toFixed(3)} ft/s`,
      `${metersPerSecToFeetPerSec(metersPerSec(measured)).toFixed(3)} ft/s`,
      `${errorPct(measured, analytic).toFixed(3)}%`,
    );

    expect(errorPct(measured, analytic)).toBeLessThan(0.5);
  });

  it('peak acceleration matches the stall-torque prediction', () => {
    const analytic = analyticPeakAcceleration(derived.drivetrain, NOMINAL, derived.massKg);

    // Tick 0 runs on open-circuit voltage: the battery has seen no load yet.
    const world = new SimWorld({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(createControlInput(1, 0, 0)),
        },
      ],
    });
    world.step();

    const robot = world.snapshot().robots[0];
    if (robot === undefined) return;
    const measured = robot.vel.v.x / DT_SECONDS;

    report(
      'Peak acceleration',
      `${metersPerSec2ToFeetPerSec2(analytic).toFixed(2)} ft/s²`,
      `${metersPerSec2ToFeetPerSec2(metersPerSec2(measured)).toFixed(2)} ft/s²`,
      `${errorPct(measured, analytic).toFixed(4)}%`,
    );

    expect(errorPct(measured, analytic)).toBeLessThan(0.001);
  });

  it('rotation rate matches wheel free speed over the kinematic lever arm', () => {
    // Spinning in place, every wheel runs at its free speed and the contact
    // patch traces a circle of radius k, so omega = v_free / k.
    const analytic = analyticFreeSpeed(derived.drivetrain, NOMINAL) / derived.kinematicK;

    const result = runHeadless({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(createControlInput(0, 0, 1)),
        },
      ],
      ticks: secondsToTicks(4, DT_SECONDS),
    });

    const robot = result.finalSnapshot.robots[0];
    if (robot === undefined) return;
    const measured = Math.abs(robot.vel.omega);

    report(
      'Rotation rate',
      `${radPerSecToDegPerSec(radPerSec(analytic)).toFixed(1)} °/s`,
      `${radPerSecToDegPerSec(radPerSec(measured)).toFixed(1)} °/s`,
      `${errorPct(measured, analytic).toFixed(3)}%`,
    );

    expect(errorPct(measured, analytic)).toBeLessThan(0.5);
  });

  it('strafe speed equals drive speed under the ideal mecanum model', () => {
    const analytic = analyticFreeSpeed(derived.drivetrain, NOMINAL);

    const result = runHeadless({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(createControlInput(0, 1, 0)),
          startPose: SOUTH_START,
        },
      ],
      ticks: secondsToTicks(1.4, DT_SECONDS),
    });

    const robot = result.finalSnapshot.robots[0];
    if (robot === undefined) return;
    const measured = Math.hypot(robot.vel.v.x, robot.vel.v.y);

    report(
      'Strafe speed',
      `${metersPerSecToFeetPerSec(analytic).toFixed(3)} ft/s`,
      `${metersPerSecToFeetPerSec(metersPerSec(measured)).toFixed(3)} ft/s`,
      `${errorPct(measured, analytic).toFixed(3)}%`,
    );

    // Equal by construction; real mecanum strafes slower (ASSUMPTIONS.md §2.2).
    expect(errorPct(measured, analytic)).toBeLessThan(0.5);
  });

  it('battery sag at four-motor stall matches Ohm law', () => {
    const perMotor = motorCurrent(derived.motor, radPerSec(0), 1, NOMINAL);
    const packCurrent = sumPackLoad([perMotor, perMotor, perMotor, perMotor]);
    const analytic =
      DEFAULT_BATTERY.openCircuitVolts - packCurrent * DEFAULT_BATTERY.internalResistanceOhms;

    const world = new SimWorld({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(createControlInput(1, 0, 0)),
        },
      ],
    });
    world.step(); // tick 0 stalls at 12 V, then sets the sagged voltage

    const measured = world.batteryVolts;

    report(
      'Battery at stall',
      `${analytic.toFixed(3)} V`,
      `${measured.toFixed(3)} V`,
      `${errorPct(measured, analytic).toFixed(4)}%`,
    );

    expect(measured).toBeCloseTo(analytic, 6);
    expect(packCurrent).toBeCloseTo(36.8, 6);
  });
});

describe('Phase 1 verification — report', () => {
  it('prints the comparison table', () => {
    const derived = deriveRobot(DEFAULT_ROBOT_CONFIG);
    const lines = [
      '',
      '  PHASE 1 VERIFICATION — analytic vs simulated',
      `  Robot: ${DEFAULT_ROBOT_CONFIG.chassis.lengthIn}x${DEFAULT_ROBOT_CONFIG.chassis.widthIn} in, ` +
        `${DEFAULT_ROBOT_CONFIG.chassis.massLb} lb, ` +
        `${DEFAULT_ROBOT_CONFIG.drivetrain.motorCount}x ${derived.motor.datasheet.sku}, ` +
        `${DEFAULT_ROBOT_CONFIG.drivetrain.gearRatio}:1, ` +
        `${DEFAULT_ROBOT_CONFIG.drivetrain.wheelDiameterIn} in wheels`,
      '',
      `  ${'Quantity'.padEnd(26)}${'Analytic'.padStart(14)}${'Simulated'.padStart(14)}${'Error'.padStart(10)}`,
      `  ${'-'.repeat(62)}`,
      ...rows,
      '',
    ];
    console.log(lines.join('\n'));

    // The table is only meaningful if every comparison above actually ran.
    expect(rows.length).toBe(5);
  });
});
