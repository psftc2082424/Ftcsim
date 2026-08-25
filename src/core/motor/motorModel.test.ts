import { describe, expect, it } from 'vitest';
import {
  GOBILDA_5203_SERIES,
  YELLOW_JACKET_BASE_FREE_SPEED_RPM,
  YELLOW_JACKET_BASE_STALL_TORQUE_KG_CM,
  getMotorDatasheet,
  listMotorIds,
} from './catalog/goBILDA.js';
import {
  clampDuty,
  createMotorModel,
  effectiveFreeSpeed,
  motorCurrent,
  motorTorque,
} from './motorModel.js';
import { kgCmToNewtonMeters, ozInToNewtonMeters, radPerSecToRpm } from '../units/convert.js';
import { asVolts, rpmToRadPerSec } from '../units/convert.js';
import { radPerSec } from '../units/si.js';

const NOMINAL = asVolts(12);

describe('goBILDA catalogue integrity', () => {
  it('cites a goBILDA source URL and retrieval date for every entry', () => {
    for (const m of GOBILDA_5203_SERIES) {
      expect(m.source).toMatch(/^https:\/\/www\.gobilda\.com\//);
      expect(m.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('has unique ids and SKUs', () => {
    const ids = GOBILDA_5203_SERIES.map((m) => m.id);
    const skus = GOBILDA_5203_SERIES.map((m) => m.sku);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(skus).size).toBe(skus.length);
  });

  it('has physically positive values throughout', () => {
    for (const m of GOBILDA_5203_SERIES) {
      expect(m.gearboxRatio).toBeGreaterThan(0);
      expect(m.freeSpeedRpm).toBeGreaterThan(0);
      expect(m.stallTorqueKgCm).toBeGreaterThan(0);
      expect(m.stallCurrentA).toBeGreaterThan(0);
      expect(m.freeCurrentA).toBeGreaterThanOrEqual(0);
      expect(m.nominalVoltageV).toBeGreaterThan(0);
    }
  });

  it('throws a helpful error for an unknown motor id', () => {
    expect(() => getMotorDatasheet('not-a-motor')).toThrow(/Unknown motor id/);
    expect(listMotorIds().length).toBe(GOBILDA_5203_SERIES.length);
  });
});

describe('goBILDA catalogue — cross-checks against the manufacturer', () => {
  /**
   * Each datasheet prints stall torque in both kg·cm and oz-in. Converting each
   * independently and comparing validates `units/convert.ts` against goBILDA's
   * own arithmetic.
   *
   * Tolerance is 1.5 %, set by the worst entry rather than by taste: goBILDA
   * prints the small torques to two significant figures, so the 3.7:1 motor's
   * "5.4 kg·cm" against "75.8 oz-in" disagrees by 1.08 % from rounding alone
   * (75.8 oz-in is really 5.458 kg·cm). Every other entry lands under 0.8 %.
   */
  it('agrees between the kg-cm and oz-in stall torque figures', () => {
    for (const m of GOBILDA_5203_SERIES) {
      const fromKgCm = kgCmToNewtonMeters(m.stallTorqueKgCm);
      const fromOzIn = ozInToNewtonMeters(m.stallTorqueOzIn);
      const relativeError = Math.abs(fromKgCm - fromOzIn) / fromKgCm;
      expect(relativeError).toBeLessThan(0.015);
    }
  });

  /**
   * Data-entry integrity check, made possible by the 1:1 entry being the bare
   * base motor: dividing each geared entry's published torque by
   * (base torque x ratio) gives the gearbox's implied efficiency.
   *
   * Real values land between about 86 % and 100 % — falling with stage count,
   * which is exactly what a multi-stage planetary should do. A transposed digit
   * or a mis-typed ratio in a future entry would throw this far outside the
   * band, so it catches the kind of mistake a spec-sheet transcription actually
   * makes. The upper bound sits slightly above 1.0 because the two-significant-
   * figure entries round up (5.2:1 implies 103 %).
   */
  it('implies a physically plausible gearbox efficiency for every ratio', () => {
    for (const m of GOBILDA_5203_SERIES) {
      if (m.gearboxRatio === 1) continue; // the base motor itself

      const idealTorque = YELLOW_JACKET_BASE_STALL_TORQUE_KG_CM * m.gearboxRatio;
      const impliedEfficiency = m.stallTorqueKgCm / idealTorque;

      expect(impliedEfficiency).toBeGreaterThan(0.8);
      expect(impliedEfficiency).toBeLessThan(1.05);
    }
  });

  /** The 1:1 entry must actually be the base motor the constants describe. */
  it('carries the base motor as its own catalogue entry', () => {
    const base = GOBILDA_5203_SERIES.find((m) => m.gearboxRatio === 1);
    expect(base).toBeDefined();
    expect(base?.freeSpeedRpm).toBe(YELLOW_JACKET_BASE_FREE_SPEED_RPM);
    expect(base?.stallTorqueKgCm).toBe(YELLOW_JACKET_BASE_STALL_TORQUE_KG_CM);
  });

  /**
   * Every ratio in the series should be the same base motor behind a different
   * gearbox. If that is true, base free speed divided by the ratio reproduces
   * the published output free speed.
   */
  it('reproduces every published free speed from one shared base motor', () => {
    for (const m of GOBILDA_5203_SERIES) {
      const predicted = YELLOW_JACKET_BASE_FREE_SPEED_RPM / m.gearboxRatio;
      const relativeError = Math.abs(predicted - m.freeSpeedRpm) / m.freeSpeedRpm;
      expect(relativeError).toBeLessThan(0.015);
    }
  });

  /** The shared base motor implies identical electrical specs across ratios. */
  it('reports the same stall and no-load current for every ratio', () => {
    const stall = new Set(GOBILDA_5203_SERIES.map((m) => m.stallCurrentA));
    const free = new Set(GOBILDA_5203_SERIES.map((m) => m.freeCurrentA));
    expect(stall.size).toBe(1);
    expect(free.size).toBe(1);
  });
});

describe('motor model — reproduces datasheet endpoints', () => {
  it('produces exactly the published stall torque at zero speed, full duty', () => {
    for (const d of GOBILDA_5203_SERIES) {
      const motor = createMotorModel(d);
      const tau = motorTorque(motor, radPerSec(0), 1, NOMINAL);
      expect(tau).toBeCloseTo(kgCmToNewtonMeters(d.stallTorqueKgCm), 9);
    }
  });

  it('produces exactly the published stall current at zero speed, full duty', () => {
    for (const d of GOBILDA_5203_SERIES) {
      const motor = createMotorModel(d);
      expect(motorCurrent(motor, radPerSec(0), 1, NOMINAL)).toBeCloseTo(d.stallCurrentA, 9);
    }
  });

  it('produces zero torque at the published free speed, full duty', () => {
    for (const d of GOBILDA_5203_SERIES) {
      const motor = createMotorModel(d);
      const omegaFree = rpmToRadPerSec(d.freeSpeedRpm);
      expect(motorTorque(motor, omegaFree, 1, NOMINAL)).toBeCloseTo(0, 9);
    }
  });

  it('places the effective free speed at the published free speed for full duty', () => {
    for (const d of GOBILDA_5203_SERIES) {
      const motor = createMotorModel(d);
      expect(radPerSecToRpm(effectiveFreeSpeed(motor, 1, NOMINAL))).toBeCloseTo(d.freeSpeedRpm, 6);
    }
  });
});

describe('motor model — torque-speed curve shape', () => {
  const motor = createMotorModel(getMotorDatasheet('gobilda-5203-312'));

  it('decreases monotonically with speed', () => {
    let previous = Infinity;
    for (let rpm = 0; rpm <= 312; rpm += 12) {
      const tau = motorTorque(motor, rpmToRadPerSec(rpm), 1, NOMINAL);
      expect(tau).toBeLessThan(previous);
      previous = tau;
    }
  });

  it('does not offer maximum torque at every RPM (PRODUCT_SPEC.md §7)', () => {
    const atStall = motorTorque(motor, radPerSec(0), 1, NOMINAL);
    const atHalf = motorTorque(motor, rpmToRadPerSec(156), 1, NOMINAL);
    expect(atHalf).toBeCloseTo(atStall / 2, 6);
  });

  it('is linear between the two datasheet endpoints', () => {
    const stall = motorTorque(motor, radPerSec(0), 1, NOMINAL);
    for (const fraction of [0.25, 0.5, 0.75]) {
      const tau = motorTorque(motor, rpmToRadPerSec(312 * fraction), 1, NOMINAL);
      expect(tau).toBeCloseTo(stall * (1 - fraction), 6);
    }
  });
});

describe('motor model — braking and regeneration', () => {
  const motor = createMotorModel(getMotorDatasheet('gobilda-5203-312'));

  /**
   * This is what removes the need for an invented drag coefficient: a motor
   * commanded to zero while still spinning opposes its own motion.
   */
  it('produces a negative (braking) torque at zero duty while spinning forward', () => {
    const tau = motorTorque(motor, rpmToRadPerSec(200), 0, NOMINAL);
    expect(tau).toBeLessThan(0);
  });

  it('scales braking torque with speed', () => {
    const slow = motorTorque(motor, rpmToRadPerSec(100), 0, NOMINAL);
    const fast = motorTorque(motor, rpmToRadPerSec(200), 0, NOMINAL);
    expect(fast).toBeCloseTo(slow * 2, 6);
  });

  it('produces zero torque at zero duty and zero speed', () => {
    expect(motorTorque(motor, radPerSec(0), 0, NOMINAL)).toBeCloseTo(0, 12);
  });

  it('produces negative torque when back-driven above free speed', () => {
    expect(motorTorque(motor, rpmToRadPerSec(400), 1, NOMINAL)).toBeLessThan(0);
  });
});

describe('motor model — duty and voltage response', () => {
  const motor = createMotorModel(getMotorDatasheet('gobilda-5203-312'));

  it('scales stall torque linearly with duty', () => {
    const full = motorTorque(motor, radPerSec(0), 1, NOMINAL);
    expect(motorTorque(motor, radPerSec(0), 0.5, NOMINAL)).toBeCloseTo(full * 0.5, 9);
    expect(motorTorque(motor, radPerSec(0), -1, NOMINAL)).toBeCloseTo(-full, 9);
  });

  it('scales effective free speed linearly with duty', () => {
    const half = radPerSecToRpm(effectiveFreeSpeed(motor, 0.5, NOMINAL));
    expect(half).toBeCloseTo(312 / 2, 6);
  });

  it('loses torque and free speed as the battery sags', () => {
    const sagged = asVolts(10.5);
    expect(motorTorque(motor, radPerSec(0), 1, sagged)).toBeLessThan(
      motorTorque(motor, radPerSec(0), 1, NOMINAL),
    );
    expect(effectiveFreeSpeed(motor, 1, sagged)).toBeLessThan(effectiveFreeSpeed(motor, 1, NOMINAL));
  });

  it('clamps duty into [-1, 1] and treats NaN as zero', () => {
    expect(clampDuty(2)).toBe(1);
    expect(clampDuty(-7)).toBe(-1);
    expect(clampDuty(0.4)).toBe(0.4);
    expect(clampDuty(Number.NaN)).toBe(0);
  });
});

describe('motor model — derived constants', () => {
  it('satisfies kT * kE consistency with stall torque and free speed', () => {
    for (const d of GOBILDA_5203_SERIES) {
      const motor = createMotorModel(d);
      // tau_stall = kT * V / R, by construction.
      expect(motor.kT * (d.nominalVoltageV / motor.resistance)).toBeCloseTo(motor.stallTorque, 9);
      // omega_free = V / kE, by construction.
      expect(d.nominalVoltageV / motor.kE).toBeCloseTo(motor.freeSpeed, 9);
    }
  });

  it('rejects a datasheet with impossible values', () => {
    const base = getMotorDatasheet('gobilda-5203-312');
    expect(() => createMotorModel({ ...base, freeSpeedRpm: 0 })).toThrow(/free speed/);
    expect(() => createMotorModel({ ...base, stallCurrentA: 0 })).toThrow(/stall current/);
  });
});
