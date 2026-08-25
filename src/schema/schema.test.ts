import { describe, expect, it } from 'vitest';
import {
  FTC_STARTING_CUBE_IN,
  PHYSICAL_LIMITS,
  parseRobotConfig,
  safeParseRobotConfig,
  warningsFor,
} from './robotConfig.schema.js';
import {
  CURRENT_ROBOT_CONFIG_VERSION,
  MigrationError,
  migrateRobotConfig,
  registeredMigrationVersions,
} from './migrations.js';
import { DEFAULT_ROBOT_CONFIG, type RobotConfig } from '../core/robot/robotConfig.js';
import { deriveRobot } from '../core/robot/derive.js';

const valid = (): unknown => JSON.parse(JSON.stringify(DEFAULT_ROBOT_CONFIG)) as unknown;

const withChassis = (patch: Record<string, unknown>): unknown => {
  const base = valid() as { chassis: Record<string, unknown> };
  return { ...base, chassis: { ...base.chassis, ...patch } };
};

const withDrivetrain = (patch: Record<string, unknown>): unknown => {
  const base = valid() as { drivetrain: Record<string, unknown> };
  return { ...base, drivetrain: { ...base.drivetrain, ...patch } };
};

describe('robot config schema — accepts valid input', () => {
  it('accepts the default configuration', () => {
    const result = safeParseRobotConfig(valid());
    expect(result.ok).toBe(true);
  });

  it('round-trips through JSON without loss', () => {
    const parsed = parseRobotConfig(JSON.parse(JSON.stringify(DEFAULT_ROBOT_CONFIG)));
    expect(parsed).toEqual(DEFAULT_ROBOT_CONFIG);
  });

  it('produces a config the physics layer can derive from', () => {
    // The real contract: anything the schema accepts must not break derivation.
    const parsed = parseRobotConfig(valid());
    expect(() => deriveRobot(parsed)).not.toThrow();
  });

  it('accepts eight motors', () => {
    expect(safeParseRobotConfig(withDrivetrain({ motorCount: 8 })).ok).toBe(true);
  });
});

