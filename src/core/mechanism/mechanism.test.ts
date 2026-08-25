import { describe, expect, it } from 'vitest';
import {
  PIECES_PER_OUTPUT_REVOLUTION,
  TOTAL_MOTOR_PORTS,
  centreOfMassOffsetIn,
  deriveMechanism,
  deriveMechanisms,
  portBudget,
  type MechanismConfig,
} from './mechanism.js';
import { DEFAULT_ROBOT_CONFIG, type RobotConfig } from '../robot/robotConfig.js';
import { deriveRobot } from '../robot/derive.js';
import { analyticFreeSpeed, analyticPeakAcceleration } from '../drive/drivetrain.js';
import { asVolts, kgCmToNewtonMeters, poundsToKilograms } from '../units/convert.js';
import { getMotorDatasheet } from '../motor/catalog/goBILDA.js';

const NOMINAL = asVolts(12);

/** A powered mechanism. Defaults are a plausible roller intake. */
function mechanism(patch: Partial<MechanismConfig> = {}): MechanismConfig {
  return {
    id: 'intake-1',
    name: 'Intake',
    preset: 'intake',
    massLb: 4,
    mount: { xIn: 8, yIn: 0, facingDeg: 0 },
    actuation: { motorId: 'gobilda-5203-435', motorCount: 1, gearRatio: 1, efficiency: 0.9 },
    capabilities: [{ kind: 'acquire', pieceTypes: [], capacity: 3, reachIn: 6 }],
    ...patch,
  };
}

/** A mechanism with no motor — a fixed hook, a deflector, a dead-axle roller. */
function passive(patch: Partial<MechanismConfig> = {}): MechanismConfig {
  const { actuation: _drop, ...rest } = mechanism(patch);
  return { ...rest, capabilities: [{ kind: 'traverse', requiredClearanceIn: 12 }] };
}

describe('deriveMechanism — powered', () => {
  it('derives output speed from motor free speed and gearing', () => {
    expect(deriveMechanism(mechanism()).outputRpm).toBeCloseTo(435, 9);
    expect(
      deriveMechanism(
        mechanism({
          actuation: { motorId: 'gobilda-5203-435', motorCount: 1, gearRatio: 4, efficiency: 0.9 },
        }),
      ).outputRpm,
    ).toBeCloseTo(435 / 4, 9);
  });

  /**
   * Throughput is derived, not typed in: one piece per revolution of the
   * mechanism output, which is revolutions-per-second. PRODUCT_SPEC.md §14
   * requires stats to correspond to actual mechanism parameters.
   */
  it('derives throughput as revolutions per second', () => {
    const derived = deriveMechanism(mechanism());
    expect(derived.throughputPerSec).toBeCloseTo((435 / 60) * PIECES_PER_OUTPUT_REVOLUTION, 9);
    expect(derived.throughputPerSec).toBeCloseTo(7.25, 6);
  });

  it('trades throughput for torque when geared down', () => {
    const fast = deriveMechanism(mechanism());
    const slow = deriveMechanism(
      mechanism({
        actuation: { motorId: 'gobilda-5203-435', motorCount: 1, gearRatio: 4, efficiency: 0.9 },
      }),
    );

    expect(slow.throughputPerSec).toBeCloseTo((fast.throughputPerSec ?? 0) / 4, 9);
    expect(slow.outputTorqueNm).toBeCloseTo((fast.outputTorqueNm ?? 0) * 4, 9);
  });

  it('derives output torque from the datasheet stall torque', () => {
    const stallNm = kgCmToNewtonMeters(getMotorDatasheet('gobilda-5203-435').stallTorqueKgCm);
    // stall x gearRatio x efficiency x motorCount
    expect(deriveMechanism(mechanism()).outputTorqueNm).toBeCloseTo(stallNm * 1 * 0.9 * 1, 9);
  });

  it('scales torque and port use with motor count, not speed', () => {
    const dual = deriveMechanism(
      mechanism({
        actuation: { motorId: 'gobilda-5203-435', motorCount: 2, gearRatio: 1, efficiency: 0.9 },
      }),
    );
    const single = deriveMechanism(mechanism());

    expect(dual.outputTorqueNm).toBeCloseTo((single.outputTorqueNm ?? 0) * 2, 9);
    expect(dual.outputRpm).toBeCloseTo(single.outputRpm ?? 0, 9);
    expect(dual.motorCount).toBe(2);
  });

  it('reports efficiency losses in torque but not in speed', () => {
    const lossy = deriveMechanism(
      mechanism({
        actuation: { motorId: 'gobilda-5203-435', motorCount: 1, gearRatio: 1, efficiency: 0.5 },
      }),
    );
    const clean = deriveMechanism(
      mechanism({
        actuation: { motorId: 'gobilda-5203-435', motorCount: 1, gearRatio: 1, efficiency: 1 },
      }),
    );

    expect(lossy.outputTorqueNm).toBeCloseTo((clean.outputTorqueNm ?? 0) * 0.5, 9);
    expect(lossy.outputRpm).toBeCloseTo(clean.outputRpm ?? 0, 9);
  });
});

