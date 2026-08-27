/**
 * Flywheel dynamics.
 *
 * Nothing in the shooter is a timing constant, so everything here is measured
 * against a closed form rather than against a remembered number. Driving a
 * rotating inertia with the k_t/k_e/R motor gives a first-order system:
 *
 *     J dw/dt = kT * G * eta * N * (duty*V - kE*G*w) / R
 *
 * whose steady state is `duty*V / (kE*G)` and whose time constant is
 * `J*R / (kT*kE*G^2*eta*N)`. Spin-up time is that constant; there is no
 * `spinUpTimeSec` anywhere to assert against.
 */

import { describe, expect, it } from 'vitest';
import {
  afterShot,
  deriveFlywheel,
  exitSpeedMps,
  flywheelDuty,
  freeWheelSpeed,
  launcherOf,
  requiredRadPerSec,
  shotEnergyJ,
  spinFraction,
  stepFlywheel,
  type FlywheelSpec,
} from './flywheel.js';
import { deriveMechanism, type MechanismConfig } from './mechanism.js';
import { getMechanismPreset, instantiateMechanism } from './presets.js';
import { volts } from '../units/si.js';
import { DT_SECONDS } from '../sim/simWorld.js';
import type { LaunchCapability } from './capability.js';

const NOMINAL = volts(12);

const LAUNCH: LaunchCapability = {
  kind: 'launch',
  pieceTypes: [],
  exitSpeedFtPerSec: 30,
  exitAngleDeg: 45,
  spreadDeg: 0,
  flywheelDiameterIn: 4,
  flywheelMassLb: 0.6,
  transferRatio: 0.5,
  shootOnMoveCompensation: 0,
};

function shooter(patch: Partial<MechanismConfig> = {}): MechanismConfig {
  return {
    id: 'shooter',
    name: 'Shooter',
    preset: 'shooter',
    massLb: 5,
    mount: { xIn: 4, yIn: 0, facingDeg: 0 },
    actuation: { motorId: 'gobilda-5203-6000', motorCount: 1, gearRatio: 1, efficiency: 0.92 },
    capabilities: [LAUNCH],
    ...patch,
  };
}

const specFor = (
  capability: Partial<LaunchCapability> = {},
  mechanism: Partial<MechanismConfig> = {},
): FlywheelSpec =>
  deriveFlywheel(deriveMechanism(shooter(mechanism)), { ...LAUNCH, ...capability });

/** Analytic first-order time constant for the driven wheel, seconds. */
function timeConstantSec(spec: FlywheelSpec): number {
  const { motor, gearRatio: g, efficiency, motorCount } = spec;
  if (motor === null) throw new Error('time constant needs a motor');
  return (
    (spec.inertiaKgM2 * motor.resistance) / (motor.kT * motor.kE * g * g * efficiency * motorCount)
  );
}

function spinFor(spec: FlywheelSpec, ticks: number): number {
  let state = { radPerSec: 0, running: true };
  for (let i = 0; i < ticks; i++) state = stepFlywheel(spec, state, DT_SECONDS, NOMINAL).state;
  return state.radPerSec;
}

describe('deriving a flywheel from a configured mechanism', () => {
  it('takes its inertia from the wheel as a solid disc', () => {
    const spec = specFor();
    const radiusM = 0.0254 * 2;
    const massKg = 0.6 * 0.45359237;

    expect(spec.radiusM).toBeCloseTo(radiusM, 12);
    expect(spec.inertiaKgM2).toBeCloseTo(0.5 * massKg * radiusM * radiusM, 15);
  });

  /** Target speed is the wheel speed the configured exit speed demands. */
  it('turns the target exit speed into a target wheel speed', () => {
    const spec = specFor();
    const targetMps = 30 * 0.3048;

    expect(spec.targetRadPerSec).toBeCloseTo(
      requiredRadPerSec(targetMps, spec.radiusM, spec.transferRatio),
      9,
    );
    expect(exitSpeedMps(spec, { radPerSec: spec.targetRadPerSec, running: true })).toBeCloseTo(
      targetMps,
      9,
    );
  });

  it('finds the launch capability on whichever mechanism carries it', () => {
    const intake = deriveMechanism(instantiateMechanism(getMechanismPreset('intake'), 'i'));
    const launch = deriveMechanism(shooter());

    expect(launcherOf([intake, launch])?.capability.kind).toBe('launch');
    expect(launcherOf([intake])).toBeUndefined();
  });

  /** A launch capability with no motor behind it is a wheel that never turns. */
  it('produces a spec with no motors for a passive mechanism', () => {
    const { actuation: _drop, ...passive } = shooter();
    const spec = deriveFlywheel(deriveMechanism(passive), LAUNCH);

    expect(spec.motorCount).toBe(0);
    expect(spinFor(spec, 400)).toBe(0);
  });
});

