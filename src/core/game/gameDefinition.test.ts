import { describe, expect, it } from 'vitest';
import {
  assumptionLedger,
  checkRobotLegality,
  collectProvenance,
  definitionErrors,
  provenanceSummary,
  referencedPlaceIds,
  validateGameDefinition,
  type GameDefinition,
} from './gameDefinition.js';
import { createDefaultRegistry } from './predicates.js';
import { createRectRegion, createRectZone } from './regions.js';
import { assumed, explicit, explicitRule, unresolved } from './sourced.js';
import { DECODE_GAME } from './fixtures/decodeGame.js';
import { DEFAULT_ROBOT_CONFIG, type RobotConfig } from '../robot/robotConfig.js';
import type { ScoringRule } from './scoring.js';

const registry = createDefaultRegistry();

const minimal = (): GameDefinition => ({
  id: 'test',
  season: '2025-26',
  name: 'Test Game',
  match: {
    periods: [
      { id: 'AUTO', durationSec: explicit(30) },
      {
        id: 'TELEOP',
        durationSec: explicit(120),
        subPhases: [{ id: 'ENDGAME', startsAtRemainingSec: explicit(30) }],
      },
    ],
  },
  pieces: [
    { id: 'ball', label: 'Ball', diameterIn: explicit(5), massLb: explicit(0.3), count: explicit(10) },
  ],
  regions: [createRectRegion({ id: 'goal', centerXIn: 0, centerYIn: 0, widthIn: 12, lengthIn: 12 })],
  zones: [createRectZone({ id: 'base', centerXIn: 20, centerYIn: 0, widthIn: 18, lengthIn: 18 })],
  slottedRegions: {},
  rules: [
    {
      id: 'score',
      label: 'Score',
      phase: 'ANY',
      trigger: { event: 'PieceEnteredRegion', filters: [{ field: 'regionId', equals: 'goal' }] },
      award: { points: explicit(2), alliance: 'owner' },
    },
  ],
  objectives: [],
  robotConstraints: {
    startingCubeIn: explicitRule(18, 'R104'),
    maxExpandedHeightIn: explicit(38),
    horizontalExpansionIn: explicit(18),
  },
});

describe('a well-formed definition validates', () => {
  it('reports no problems for the minimal definition', () => {
    expect(validateGameDefinition(minimal(), registry)).toEqual([]);
  });

  it('reports no errors for the DECODE golden fixture', () => {
    expect(definitionErrors(validateGameDefinition(DECODE_GAME, registry))).toEqual([]);
  });
});