describe('deriveMechanism — passive', () => {
  it('reports no speed, throughput or torque without an actuator', () => {
    const derived = deriveMechanism(passive());
    expect(derived.outputRpm).toBeNull();
    expect(derived.throughputPerSec).toBeNull();
    expect(derived.outputTorqueNm).toBeNull();
    expect(derived.motorCount).toBe(0);
  });

  it('still carries its mass', () => {
    expect(deriveMechanism(passive({ massLb: 2.5 })).massLb).toBe(2.5);
  });
});

describe('deriveMechanism — validation', () => {
  it('rejects negative or non-finite mass', () => {
    expect(() => deriveMechanism(mechanism({ massLb: -1 }))).toThrow(/non-negative/);
    expect(() => deriveMechanism(mechanism({ massLb: Number.NaN }))).toThrow(/non-negative/);
  });

  it('allows a massless mechanism', () => {
    // A software-only capability declaration is legitimate; zero is not an error.
    expect(deriveMechanism(mechanism({ massLb: 0 })).massLb).toBe(0);
  });

  it('rejects impossible actuation', () => {
    expect(() =>
      deriveMechanism(
        mechanism({
          actuation: { motorId: 'gobilda-5203-435', motorCount: 1, gearRatio: 0, efficiency: 0.9 },
        }),
      ),
    ).toThrow(/gear ratio/);

    expect(() =>
      deriveMechanism(
        mechanism({
          actuation: { motorId: 'gobilda-5203-435', motorCount: 0, gearRatio: 1, efficiency: 0.9 },
        }),
      ),
    ).toThrow(/motor count/);
  });

  it('rejects an unknown motor', () => {
    expect(() =>
      deriveMechanism(
        mechanism({
          actuation: { motorId: 'nope', motorCount: 1, gearRatio: 1, efficiency: 0.9 },
        }),
      ),
    ).toThrow(/Unknown motor id/);
  });
});

describe('deriveMechanisms — totals', () => {
  it('sums mass and motor count', () => {
    const totals = deriveMechanisms([
      mechanism({ id: 'a', massLb: 4 }),
      mechanism({
        id: 'b',
        massLb: 6,
        actuation: { motorId: 'gobilda-5203-312', motorCount: 2, gearRatio: 2, efficiency: 0.9 },
      }),
      passive({ id: 'c', massLb: 1.5 }),
    ]);

    expect(totals.massLb).toBeCloseTo(11.5, 9);
    expect(totals.motorCount).toBe(3);
    expect(totals.derived).toHaveLength(3);
  });

  it('handles an empty and an omitted list', () => {
    expect(deriveMechanisms([]).massLb).toBe(0);
    expect(deriveMechanisms().motorCount).toBe(0);
  });
});

describe('centre of mass (supersedes ASSUMPTIONS.md §1.4)', () => {
  it('stays at the centroid with no mechanisms', () => {
    expect(centreOfMassOffsetIn(32, [])).toEqual({ xIn: 0, yIn: 0 });
  });

  it('shifts toward a mounted mechanism, weighted by mass', () => {
    // 4 lb at +8 in on a 32 lb chassis: 4*8 / 36 = 0.889 in forward.
    const offset = centreOfMassOffsetIn(32, deriveMechanisms([mechanism({ massLb: 4 })]).derived);
    expect(offset.xIn).toBeCloseTo((4 * 8) / 36, 9);
    expect(offset.yIn).toBeCloseTo(0, 12);
  });

  it('cancels symmetric mounts', () => {
    const offset = centreOfMassOffsetIn(
      32,
      deriveMechanisms([
        mechanism({ id: 'l', mount: { xIn: 0, yIn: 6, facingDeg: 0 } }),
        mechanism({ id: 'r', mount: { xIn: 0, yIn: -6, facingDeg: 0 } }),
      ]).derived,
    );
    expect(offset.xIn).toBeCloseTo(0, 12);
    expect(offset.yIn).toBeCloseTo(0, 12);
  });

  it('shifts further as the mechanism gets heavier', () => {
    const light = centreOfMassOffsetIn(32, deriveMechanisms([mechanism({ massLb: 2 })]).derived);
    const heavy = centreOfMassOffsetIn(32, deriveMechanisms([mechanism({ massLb: 12 })]).derived);
    expect(heavy.xIn).toBeGreaterThan(light.xIn);
  });

  it('does not divide by zero for a massless robot', () => {
    expect(centreOfMassOffsetIn(0, [])).toEqual({ xIn: 0, yIn: 0 });
  });
});