describe('spinning up', () => {
  it('approaches the analytic steady state, not the target, at full duty', () => {
    // Asking for more than the motor can give: the wheel saturates at its own
    // free speed and the target is simply never reached.
    const spec = { ...specFor(), targetRadPerSec: 1e6 };
    const settled = spinFor(spec, 4000);

    expect(settled).toBeCloseTo(freeWheelSpeed(spec, NOMINAL), 1);
  });

  it('follows the first-order curve to within a timestep', () => {
    const spec = { ...specFor(), targetRadPerSec: 1e6 };
    const free = freeWheelSpeed(spec, NOMINAL);
    const tau = timeConstantSec(spec);

    for (const seconds of [0.25, 0.5, 1, 2]) {
      const measured = spinFor(spec, Math.round(seconds / DT_SECONDS));
      const predicted = free * (1 - Math.exp(-seconds / tau));
      expect(Math.abs(measured - predicted) / predicted).toBeLessThan(0.01);
    }
  });

  it('takes real time to reach a reachable target', () => {
    const spec = specFor();
    expect(spec.targetRadPerSec).toBeLessThan(freeWheelSpeed(spec, NOMINAL));

    expect(spinFor(spec, 20)).toBeLessThan(spec.targetRadPerSec * 0.2);
    expect(spinFor(spec, 400)).toBeGreaterThan(spec.targetRadPerSec * 0.75);
    expect(spinFor(spec, 600)).toBeCloseTo(spec.targetRadPerSec, 0);
  });

  /**
   * A heavier wheel is slower to spin up and slower to recover, which is the
   * whole tradeoff a shooter is designed around.
   */
  it('spins up more slowly the heavier the wheel', () => {
    const light = specFor({ flywheelMassLb: 0.3 });
    const heavy = specFor({ flywheelMassLb: 1.2 });

    expect(spinFor(heavy, 200) / heavy.targetRadPerSec).toBeLessThan(
      spinFor(light, 200) / light.targetRadPerSec,
    );
  });

  it('holds the target once reached rather than running away', () => {
    const spec = specFor();
    let state = { radPerSec: spec.targetRadPerSec, running: true };
    for (let i = 0; i < 400; i++) state = stepFlywheel(spec, state, DT_SECONDS, NOMINAL).state;

    expect(state.radPerSec).toBeCloseTo(spec.targetRadPerSec, 6);
  });

  it('commands the exact holding duty at target, not a tuned gain', () => {
    const spec = specFor();
    const duty = flywheelDuty(spec, { radPerSec: spec.targetRadPerSec, running: true }, NOMINAL);

    expect(duty).toBeCloseTo(
      (spec.targetRadPerSec * spec.gearRatio * (spec.motor?.kE ?? 0)) / 12,
      12,
    );
  });

  it('commands nothing at all when the shooter is off', () => {
    const spec = specFor();
    expect(flywheelDuty(spec, { radPerSec: 0, running: false }, NOMINAL)).toBe(0);
  });

  /**
   * Zero duty is shorted leads, not open ones, so a shooter switched off brakes
   * itself down the same way the drivetrain does. It never runs backwards.
   */
  it('spins down under back-EMF braking when switched off', () => {
    const spec = specFor();
    let state = { radPerSec: 100, running: false };
    for (let i = 0; i < 200; i++) state = stepFlywheel(spec, state, DT_SECONDS, NOMINAL).state;
    expect(state.radPerSec).toBeLessThan(100);

    for (let i = 0; i < 4000; i++) state = stepFlywheel(spec, state, DT_SECONDS, NOMINAL).state;
    expect(state.radPerSec).toBeGreaterThanOrEqual(0);
    expect(state.radPerSec).toBeLessThan(1);
  });

  it('reports how ready it is as a fraction of target', () => {
    const spec = specFor();
    expect(spinFraction(spec, { radPerSec: 0, running: true })).toBe(0);
    expect(spinFraction(spec, { radPerSec: spec.targetRadPerSec / 2, running: true })).toBeCloseTo(
      0.5,
      12,
    );
    expect(spinFraction(spec, { radPerSec: spec.targetRadPerSec * 2, running: true })).toBe(1);
  });
});