describe('invalid definitions are caught before a match starts', () => {
  /**
   * The failure this exists to prevent: a rule naming a place with no geometry
   * scores nothing and explains nothing.
   */
  it('catches a rule referencing a region that has no geometry', () => {
    const broken = { ...minimal(), regions: [] };
    const problems = validateGameDefinition(broken, registry);

    expect(definitionErrors(problems).length).toBeGreaterThan(0);
    expect(problems.some((p) => p.message.includes('no geometry'))).toBe(true);
  });

  it('catches a rule referencing a zone that has no geometry', () => {
    const rule: ScoringRule = {
      id: 'park',
      label: 'Park',
      phase: 'TELEOP',
      trigger: { event: 'RobotOverlapsZone', filters: [{ field: 'zoneId', equals: 'nowhere' }] },
      award: { points: explicit(5), alliance: 'owner' },
    };
    const problems = validateGameDefinition({ ...minimal(), rules: [rule] }, registry);
    expect(problems.some((p) => p.message.includes('"nowhere"'))).toBe(true);
  });

  it('catches a place referenced only by a predicate parameter', () => {
    const rule: ScoringRule = {
      id: 'park',
      label: 'Park',
      phase: 'TELEOP',
      trigger: { event: 'RobotOverlapsZone', filters: [{ field: 'zoneId', equals: 'base' }] },
      condition: { predicateId: 'robotFullyInZone', params: { zoneId: 'phantom' } },
      award: { points: explicit(5), alliance: 'owner' },
    };
    const problems = validateGameDefinition({ ...minimal(), rules: [rule] }, registry);
    expect(problems.some((p) => p.message.includes('"phantom"'))).toBe(true);
  });

  it('catches an unresolvable predicate', () => {
    const rule: ScoringRule = {
      ...(minimal().rules[0] as ScoringRule),
      condition: { predicateId: 'notRegistered' },
    };
    const problems = validateGameDefinition({ ...minimal(), rules: [rule] }, registry);
    expect(problems.some((p) => p.message.includes('unknown predicate'))).toBe(true);
  });

  it('catches duplicate rule ids', () => {
    const rule = minimal().rules[0] as ScoringRule;
    const problems = validateGameDefinition({ ...minimal(), rules: [rule, rule] }, registry);
    expect(problems.some((p) => p.message.includes('Duplicate rule id'))).toBe(true);
  });

  it('catches duplicate region ids', () => {
    const region = minimal().regions[0];
    if (region === undefined) return;
    const problems = validateGameDefinition({ ...minimal(), regions: [region, region] }, registry);
    expect(problems.some((p) => p.message.includes('Duplicate region id'))).toBe(true);
  });

  it('catches a slotted region with no geometry', () => {
    const problems = validateGameDefinition(
      { ...minimal(), slottedRegions: { ghost: 9 } },
      registry,
    );
    expect(problems.some((p) => p.where === 'slottedRegions')).toBe(true);
  });

  it('catches a nonsensical slot count', () => {
    const problems = validateGameDefinition(
      { ...minimal(), slottedRegions: { goal: 0 } },
      registry,
    );
    expect(problems.some((p) => p.message.includes('non-positive slot count'))).toBe(true);
  });

  it('catches a duplicate piece type', () => {
    const piece = minimal().pieces[0];
    if (piece === undefined) return;
    const problems = validateGameDefinition({ ...minimal(), pieces: [piece, piece] }, registry);
    expect(problems.some((p) => p.message.includes('Duplicate piece type'))).toBe(true);
  });

  /** A definition can be usable and still incomplete; that is a warning. */
  it('warns rather than errors when a piece has no mass', () => {
    const definition = {
      ...minimal(),
      pieces: [{ id: 'ball', label: 'Ball', diameterIn: explicit(5), count: explicit(10) }],
    };
    const problems = validateGameDefinition(definition, registry);

    expect(definitionErrors(problems)).toEqual([]);
    expect(problems.some((p) => p.severity === 'warning' && p.message.includes('mass'))).toBe(true);
  });

  it('warns when a definition scores nothing', () => {
    const problems = validateGameDefinition({ ...minimal(), rules: [] }, registry);
    expect(problems.some((p) => p.where === 'rules' && p.severity === 'warning')).toBe(true);
  });
});

describe('referenced place ids', () => {
  it('collects regions and zones from filters and predicate parameters', () => {
    const rules: ScoringRule[] = [
      {
        id: 'a',
        label: 'a',
        phase: 'ANY',
        trigger: { event: 'PieceEnteredRegion', filters: [{ field: 'regionId', equals: 'goal' }] },
        award: { points: explicit(1), alliance: 'red' },
      },
      {
        id: 'b',
        label: 'b',
        phase: 'ANY',
        trigger: { event: 'PieceCameToRest', filters: [{ field: 'regionIds.0', equals: 'depot' }] },
        condition: { predicateId: 'robotFullyInZone', params: { zoneId: 'base' } },
        award: { points: explicit(1), alliance: 'red' },
      },
    ];

    const referenced = referencedPlaceIds(rules);
    expect(referenced.regions).toEqual(['depot', 'goal']);
    expect(referenced.zones).toEqual(['base']);
  });

  it('ignores non-string filter values', () => {
    const rule: ScoringRule = {
      id: 'a',
      label: 'a',
      phase: 'ANY',
      trigger: { event: 'RobotHeightExceeded', filters: [{ field: 'zoneId', equals: 42 }] },
      award: { points: explicit(1), alliance: 'red' },
    };
    expect(referencedPlaceIds([rule]).zones).toEqual([]);
  });
});

