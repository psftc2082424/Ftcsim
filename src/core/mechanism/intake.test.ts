/**
 * Intake geometry and roller force.
 *
 * The intake has no capture probability and no acquisition timer, so what is
 * asserted here is the two things it actually has: a mouth a piece is either
 * inside or not, and a force derived the way the drivetrain derives wheel force
 * — torque over the radius it acts at, driving toward a surface speed.
 */

import { describe, expect, it } from 'vitest';
import {
  ROLLER_TRANSFER_RATIO,
  deriveIntake,
  drawDirection,
  ejectionPointM,
  hopperSlotM,
  intakeAccepts,
  intakeOf,
  maxRollerForceN,
  mouthContains,
  rollerForceN,
  surfaceSpeedMps,
  toMouthFrame,
  type IntakeSpec,
} from './intake.js';
import { deriveMechanism, type MechanismConfig } from './mechanism.js';
import { getMechanismPreset, instantiateMechanism } from './presets.js';
import { inchesToMeters, poundsToKilograms } from '../units/convert.js';
import { vec2 } from '../math/vec2.js';
import type { AcquireCapability } from './capability.js';

const DT = 1 / 200;
const BALL_KG = poundsToKilograms(0.165);

const ACQUIRE: AcquireCapability = {
  kind: 'acquire',
  pieceTypes: [],
  capacity: 3,
  reachIn: 6,
  mouthWidthIn: 14,
  rollerDiameterIn: 2,
};

function intakeMechanism(patch: Partial<MechanismConfig> = {}): MechanismConfig {
  return {
    id: 'intake',
    name: 'Intake',
    preset: 'intake',
    massLb: 4,
    mount: { xIn: 8, yIn: 0, facingDeg: 0 },
    actuation: { motorId: 'gobilda-5203-435', motorCount: 1, gearRatio: 1, efficiency: 0.9 },
    capabilities: [ACQUIRE],
    ...patch,
  };
}

const specFor = (
  capability: Partial<AcquireCapability> = {},
  mechanism: Partial<MechanismConfig> = {},
): IntakeSpec => deriveIntake(deriveMechanism(intakeMechanism(mechanism)), { ...ACQUIRE, ...capability });

describe('deriving an intake', () => {
  it('takes speed and torque from the motor behind it', () => {
    const spec = specFor();
    const derived = deriveMechanism(intakeMechanism());

    expect(spec.rollerRadPerSec).toBeCloseTo(((derived.outputRpm ?? 0) * Math.PI * 2) / 60, 12);
    expect(spec.rollerTorqueNm).toBe(derived.outputTorqueNm);
    expect(spec.rollerRadiusM).toBeCloseTo(inchesToMeters(1), 12);
  });

  /**
   * Gearing an intake down trades surface speed for grip. Both come off the one
   * derivation, so they cannot drift apart.
   */
  it('slows the roller and strengthens it when geared down', () => {
    const direct = specFor({}, { actuation: { motorId: 'gobilda-5203-435', motorCount: 1, gearRatio: 1, efficiency: 0.9 } });
    const geared = specFor({}, { actuation: { motorId: 'gobilda-5203-435', motorCount: 1, gearRatio: 3, efficiency: 0.9 } });

    expect(geared.rollerRadPerSec).toBeCloseTo(direct.rollerRadPerSec / 3, 9);
    expect(maxRollerForceN(geared)).toBeCloseTo(maxRollerForceN(direct) * 3, 9);
  });

  it('is a wheel with no motor when the mechanism is passive', () => {
    const { actuation: _drop, ...passive } = intakeMechanism();
    const spec = deriveIntake(deriveMechanism(passive), ACQUIRE);

    expect(spec.rollerRadPerSec).toBe(0);
    expect(surfaceSpeedMps(spec, 'intake')).toBe(0);
  });

  it('finds the acquire capability on whichever mechanism carries it', () => {
    const shooter = deriveMechanism(instantiateMechanism(getMechanismPreset('shooter'), 's'));
    const intake = deriveMechanism(intakeMechanism());

    expect(intakeOf([shooter, intake])?.capability.kind).toBe('acquire');
    expect(intakeOf([shooter])).toBeUndefined();
  });

  it('accepts every piece type when it names none', () => {
    expect(intakeAccepts(specFor(), 'P')).toBe(true);
    expect(intakeAccepts(specFor({ pieceTypes: ['G'] }), 'P')).toBe(false);
    expect(intakeAccepts(specFor({ pieceTypes: ['G'] }), 'G')).toBe(true);
  });
});

