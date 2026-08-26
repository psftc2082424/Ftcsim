import { describe, expect, it } from 'vitest';
import {
  isReviewRequired,
  safeParseMatchStructure,
  safeParseObjective,
  safeParseScoringRule,
} from './gameDefinition.schema.js';
import { FTC_CONVENTIONAL_MATCH } from '../core/game/matchStructure.js';
import { SIM_EVENT_KINDS } from '../core/game/events.js';
import { DECODE_SCORING_RULES } from '../core/game/fixtures/decode.js';
import { explicit } from '../core/game/sourced.js';

/** Round-trip through JSON, which is how a definition will actually arrive. */
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

const validRule = () => ({
  id: 'high-goal',
  label: 'Score in the high goal',
  phase: 'TELEOP',
  trigger: {
    event: 'PieceEnteredRegion',
    filters: [{ field: 'regionId', equals: 'high-goal' }],
  },
  award: { points: explicit(5, 40), alliance: 'owner' },
});

const validObjective = () => ({
  id: 'score-high',
  label: 'Score in the high goal',
  phase: 'ANY',
  pointValue: explicit(6, 40),
  requiredCapabilities: ['acquire', 'release', 'elevate'],
  repeatable: true,
});

describe('match structure schema', () => {
  it('accepts the conventional FTC structure', () => {
    const result = safeParseMatchStructure(asJson(FTC_CONVENTIONAL_MATCH));
    expect(result.ok).toBe(true);
  });

  /**
   * The load-bearing check. An endgame longer than the period containing it is
   * the exact symptom of treating the three published durations as additive,
   * and it must be rejected rather than silently clamped.
   */
  it('rejects an endgame that cannot fit inside teleop', () => {
    const bad = asJson({
      ...FTC_CONVENTIONAL_MATCH,
      periods: [
        FTC_CONVENTIONAL_MATCH.periods[0],
        {
          ...FTC_CONVENTIONAL_MATCH.periods[1],
          subPhases: [{ id: 'ENDGAME', startsAtRemainingSec: explicit(200) }],
        },
      ],
    });

    const result = safeParseMatchStructure(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toMatch(/sub-phase of teleop/i);
  });

  it('accepts an endgame exactly as long as teleop', () => {
    const edge = asJson({
      ...FTC_CONVENTIONAL_MATCH,
      periods: [
        FTC_CONVENTIONAL_MATCH.periods[0],
        {
          ...FTC_CONVENTIONAL_MATCH.periods[1],
          subPhases: [{ id: 'ENDGAME', startsAtRemainingSec: explicit(120) }],
        },
      ],
    });
    expect(safeParseMatchStructure(edge).ok).toBe(true);
  });

  it('requires both periods in order', () => {
    expect(safeParseMatchStructure({ periods: [] }).ok).toBe(false);
    expect(
      safeParseMatchStructure(asJson({ periods: [FTC_CONVENTIONAL_MATCH.periods[0]] })).ok,
    ).toBe(false);
  });

  it('rejects a negative or absurd duration', () => {
    for (const seconds of [-1, 99_999]) {
      const bad = asJson({
        ...FTC_CONVENTIONAL_MATCH,
        periods: [
          { id: 'AUTO', durationSec: explicit(seconds) },
          FTC_CONVENTIONAL_MATCH.periods[1],
        ],
      });
      expect(safeParseMatchStructure(bad).ok).toBe(false);
    }
  });

  it('rejects malformed input outright', () => {
    for (const bad of [null, 42, 'match', [], {}]) {
      expect(safeParseMatchStructure(bad).ok).toBe(false);
    }
  });

  it('reports the path of a failure', () => {
    const result = safeParseMatchStructure(
      asJson({
        ...FTC_CONVENTIONAL_MATCH,
        periods: [{ id: 'AUTO', durationSec: explicit(-5) }, FTC_CONVENTIONAL_MATCH.periods[1]],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path).toContain('periods');
  });
});

describe('scoring rule schema', () => {
  it('accepts a well-formed rule', () => {
    expect(safeParseScoringRule(asJson(validRule())).ok).toBe(true);
  });

  it('accepts an optional predicate condition', () => {
    const withCondition = {
      ...validRule(),
      condition: { predicateId: 'supportedByGoal', params: { minHeightIn: 26 } },
    };
    expect(safeParseScoringRule(asJson(withCondition)).ok).toBe(true);
  });

  /**
   * A GameDefinition may be produced by a language model in Phase 4. Predicate
   * ids are looked up in a reviewed code registry, so the schema restricts them
   * to a conservative identifier pattern rather than accepting arbitrary text
   * that might be an attempt to smuggle an expression through.
   */
  it('refuses anything expression-shaped as a predicate id', () => {
    for (const predicateId of [
      '() => true',
      'require("fs")',
      'a; drop table',
      'eval(1)',
      '../escape',
      '',
    ]) {
      const rule = { ...validRule(), condition: { predicateId } };
      expect(safeParseScoringRule(asJson(rule)).ok, predicateId).toBe(false);
    }
  });

  it('rejects an unknown trigger event', () => {
    const rule = { ...validRule(), trigger: { event: 'SomethingInvented', filters: [] } };
    expect(safeParseScoringRule(asJson(rule)).ok).toBe(false);
  });

  it('rejects an unknown alliance target', () => {
    const rule = { ...validRule(), award: { points: explicit(5), alliance: 'green' } };
    expect(safeParseScoringRule(asJson(rule)).ok).toBe(false);
  });

  it('requires provenance on the award', () => {
    const rule = { ...validRule(), award: { points: 5, alliance: 'owner' } };
    expect(safeParseScoringRule(asJson(rule)).ok).toBe(false);
  });

  it('strips unknown keys rather than passing them through', () => {
    const result = safeParseScoringRule(asJson({ ...validRule(), sneaky: 'payload' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.value)).not.toContain('sneaky');
  });
});

describe('objective schema', () => {
  it('accepts a well-formed objective', () => {
    expect(safeParseObjective(asJson(validObjective())).ok).toBe(true);
  });

  it('accepts an optional cycle estimate', () => {
    const withCycle = { ...validObjective(), estimatedCycleSec: explicit(4) };
    expect(safeParseObjective(asJson(withCycle)).ok).toBe(true);
  });

  /** Objectives reference capability kinds, never mechanism type names. */
  it('rejects a capability that is not in the capability model', () => {
    const bad = { ...validObjective(), requiredCapabilities: ['shooter'] };
    expect(safeParseObjective(asJson(bad)).ok).toBe(false);
  });

  it('accepts an objective requiring nothing', () => {
    const free = { ...validObjective(), id: 'park', requiredCapabilities: [] };
    expect(safeParseObjective(asJson(free)).ok).toBe(true);
  });

  it('requires the repeatable flag to be explicit', () => {
    const { repeatable: _omit, ...withoutFlag } = validObjective();
    expect(safeParseObjective(asJson(withoutFlag)).ok).toBe(false);
  });
});

describe('provenance gating', () => {
  it('marks estimates and gaps as needing review', () => {
    expect(isReviewRequired('assumed')).toBe(true);
    expect(isReviewRequired('unknown')).toBe(true);
    expect(isReviewRequired('explicit')).toBe(false);
    expect(isReviewRequired('inferred')).toBe(false);
  });

  it('accepts any confidence level on a parsed value', () => {
    for (const confidence of ['explicit', 'inferred', 'assumed', 'unknown'] as const) {
      const rule = {
        ...validRule(),
        award: { points: { value: 5, confidence, note: 'x' }, alliance: 'owner' },
      };
      expect(safeParseScoringRule(asJson(rule)).ok, confidence).toBe(true);
    }
  });
});

/**
 * The validator has to be able to express the definitions this repository
 * already ships, or it is validating something else.
 *
 * It could not. `simEventKindSchema` was a hand-written copy of the event union
 * that had drifted out of date, and the filter field was a bare identifier where
 * `readEventField` reads dotted paths. Between them they rejected 46 of DECODE's
 * 54 rules — every end-of-period rule the game has. This is the guard.
 */
describe('regression — the schema accepts the shipped DECODE rule set', () => {
  it('parses every DECODE scoring rule', () => {
    const rejected = DECODE_SCORING_RULES.filter((rule) => !safeParseScoringRule(rule).ok).map(
      (rule) => rule.id,
    );

    expect(rejected).toEqual([]);
    expect(DECODE_SCORING_RULES.length).toBeGreaterThan(50);
  });

  it('accepts every event kind the engine can emit', () => {
    for (const kind of SIM_EVENT_KINDS) {
      const rule = {
        id: 'probe',
        label: 'probe',
        phase: 'ANY',
        trigger: { event: kind, filters: [] },
        award: { points: explicit(1), alliance: 'owner' },
      };
      expect(safeParseScoringRule(rule).ok, kind).toBe(true);
    }
  });

  it('accepts a dotted event field path and still rejects nonsense', () => {
    const withField = (field: string) => ({
      id: 'probe',
      label: 'probe',
      phase: 'ANY' as const,
      trigger: { event: 'PieceCameToRest' as const, filters: [{ field, equals: 'x' }] },
      award: { points: explicit(1), alliance: 'owner' as const },
    });

    expect(safeParseScoringRule(withField('regionIds.0')).ok).toBe(true);
    expect(safeParseScoringRule(withField('pieceType')).ok).toBe(true);
    expect(safeParseScoringRule(withField('a..b')).ok).toBe(false);
    // A generated definition must not be able to address the prototype chain.
    expect(safeParseScoringRule(withField('constructor.prototype')).ok).toBe(false);
    expect(safeParseScoringRule(withField('__proto__')).ok).toBe(false);
  });
});