describe('assumption ledger is derived, not maintained', () => {
  /**
   * ARCHITECTURE.md §6.1 promised the ledger would be a projection over the
   * definition. Walking the value means a number added without provenance
   * cannot hide in a list someone forgot to update.
   */
  it('finds every Sourced value in a definition', () => {
    const entries = collectProvenance(minimal());
    expect(entries.length).toBeGreaterThan(5);
    expect(entries.every((e) => typeof e.path === 'string' && e.path !== '')).toBe(true);
  });

  it('reports the path a value was found at', () => {
    const paths = collectProvenance(minimal()).map((e) => e.path);
    expect(paths).toContain('match.periods[0].durationSec');
    expect(paths).toContain('robotConstraints.startingCubeIn');
  });

  it('lists only values needing review', () => {
    const definition = {
      ...minimal(),
      pieces: [
        {
          id: 'ball',
          label: 'Ball',
          diameterIn: explicit(5),
          massLb: assumed(0.3, 'estimated'),
          count: unresolved(0, 'not stated'),
        },
      ],
    };

    const ledger = assumptionLedger(definition);
    expect(ledger.map((e) => e.confidence).sort()).toEqual(['assumed', 'unknown']);
    expect(ledger.some((e) => e.note === 'estimated')).toBe(true);
  });

  it('has nothing to review when everything is explicit', () => {
    expect(assumptionLedger(minimal())).toEqual([]);
  });

  it('preserves rule and page citations', () => {
    const entry = collectProvenance(minimal()).find(
      (e) => e.path === 'robotConstraints.startingCubeIn',
    );
    expect(entry?.sourceRule).toBe('R104');
  });

  it('summarises how much of a definition is sourced', () => {
    const summary = provenanceSummary(minimal());
    expect(summary.explicit).toBeGreaterThan(0);
    expect(summary.assumed).toBe(0);
  });
});

describe('DECODE provenance', () => {
  /** The fixture should be overwhelmingly transcribed, not estimated. */
  it('is mostly explicit', () => {
    const summary = provenanceSummary(DECODE_GAME);
    expect(summary.explicit).toBeGreaterThan(summary.assumed + summary.unknown);
  });

  /**
   * ARTIFACT mass was an estimate until the vendor's specification for the part
   * §9.9 names was located. It is now `inferred` — sourced, but through a chain
   * the manual does not itself walk — so it must leave the assumption ledger
   * while staying visible, with its citation, to the provenance walker.
   */
  it('carries the artifact mass as a cited value, not an assumption', () => {
    const ledger = assumptionLedger(DECODE_GAME);
    expect(ledger.some((e) => e.path.includes('massLb'))).toBe(false);

    const masses = collectProvenance(DECODE_GAME).filter((e) => e.path.endsWith('massLb'));
    expect(masses.length).toBeGreaterThan(0);
    for (const mass of masses) {
      expect(mass.confidence).toBe('inferred');
      expect(mass.note ?? '').toContain('andymark.com');
    }
  });

  /**
   * The thresholds were recorded as `unresolved` until Table 10-3 was
   * transcribed. Nothing in the definition should be unresolved now — an
   * `unknown` entry is a value the simulator is using without knowing it.
   */
  it('leaves no unresolved values in the definition', () => {
    const unknowns = assumptionLedger(DECODE_GAME).filter((e) => e.confidence === 'unknown');
    expect(unknowns.map((e) => e.path)).toEqual([]);
  });

  /**
   * A `Sourced` shared between fields must be reported at every path that uses
   * it. DECODE's two ARTIFACT types share one mass value, and the walker once
   * deduped it — so the ledger showed a single entry and read as though only one
   * piece type was affected.
   */
  it('reports a shared value at every path that uses it', () => {
    const masses = collectProvenance(DECODE_GAME).filter((e) => e.path.endsWith('massLb'));
    expect(masses).toHaveLength(DECODE_GAME.pieces.length);
    expect(new Set(masses.map((e) => e.value))).toEqual(new Set([0.165]));
  });

  /** The layout gap is the largest one in this fixture; it must be in the ledger. */
  it('lists the invented field positions as an assumption', () => {
    const ledger = assumptionLedger(DECODE_GAME);
    expect(ledger.some((e) => e.value === 'goal-cluster-positions-inferred')).toBe(true);
  });

  /**
   * The LAUNCH ZONES and the world frame are *read* from the manual rather than
   * guessed, so they must not appear in the assumption ledger — but they are
   * inferences rather than quotations, so they must still be visible as sourced
   * values a reviewer can check.
   */
  it('carries the derived geometry as inferred, not assumed', () => {
    const frame = collectProvenance(DECODE_GAME).filter(
      (e) => e.value === 'audience at -Y, GOAL at +Y, red at -X, blue at +X',
    );

    expect(frame.length).toBeGreaterThan(0);
    for (const entry of frame) expect(entry.confidence).toBe('inferred');
    expect(assumptionLedger(DECODE_GAME).map((e) => e.value)).not.toContain(
      'audience at -Y, GOAL at +Y, red at -X, blue at +X',
    );
  });

  /**
   * The setup guide moved the LAUNCH ZONE outline from a reading of §9.3 to a
   * quotation, so it must have left the ledger for the right reason.
   */
  it('carries the LAUNCH ZONE outline as transcribed', () => {
    const outline = collectProvenance(DECODE_GAME).filter(
      (e) => e.value === 'isosceles, base on the perimeter, apex toward the field centre',
    );

    expect(outline.length).toBeGreaterThan(0);
    for (const entry of outline) expect(entry.confidence).toBe('explicit');
  });

  it('carries the ranking-point thresholds as sourced values', () => {
    const paths = collectProvenance(DECODE_GAME)
      .filter((e) => e.path.startsWith('rankingPoints'))
      .map((e) => e.path);

    // Three criteria, each with an award and three tier thresholds, plus the
    // two outcome awards.
    expect(paths.length).toBeGreaterThanOrEqual(14);
    expect(paths.every((p) => p.startsWith('rankingPoints'))).toBe(true);
  });

  it('cites a page or rule for its explicit values', () => {
    const explicitEntries = collectProvenance(DECODE_GAME).filter(
      (e) => e.confidence === 'explicit',
    );
    const cited = explicitEntries.filter(
      (e) => e.sourcePage !== undefined || e.sourceRule !== undefined,
    );
    expect(cited.length).toBeGreaterThan(explicitEntries.length * 0.8);
  });
});