describe('robot config schema — rejects physically impossible input', () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['zero mass', withChassis({ massLb: 0 }), /Mass/],
    ['negative length', withChassis({ lengthIn: -5 }), /Length/],
    ['NaN width', withChassis({ widthIn: Number.NaN }), /Width/],
    ['infinite height', withChassis({ heightIn: Number.POSITIVE_INFINITY }), /Height/],
    ['zero wheel', withDrivetrain({ wheelDiameterIn: 0 }), /Wheel diameter/],
    ['zero gear ratio', withDrivetrain({ gearRatio: 0 }), /Gear ratio/],
    ['string mass', withChassis({ massLb: '32' }), /Mass must be a number/],
  ];

  for (const [label, input, pattern] of cases) {
    it(`rejects ${label}`, () => {
      const result = safeParseRobotConfig(input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.map((e) => e.message).join(' ')).toMatch(pattern);
    });
  }

  it('rejects a motor count that cannot fill four mecanum wheels', () => {
    const result = safeParseRobotConfig(withDrivetrain({ motorCount: 6 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toMatch(/multiple of 4/);
  });

  it('rejects an unknown motor id with the list of known ones', () => {
    const result = safeParseRobotConfig(withDrivetrain({ motorId: 'not-a-motor' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path).toBe('drivetrain.motorId');
    expect(result.errors[0]?.message).toMatch(/Unknown motor/);
    expect(result.errors[0]?.message).toMatch(/gobilda-5203-312/);
  });

  it('rejects malformed records outright', () => {
    for (const bad of [null, undefined, 42, 'robot', [], {}]) {
      expect(safeParseRobotConfig(bad).ok).toBe(false);
    }
  });

  it('reports the path of every failure', () => {
    const result = safeParseRobotConfig(withChassis({ massLb: -1, lengthIn: -1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.path).sort()).toEqual([
      'chassis.lengthIn',
      'chassis.massLb',
    ]);
  });

  it('throws a readable aggregate from parseRobotConfig', () => {
    expect(() => parseRobotConfig(withChassis({ massLb: 0 }))).toThrow(
      /Invalid robot configuration/,
    );
  });
});

describe('robot config schema — physical bounds catch unit mix-ups', () => {
  it('rejects a length that is obviously millimetres', () => {
    // 457 "inches" is someone who typed 457 mm.
    expect(safeParseRobotConfig(withChassis({ lengthIn: 457 })).ok).toBe(false);
  });

  it('allows the full plausible design range', () => {
    expect(safeParseRobotConfig(withChassis({ lengthIn: PHYSICAL_LIMITS.lengthIn.max })).ok).toBe(
      true,
    );
    expect(safeParseRobotConfig(withChassis({ massLb: PHYSICAL_LIMITS.massLb.min })).ok).toBe(true);
  });
});

describe('advisory warnings — legality is separate from validity', () => {
  /**
   * The whole point of the split: an oversize robot is a legitimate thing to
   * simulate. It must validate, and it must also be flagged.
   */
  it('accepts an oversize robot but warns about it', () => {
    const oversize = withChassis({ lengthIn: 24 });
    expect(safeParseRobotConfig(oversize).ok).toBe(true);

    const warnings = warningsFor(parseRobotConfig(oversize));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.severity).toBe('legality');
    expect(warnings[0]?.message).toMatch(new RegExp(`${FTC_STARTING_CUBE_IN} in`));
  });

  it('has nothing to say about a normal robot', () => {
    expect(warningsFor(DEFAULT_ROBOT_CONFIG)).toHaveLength(0);
  });

  it('warns when geometry is small enough to clamp the wheel inset', () => {
    const warnings = warningsFor(parseRobotConfig(withChassis({ lengthIn: 3, widthIn: 3 })));
    expect(warnings.some((w) => w.message.includes('wheel inset'))).toBe(true);
  });

  it('warns about an implausibly light robot', () => {
    const warnings = warningsFor(parseRobotConfig(withChassis({ massLb: 2 })));
    expect(warnings.some((w) => w.severity === 'plausibility')).toBe(true);
  });

  it('reports every applicable warning at once', () => {
    const warnings = warningsFor(
      parseRobotConfig(withChassis({ lengthIn: 24, widthIn: 24, heightIn: 24, massLb: 2 })),
    );
    expect(warnings.filter((w) => w.severity === 'legality')).toHaveLength(3);
    expect(warnings.filter((w) => w.severity === 'plausibility')).toHaveLength(1);
  });
});

describe('migrations', () => {
  it('passes a current-version record through untouched', () => {
    const record = valid() as Record<string, unknown>;
    expect(migrateRobotConfig(record)).toEqual(record);
  });

  it('has no gaps in the ladder below the current version', () => {
    const versions = registeredMigrationVersions();
    for (let v = 1; v < CURRENT_ROBOT_CONFIG_VERSION; v++) {
      expect(versions).toContain(v);
    }
  });

  /**
   * The first real migration, and the one that proves the ladder works: a robot
   * saved before the capability framework existed must still load. A v1 robot
   * genuinely had no mechanisms, so an empty array is the correct upgrade rather
   * than a guess at intent.
   */
  it('upgrades a v1 record by giving it an empty mechanism list', () => {
    const v1 = {
      schemaVersion: 1,
      id: 'legacy',
      name: 'Last Season Bot',
      chassis: { lengthIn: 18, widthIn: 17, heightIn: 16, massLb: 31 },
      drivetrain: {
        motorId: 'gobilda-5203-312',
        motorCount: 4,
        gearRatio: 1,
        wheelDiameterIn: 3.78,
      },
    };

    const migrated = migrateRobotConfig(v1);
    expect(migrated['schemaVersion']).toBe(2);
    expect(migrated['mechanisms']).toEqual([]);

    const result = safeParseRobotConfig(migrated);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Everything else must survive untouched.
    expect(result.config.name).toBe('Last Season Bot');
    expect(result.config.chassis).toEqual(v1.chassis);
    expect(result.config.drivetrain).toEqual(v1.drivetrain);
  });

  it('produces a v1-migrated robot the physics can derive from', () => {
    const v1: Record<string, unknown> = {
      ...(valid() as Record<string, unknown>),
      schemaVersion: 1,
    };
    delete v1['mechanisms'];

    const config = parseRobotConfig(migrateRobotConfig(v1));
    expect(() => deriveRobot(config)).not.toThrow();
    expect(deriveRobot(config).mechanisms).toEqual([]);
  });

  it('refuses a record from a newer build', () => {
    const future = { ...(valid() as object), schemaVersion: CURRENT_ROBOT_CONFIG_VERSION + 1 };
    expect(() => migrateRobotConfig(future)).toThrow(MigrationError);
    expect(() => migrateRobotConfig(future)).toThrow(/newer than this build/);
  });

  it('refuses a record with no usable version', () => {
    for (const bad of [{}, { schemaVersion: 'one' }, { schemaVersion: 0 }, { schemaVersion: 1.5 }]) {
      expect(() => migrateRobotConfig(bad)).toThrow(MigrationError);
    }
  });

  it('refuses non-objects', () => {
    for (const bad of [null, 42, 'x', []]) {
      expect(() => migrateRobotConfig(bad)).toThrow(/not an object/);
    }
  });

  it('does not mutate the input record', () => {
    const record = valid() as Record<string, unknown>;
    const before = JSON.stringify(record);
    migrateRobotConfig(record);
    expect(JSON.stringify(record)).toBe(before);
  });

  it('feeds a migrated record straight into validation', () => {
    const migrated = migrateRobotConfig(valid());
    const result = safeParseRobotConfig(migrated);
    expect(result.ok).toBe(true);
  });

  /**
   * Validation is the step after migration. A stale version reaching the
   * validator means a caller skipped the ladder, which is a pipeline bug worth
   * naming rather than quietly accepting.
   */
  it('refuses to validate a record whose version is not current', () => {
    const offVersion = { ...(valid() as object), schemaVersion: CURRENT_ROBOT_CONFIG_VERSION + 1 };
    const result = safeParseRobotConfig(offVersion);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toMatch(/migrateRobotConfig/);
  });

  it('rejects a non-positive version before it reaches the migration check', () => {
    const result = safeParseRobotConfig({ ...(valid() as object), schemaVersion: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path).toBe('schemaVersion');
  });
});

describe('schema and core stay in agreement', () => {
  /**
   * The schema and `derive.ts` both encode the mecanum motor-count rule. If they
   * ever disagree, one of them is wrong; this catches the drift.
   */
  it('agrees with derive.ts on motor count', () => {
    for (const count of [1, 2, 3, 5, 6, 7]) {
      const config = withDrivetrain({ motorCount: count });
      expect(safeParseRobotConfig(config).ok).toBe(false);
      expect(() => deriveRobot(config as RobotConfig)).toThrow();
    }
    for (const count of [4, 8, 12]) {
      const config = withDrivetrain({ motorCount: count });
      expect(safeParseRobotConfig(config).ok).toBe(true);
      expect(() => deriveRobot(config as RobotConfig)).not.toThrow();
    }
  });

  it('agrees with the motor catalogue', () => {
    expect(safeParseRobotConfig(withDrivetrain({ motorId: 'gobilda-5203-6000' })).ok).toBe(true);
    expect(safeParseRobotConfig(withDrivetrain({ motorId: 'gobilda-5203-43' })).ok).toBe(true);
  });
});