describe('motor port budget — the constraint that forces tradeoffs', () => {
  it('accounts drivetrain and mechanism motors against eight ports', () => {
    expect(TOTAL_MOTOR_PORTS).toBe(8);

    const budget = portBudget(4, 2);
    expect(budget.used).toBe(6);
    expect(budget.remaining).toBe(2);
    expect(budget.overBudget).toBe(false);
  });

  it('flags an over-budget robot', () => {
    // A mecanum drivetrain leaves four ports; a fifth mechanism motor does not fit.
    const budget = portBudget(4, 5);
    expect(budget.used).toBe(9);
    expect(budget.remaining).toBe(-1);
    expect(budget.overBudget).toBe(true);
  });

  it('treats exactly eight as legal', () => {
    expect(portBudget(4, 4).overBudget).toBe(false);
  });
});

describe('integration — mechanism mass reaches the physics', () => {
  const withMechanisms = (mechanisms: readonly MechanismConfig[]): RobotConfig => ({
    ...DEFAULT_ROBOT_CONFIG,
    mechanisms,
  });

  it('adds mechanism mass to the total the physics accelerates', () => {
    const bare = deriveRobot(DEFAULT_ROBOT_CONFIG);
    const loaded = deriveRobot(withMechanisms([mechanism({ massLb: 8 })]));

    expect(loaded.chassisMassKg).toBeCloseTo(bare.massKg, 9);
    expect(loaded.mechanismMassKg).toBeCloseTo(poundsToKilograms(8), 9);
    expect(loaded.massKg).toBeCloseTo(bare.massKg + poundsToKilograms(8), 9);
  });

  /**
   * The tradeoff PRODUCT_SPEC.md §11 asks for, arising structurally rather than
   * being hand-tuned: a heavier mechanism really does cost acceleration.
   */
  it('costs acceleration but not top speed', () => {
    const bare = deriveRobot(DEFAULT_ROBOT_CONFIG);
    const loaded = deriveRobot(withMechanisms([mechanism({ massLb: 8 })]));

    const bareAccel = analyticPeakAcceleration(bare.drivetrain, NOMINAL, bare.massKg);
    const loadedAccel = analyticPeakAcceleration(loaded.drivetrain, NOMINAL, loaded.massKg);

    expect(loadedAccel).toBeLessThan(bareAccel);
    expect(loadedAccel).toBeCloseTo((bareAccel * bare.massKg) / loaded.massKg, 9);

    // Top speed is set by back-EMF, not by mass.
    expect(analyticFreeSpeed(loaded.drivetrain, NOMINAL)).toBeCloseTo(
      analyticFreeSpeed(bare.drivetrain, NOMINAL),
      12,
    );
  });

  it('raises the moment of inertia along with total mass', () => {
    const bare = deriveRobot(DEFAULT_ROBOT_CONFIG);
    const loaded = deriveRobot(withMechanisms([mechanism({ massLb: 8 })]));
    expect(loaded.inertiaZ).toBeGreaterThan(bare.inertiaZ);
  });

  it('reports the port budget on the derived robot', () => {
    const loaded = deriveRobot(
      withMechanisms([
        mechanism({
          id: 'a',
          actuation: { motorId: 'gobilda-5203-435', motorCount: 2, gearRatio: 1, efficiency: 0.9 },
        }),
      ]),
    );
    expect(loaded.ports.used).toBe(6); // 4 drive + 2 mechanism
    expect(loaded.ports.overBudget).toBe(false);

    const overloaded = deriveRobot(
      withMechanisms([
        mechanism({
          id: 'a',
          actuation: { motorId: 'gobilda-5203-435', motorCount: 5, gearRatio: 1, efficiency: 0.9 },
        }),
      ]),
    );
    expect(overloaded.ports.overBudget).toBe(true);
  });

  it('exposes the centre-of-mass offset in metres', () => {
    const loaded = deriveRobot(withMechanisms([mechanism({ massLb: 4 })]));
    expect(loaded.comOffset.xM).toBeGreaterThan(0);
    expect(loaded.comOffset.yM).toBeCloseTo(0, 12);
  });
});

describe('the engine does not branch on mechanism preset names', () => {
  /**
   * ARCHITECTURE.md §7: `preset` is a UI label. Two mechanisms differing only by
   * that label must derive identically — this is the property that keeps the
   * simulator season-agnostic.
   */
  it('derives identically regardless of the preset label', () => {
    const asIntake = deriveMechanism(mechanism({ preset: 'intake' }));
    const asShooter = deriveMechanism(mechanism({ preset: 'shooter' }));
    const asNonsense = deriveMechanism(mechanism({ preset: 'wibble' }));

    for (const other of [asShooter, asNonsense]) {
      expect(other.outputRpm).toBe(asIntake.outputRpm);
      expect(other.throughputPerSec).toBe(asIntake.throughputPerSec);
      expect(other.outputTorqueNm).toBe(asIntake.outputTorqueNm);
      expect(other.massLb).toBe(asIntake.massLb);
    }
  });
});