describe('the mouth', () => {
  const spec = specFor();

  it('runs from the mount outward along its facing', () => {
    // 8 in mount, 6 in reach: 8 to 14 in ahead of centre.
    expect(mouthContains(spec, vec2(inchesToMeters(9), 0))).toBe(true);
    expect(mouthContains(spec, vec2(inchesToMeters(13.9), 0))).toBe(true);
    expect(mouthContains(spec, vec2(inchesToMeters(14.5), 0))).toBe(false);
    expect(mouthContains(spec, vec2(inchesToMeters(7), 0))).toBe(false);
  });

  it('is bounded across by the mouth width', () => {
    expect(mouthContains(spec, vec2(inchesToMeters(10), inchesToMeters(6.9)))).toBe(true);
    expect(mouthContains(spec, vec2(inchesToMeters(10), inchesToMeters(7.5)))).toBe(false);
  });

  /** A side-mounted intake needs no special case: the frame rotates with it. */
  it('follows the mount facing rather than robot-forward', () => {
    const side = specFor({}, { mount: { xIn: 0, yIn: 8, facingDeg: 90 } });

    expect(mouthContains(side, vec2(0, inchesToMeters(11)))).toBe(true);
    expect(mouthContains(side, vec2(inchesToMeters(11), 0))).toBe(false);
  });

  it('measures depth along the facing and offset across it', () => {
    const local = toMouthFrame(spec, vec2(inchesToMeters(11), inchesToMeters(2)));
    expect(local.x).toBeCloseTo(inchesToMeters(3), 12);
    expect(local.y).toBeCloseTo(inchesToMeters(2), 12);
  });

  it('draws inward, opposite the facing', () => {
    expect(drawDirection(specFor())).toEqual(vec2(-1, -0));
    const rear = specFor({}, { mount: { xIn: -8, yIn: 0, facingDeg: 180 } });
    expect(drawDirection(rear).x).toBeCloseTo(1, 12);
  });
});

describe('the roller force', () => {
  const spec = specFor();

  it('drives the piece at half the surface speed, the pinch geometry', () => {
    expect(ROLLER_TRANSFER_RATIO).toBe(0.5);
    expect(surfaceSpeedMps(spec, 'intake')).toBeCloseTo(
      spec.rollerRadPerSec * spec.rollerRadiusM,
      12,
    );
    expect(surfaceSpeedMps(spec, 'outtake')).toBeCloseTo(-surfaceSpeedMps(spec, 'intake'), 12);
    expect(surfaceSpeedMps(spec, 'off')).toBe(0);
  });

  it('pushes inward when intaking and outward when outtaking', () => {
    const inward = rollerForceN(spec, 'intake', BALL_KG, vec2(0, 0), DT);
    const outward = rollerForceN(spec, 'outtake', BALL_KG, vec2(0, 0), DT);

    expect(inward.x).toBeLessThan(0);
    expect(outward.x).toBeGreaterThan(0);
  });

  it('does nothing at all with the roller off', () => {
    expect(rollerForceN(spec, 'off', BALL_KG, vec2(0, 0), DT)).toEqual(vec2(0, 0));
  });

  it('never exceeds torque over radius', () => {
    const limit = maxRollerForceN(spec);
    // A piece far below surface speed demands far more than the roller has.
    const force = rollerForceN(spec, 'intake', 1000, vec2(0, 0), DT);

    expect(Math.hypot(force.x, force.y)).toBeLessThanOrEqual(limit + 1e-9);
  });

  it('stops pushing a piece already moving at the drive speed', () => {
    const target = surfaceSpeedMps(spec, 'intake') * ROLLER_TRANSFER_RATIO;
    const atSpeed = rollerForceN(spec, 'intake', BALL_KG, vec2(-target, 0), DT);

    expect(Math.hypot(atSpeed.x, atSpeed.y)).toBeCloseTo(0, 9);
  });

  it('does not drag back a piece already leaving faster than the roller', () => {
    const target = surfaceSpeedMps(spec, 'intake') * ROLLER_TRANSFER_RATIO;
    const faster = rollerForceN(spec, 'intake', BALL_KG, vec2(-target * 2, 0), DT);

    expect(Math.abs(faster.x)).toBe(0);
    expect(Math.abs(faster.y)).toBe(0);
  });

  /**
   * A slower roller genuinely collects more slowly: the same ball is driven to a
   * lower speed, so it takes longer to cross the mouth. This is why intake speed
   * is not a cosmetic slider.
   */
  it('drives a piece to a speed set by the gearing', () => {
    const fast = specFor({}, { actuation: { motorId: 'gobilda-5203-435', motorCount: 1, gearRatio: 1, efficiency: 0.9 } });
    const slow = specFor({}, { actuation: { motorId: 'gobilda-5203-435', motorCount: 1, gearRatio: 4, efficiency: 0.9 } });

    const settle = (candidate: IntakeSpec): number => {
      let along = 0;
      for (let i = 0; i < 200; i++) {
        const force = rollerForceN(candidate, 'intake', BALL_KG, vec2(-along, 0), DT);
        along += (-force.x / BALL_KG) * DT;
      }
      return along;
    };

    expect(settle(fast)).toBeCloseTo(
      surfaceSpeedMps(fast, 'intake') * ROLLER_TRANSFER_RATIO,
      6,
    );
    expect(settle(slow)).toBeLessThan(settle(fast) / 3);
  });
});

describe('the hopper', () => {
  const spec = specFor();
  const diameter = inchesToMeters(4.9);

  it('queues pieces back from the mount, a diameter apart', () => {
    const first = hopperSlotM(spec, 0, diameter);
    const second = hopperSlotM(spec, 1, diameter);

    expect(second.x - first.x).toBeCloseTo(-diameter, 12);
    expect(first.x).toBeLessThan(spec.mountM.x);
  });

  it('puts an ejected piece outside the mouth, not inside the robot', () => {
    const point = ejectionPointM(spec, diameter / 2);
    expect(point.x).toBeGreaterThan(spec.mountM.x);
  });
});
