import { describe, expect, it } from 'vitest';
import { Battery, DEFAULT_BATTERY, sumPackLoad } from './battery.js';
import { amps, ohms, volts } from '../units/si.js';
import { asVolts } from '../units/convert.js';
import { createMotorModel } from './motorModel.js';
import { motorCurrent } from './motorModel.js';
import { getMotorDatasheet } from './catalog/goBILDA.js';
import { radPerSec } from '../units/si.js';

describe('battery — sag arithmetic', () => {
  it('starts at open-circuit voltage with no load', () => {
    const b = new Battery();
    expect(b.voltage).toBeCloseTo(12.0, 12);
    expect(b.current).toBe(0);
  });

  it('applies V = Voc - I * Rint', () => {
    const b = new Battery({ openCircuitVolts: volts(12), internalResistanceOhms: ohms(0.03) });
    b.update(amps(40));
    expect(b.voltage).toBeCloseTo(12 - 40 * 0.03, 12);
    expect(b.voltage).toBeCloseTo(10.8, 12);
  });

  it('returns to open-circuit voltage when the load is removed', () => {
    const b = new Battery();
    b.update(amps(40));
    expect(b.voltage).toBeLessThan(12);
    b.update(amps(0));
    expect(b.voltage).toBeCloseTo(12, 12);
  });

  it('clamps to a non-negative voltage under an absurd load', () => {
    const b = new Battery();
    b.update(amps(100_000));
    expect(b.voltage).toBe(0);
  });

  it('reset() restores the initial state', () => {
    const b = new Battery();
    b.update(amps(30));
    b.reset();
    expect(b.voltage).toBeCloseTo(12, 12);
    expect(b.current).toBe(0);
  });
});

describe('battery — one-tick lag', () => {
  /**
   * The lag is the whole point: within a tick the voltage is a fixed input, so
   * there is no algebraic loop between torque, current and voltage.
   */
  it('does not change voltage until update() is called', () => {
    const b = new Battery();
    const before = b.voltage;
    // Consumers read `voltage` many times during a tick; it must not move.
    expect(b.voltage).toBe(before);
    expect(b.voltage).toBe(before);

    b.update(amps(20));
    expect(b.voltage).toBeLessThan(before);
  });

  it('exposes the previous tick load, not the current one', () => {
    const b = new Battery();
    b.update(amps(10));
    expect(b.current).toBeCloseTo(10, 12);
    b.update(amps(25));
    expect(b.current).toBeCloseTo(25, 12);
  });

  it('converges to a steady state under a constant demand', () => {
    // Iterating the lagged loop with a fixed duty must settle, not oscillate.
    const motor = createMotorModel(getMotorDatasheet('gobilda-5203-312'));
    const b = new Battery();

    let previous = Number.POSITIVE_INFINITY;
    let voltage = b.voltage;

    for (let tick = 0; tick < 50; tick++) {
      const perMotor = motorCurrent(motor, radPerSec(0), 1, b.voltage);
      b.update(sumPackLoad([perMotor, perMotor, perMotor, perMotor]));
      voltage = b.voltage;
      if (tick > 2) {
        // Monotonic, bounded, and not diverging.
        expect(Math.abs(voltage - previous)).toBeLessThanOrEqual(1e-6 + Math.abs(previous) * 0.5);
      }
      previous = voltage;
    }

    expect(voltage).toBeGreaterThan(0);
    expect(voltage).toBeLessThan(12);
    expect(Number.isFinite(voltage)).toBe(true);
  });
});

describe('battery — pack load summation', () => {
  it('sums motoring currents', () => {
    expect(sumPackLoad([amps(9.2), amps(9.2), amps(9.2), amps(9.2)])).toBeCloseTo(36.8, 12);
  });

  it('ignores regenerative (negative) current', () => {
    // Real FTC power systems do not usefully recharge the pack through the
    // motor controllers; crediting regen would raise voltage while braking.
    expect(sumPackLoad([amps(10), amps(-10)])).toBeCloseTo(10, 12);
    expect(sumPackLoad([amps(-5), amps(-5)])).toBe(0);
  });

  it('returns zero for an empty pack load', () => {
    expect(sumPackLoad([])).toBe(0);
  });
});

describe('battery — realistic FTC drivetrain sag', () => {
  it('sags about a volt for a four-motor stall, not to a brownout', () => {
    const motor = createMotorModel(getMotorDatasheet('gobilda-5203-312'));
    const b = new Battery(DEFAULT_BATTERY);

    const perMotor = motorCurrent(motor, radPerSec(0), 1, asVolts(12));
    b.update(sumPackLoad([perMotor, perMotor, perMotor, perMotor]));

    // 4 x 9.2 A = 36.8 A into 0.03 ohm is about 1.1 V of sag.
    expect(b.current).toBeCloseTo(36.8, 6);
    expect(b.voltage).toBeGreaterThan(10.5);
    expect(b.voltage).toBeLessThan(11.2);
  });

  it('barely sags near free speed, where current is small', () => {
    const motor = createMotorModel(getMotorDatasheet('gobilda-5203-312'));
    const b = new Battery(DEFAULT_BATTERY);

    // Just below free speed: back-EMF nearly cancels the applied voltage.
    const nearFree = radPerSec(motor.freeSpeed * 0.98);
    const perMotor = motorCurrent(motor, nearFree, 1, asVolts(12));
    b.update(sumPackLoad([perMotor, perMotor, perMotor, perMotor]));

    expect(b.voltage).toBeGreaterThan(11.9);
  });
});