describe('robot legality is advisory', () => {
  const constraints = minimal().robotConstraints;

  it('passes a legal robot', () => {
    expect(checkRobotLegality(DEFAULT_ROBOT_CONFIG, constraints)).toEqual([]);
  });

  it('flags an oversize chassis and cites the rule', () => {
    const oversize: RobotConfig = {
      ...DEFAULT_ROBOT_CONFIG,
      chassis: { ...DEFAULT_ROBOT_CONFIG.chassis, lengthIn: 24 },
    };
    const violations = checkRobotLegality(oversize, constraints);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('R104');
    expect(violations[0]?.message).toMatch(/24 in/);
  });

  it('flags each offending dimension separately', () => {
    const oversize: RobotConfig = {
      ...DEFAULT_ROBOT_CONFIG,
      chassis: { ...DEFAULT_ROBOT_CONFIG.chassis, lengthIn: 20, widthIn: 20 },
    };
    expect(checkRobotLegality(oversize, constraints)).toHaveLength(2);
  });

  it('flags exceeding the expansion height limit', () => {
    const tall: RobotConfig = {
      ...DEFAULT_ROBOT_CONFIG,
      chassis: { ...DEFAULT_ROBOT_CONFIG.chassis, heightIn: 40 },
    };
    const violations = checkRobotLegality(tall, constraints);
    expect(violations.some((v) => v.message.includes('expansion limit'))).toBe(true);
  });

  it('checks against DECODE constraints', () => {
    expect(checkRobotLegality(DEFAULT_ROBOT_CONFIG, DECODE_GAME.robotConstraints)).toEqual([]);

    const oversize: RobotConfig = {
      ...DEFAULT_ROBOT_CONFIG,
      chassis: { ...DEFAULT_ROBOT_CONFIG.chassis, widthIn: 19 },
    };
    expect(checkRobotLegality(oversize, DECODE_GAME.robotConstraints).length).toBeGreaterThan(0);
  });
});