describe('the speed a piece leaves at', () => {
  it('is the surface speed times the transfer ratio', () => {
    const hooded = specFor({ transferRatio: 0.5 });
    const dual = specFor({ transferRatio: 1 });
    const state = { radPerSec: 300, running: true };

    expect(exitSpeedMps(hooded, state)).toBeCloseTo(300 * hooded.radiusM * 0.5, 12);
    expect(exitSpeedMps(dual, state)).toBeCloseTo(300 * dual.radiusM, 12);
  });

  it('is whatever the wheel has reached, so an early shot falls short', () => {
    const spec = specFor();
    const early = spinFor(spec, 100);
    const late = spinFor(spec, 600);

    expect(exitSpeedMps(spec, { radPerSec: early, running: true })).toBeLessThan(
      exitSpeedMps(spec, { radPerSec: late, running: true }) / 2,
    );
  });

  it('scales with the wheel diameter at the same wheel speed', () => {
    const small = specFor({ flywheelDiameterIn: 3 });
    const big = specFor({ flywheelDiameterIn: 6 });
    const state = { radPerSec: 300, running: true };

    expect(exitSpeedMps(big, state) / exitSpeedMps(small, state)).toBeCloseTo(2, 12);
  });
});

describe('a shot takes energy out of the wheel', () => {
  const massKg = 0.165 * 0.45359237;

  /** Hooded: translation plus backspin comes to 0.7mv². Dual: 0.5mv². */
  it('charges 0.7mv squared for a hooded wheel and 0.5 for a dual', () => {
    expect(shotEnergyJ(massKg, 9, 0.5)).toBeCloseTo(0.7 * massKg * 81, 12);
    expect(shotEnergyJ(massKg, 9, 1)).toBeCloseTo(0.5 * massKg * 81, 12);
  });

  it('leaves the wheel at the speed conservation of energy demands', () => {
    const spec = specFor();
    const before = { radPerSec: spec.targetRadPerSec, running: true };
    const energy = shotEnergyJ(massKg, exitSpeedMps(spec, before), spec.transferRatio);

    const after = afterShot(spec, before, energy);
    const stored = 0.5 * spec.inertiaKgM2 * before.radPerSec * before.radPerSec;

    expect(0.5 * spec.inertiaKgM2 * after.radPerSec * after.radPerSec).toBeCloseTo(
      stored - energy,
      12,
    );
    expect(after.radPerSec).toBeLessThan(before.radPerSec);
  });

  /** A heavier wheel gives up less speed per shot: that is what inertia buys. */
  it('slows a light wheel more than a heavy one for the same shot', () => {
    const light = specFor({ flywheelMassLb: 0.3 });
    const heavy = specFor({ flywheelMassLb: 1.2 });

    const drop = (spec: FlywheelSpec): number => {
      const before = { radPerSec: spec.targetRadPerSec, running: true };
      const energy = shotEnergyJ(massKg, exitSpeedMps(spec, before), spec.transferRatio);
      return 1 - afterShot(spec, before, energy).radPerSec / before.radPerSec;
    };

    expect(drop(heavy)).toBeLessThan(drop(light));
  });

  it('cannot drive the wheel below a standstill', () => {
    const spec = specFor();
    expect(afterShot(spec, { radPerSec: 10, running: true }, 1e6).radPerSec).toBe(0);
  });

  /**
   * Recovery is not a constant either: it is however long the motor needs to
   * put the energy back, and it is short compared with the initial spin-up
   * because the wheel only fell a little way.
   */
  it('recovers in less time than it took to spin up', () => {
    const spec = specFor();
    const atTarget = { radPerSec: spec.targetRadPerSec, running: true };
    const energy = shotEnergyJ(massKg, exitSpeedMps(spec, atTarget), spec.transferRatio);

    let state = afterShot(spec, atTarget, energy);
    let ticks = 0;
    while (state.radPerSec < spec.targetRadPerSec * 0.999 && ticks < 4000) {
      state = stepFlywheel(spec, state, DT_SECONDS, NOMINAL).state;
      ticks++;
    }

    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThan(200);
  });
});

describe('the shooter draws from the battery', () => {
  it('pulls the most current at a standstill and less as it spins up', () => {
    const spec = specFor();
    const stalled = stepFlywheel(spec, { radPerSec: 0, running: true }, DT_SECONDS, NOMINAL);
    const spinning = stepFlywheel(
      spec,
      { radPerSec: spec.targetRadPerSec / 2, running: true },
      DT_SECONDS,
      NOMINAL,
    );

    expect(stalled.currentA).toBeGreaterThan(spinning.currentA);
    expect(spinning.currentA).toBeGreaterThan(0);
  });

  it('draws nothing while off', () => {
    const spec = specFor();
    expect(stepFlywheel(spec, { radPerSec: 0, running: false }, DT_SECONDS, NOMINAL).currentA).toBe(
      0,
    );
  });

  it('spins up more slowly on a sagging battery', () => {
    const spec = { ...specFor(), targetRadPerSec: 1e6 };
    const run = (v: number): number => {
      let state = { radPerSec: 0, running: true };
      for (let i = 0; i < 200; i++) state = stepFlywheel(spec, state, DT_SECONDS, volts(v)).state;
      return state.radPerSec;
    };

    expect(run(10)).toBeLessThan(run(12));
  });
});
