import { describe, expect, it } from 'vitest';
import {
  isReviewRequired,
  safeParseMatchStructure,
  safeParseObjective,
  safeParseScoringRule,
} from './gameDefinition.schema.js';
import { FTC_CONVENTIONAL_MATCH, totalMatchDurationSec } from '../core/game/matchStructure.js';

const validMatch = (): unknown => JSON.parse(JSON.stringify(FTC_CONVENTIONAL_MATCH)) as unknown;

const validRule = (): unknown => ({
  id: 'low-goal',
  label: 'Low goal',
  phase: 'ANY',
  trigger: { event: 'PieceEnteredRegion', filters: [{ field: 'regionId', equals: 'low-goal' }] },
  award: { points: { value: 2, confidence: 'explicit', sourcePage: 40 }, alliance: 'owner' },
});

const validObjective = (): unknown => ({
  id: 'score-high',
  label: 'Score in the high goal',
  phase: 'ANY',
  pointValue: { value: 6, confidence: 'explicit' },
  requiredCapabilities: ['acquire', 'release', 'elevate'],
  repeatable: true,
});

describe('match structure schema', () => {
  it('accepts the conventional FTC match', () => {
    const result = safeParseMatchStructure(validMatch());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(totalMatchDurationSec(result.value)).toBe(150);
  });

  /**
   * The rule the type system cannot enforce: endgame is positioned inside
   * teleop, so a threshold longer than teleop is incoherent rather than merely
   * unusual.
   */
  it('rejects an endgame longer than teleop itself', () => {
    const base = validMatch() as { periods: [unknown, { subPhases: [{ startsAtRemainingSec: { value: number } }] }] };
    base.periods[1].subPhases[0].startsAtRemainingSec.value = 200;

    const result = safeParseMatchStructure(base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toMatch(/sub-phase of teleop, not an additional period/);
  });

  it('accepts an endgame exactly as long as teleop', () => {
    const base = validMatch() as { periods: [unknown, { durationSec: { value: number }; subPhases: [{ startsAtRemainingSec: { value: number } }] }] };
    base.periods[1].subPhases[0].startsAtRemainingSec.value = base.periods[1].durationSec.value;
    expect(safeParseMatchStructure(base).ok).toBe(true);
  });

  it('requires provenance on every duration', () => {
    const noConfidence = {
      periods: [
        { id: 'AUTO', durationSec: { value: 30 } },
        {
          id: 'TELEOP',
          durationSec: { value: 120, confidence: 'explicit' },
          subPhases: [{ id: 'ENDGAME', startsAtRemainingSec: { value: 30, confidence: 'explicit' } }],
        },
      ],
    };
    const result = safeParseMatchStructure(noConfidence);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path.includes('confidence'))).toBe(true);
  });

  it('rejects a bare number where a Sourced value belongs', () => {
    const bare = {
      periods: [
        { id: 'AUTO', durationSec: 30 },
        {
          id: 'TELEOP',
          durationSec: { value: 120, confidence: 'explicit' },
          subPhases: [{ id: 'ENDGAME', startsAtRemainingSec: { value: 30, confidence: 'explicit' } }],
        },
      ],
    };
    expect(safeParseMatchStructure(bare).ok).toBe(false);
  });

  it('rejects a third period', () => {
    const threePeriods = {
      ...(validMatch() as object),
      periods: [
        ...((validMatch() as { periods: unknown[] }).periods),
        { id: 'ENDGAME', durationSec: { value: 30, confidence: 'explicit' } },
      ],
    };
    expect(safeParseMatchStructure(threePeriods).ok).toBe(false);
  });

  it('rejects an unknown confidence level', () => {
    const base = validMatch() as { periods: [{ durationSec: { confidence: string } }, unknown] };
    base.periods[0].durationSec.confidence = 'probably';
    expect(safeParseMatchStructure(base).ok).toBe(false);
  });
});

describe('scoring rule schema', () => {
  it('accepts a well-formed rule', () => {
    expect(safeParseScoringRule(validRule()).ok).toBe(true);
  });

  it('accepts a rule with a registry predicate', () => {
    const withCondition = { ...(validRule() as object), condition: { predicateId: 'supportedByGoal' } };
    expect(safeParseScoringRule(withCondition).ok).toBe(true);
  });

  /**
   * A GameDefinition may be produced by a language model from a PDF. Nothing in
   * it may be executable, so predicate ids are constrained to a conservative
   * identifier pattern rather than free text.
   */
  it('rejects a predicate id that looks like an expression', () => {
    for (const hostile of [
      'score > 5',
      'require("fs")',
      '() => true',
      'a;b',
      'eval(1)',
      '__proto__.x',
    ]) {
      const rule = { ...(validRule() as object), condition: { predicateId: hostile } };
      expect(safeParseScoringRule(rule).ok, hostile).toBe(false);
    }
  });

  it('strips unknown keys rather than passing them through', () => {
    const smuggled = { ...(validRule() as object), evaluate: 'return true', __proto__unsafe: 1 };
    const result = safeParseScoringRule(smuggled);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value)).not.toContain('evaluate');
  });

  it('rejects an unknown event kind', () => {
    const rule = validRule() as { trigger: { event: string } };
    rule.trigger.event = 'PieceTeleported';
    expect(safeParseScoringRule(rule).ok).toBe(false);
  });

  it('rejects a malformed award', () => {
    const noAlliance = validRule() as { award: { alliance?: string } };
    delete noAlliance.award.alliance;
    expect(safeParseScoringRule(noAlliance).ok).toBe(false);
  });

  it('reports the path of a failure', () => {
    const rule = validRule() as { award: { points: { value: unknown } } };
    rule.award.points.value = 'two';
    const result = safeParseScoringRule(rule);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path).toBe('award.points.value');
  });
});

describe('objective schema', () => {
  it('accepts a well-formed objective', () => {
    expect(safeParseObjective(validObjective()).ok).toBe(true);
  });

  it('rejects a capability that is not in the capability model', () => {
    const objective = validObjective() as { requiredCapabilities: string[] };
    objective.requiredCapabilities = ['acquire', 'teleport'];
    expect(safeParseObjective(objective).ok).toBe(false);
  });

  it('accepts an objective needing no capabilities', () => {
    const objective = validObjective() as { requiredCapabilities: string[] };
    objective.requiredCapabilities = [];
    expect(safeParseObjective(objective).ok).toBe(true);
  });

  it('requires provenance on the point value', () => {
    const objective = validObjective() as { pointValue: unknown };
    objective.pointValue = 6;
    expect(safeParseObjective(objective).ok).toBe(false);
  });
});

describe('review triage', () => {
  it('flags assumed and unknown values for human review', () => {
    expect(isReviewRequired('assumed')).toBe(true);
    expect(isReviewRequired('unknown')).toBe(true);
    expect(isReviewRequired('explicit')).toBe(false);
    expect(isReviewRequired('inferred')).toBe(false);
  });
});
