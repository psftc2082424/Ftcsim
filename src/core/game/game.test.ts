import { describe, expect, it } from 'vitest';
import {
  assumed,
  describeSource,
  explicit,
  inferred,
  isTrustworthy,
  needsReview,
  unresolved,
  valueOf,
} from './sourced.js';
import {
  FTC_CONVENTIONAL_MATCH,
  endgameStartSec,
  isWithinPhase,
  matchStateAt,
  matchTimeline,
  teleopStartSec,
  totalMatchDurationSec,
  type MatchStructure,
} from './matchStructure.js';
import {
  maxContributionOf,
  missingCapabilitiesFor,
  objectivesReachableBy,
  type Objective,
  type ScoringRule,
} from './scoring.js';

describe('Sourced provenance', () => {
  it('records where an explicit value came from', () => {
    const s = explicit(30, 12, 'the Autonomous Period is 30 seconds');
    expect(s.value).toBe(30);
    expect(s.confidence).toBe('explicit');
    expect(s.sourcePage).toBe(12);
    expect(isTrustworthy(s)).toBe(true);
  });

  it('treats inferred as trustworthy but assumed and unknown as needing review', () => {
    expect(isTrustworthy(inferred(24, 'measured off the field diagram', 8))).toBe(true);
    expect(needsReview(assumed(5, 'no figure given; typical for this class of goal'))).toBe(true);
    expect(needsReview(unresolved(0, 'the manual never states this'))).toBe(true);
  });

  /**
   * `unknown` still carries a value because the simulation needs one to run. It
   * means "this is a stand-in a human must replace", which is weaker than
   * `assumed` — not the absence of a number.
   */
  it('carries a placeholder for an unresolved value', () => {
    const s = unresolved(1, 'cannot be determined from the manual');
    expect(s.value).toBe(1);
    expect(s.confidence).toBe('unknown');
    expect(valueOf(s)).toBe(1);
  });

  it('describes provenance readably', () => {
    expect(describeSource(explicit(30, 12))).toBe('explicit — p.12');
    expect(describeSource(assumed(5, 'typical'))).toBe('assumed — typical');
  });
});

describe('match structure — endgame is inside teleop', () => {
  const match = FTC_CONVENTIONAL_MATCH;

  /** The whole point of the module. 30 + 120 = 150, not 180. */
  it('does not let endgame extend the match', () => {
    expect(totalMatchDurationSec(match)).toBe(150);
  });

  it('places teleop and endgame at the right absolute times', () => {
    expect(teleopStartSec(match)).toBe(30);
    // Endgame is the final 30 s of a 120 s teleop, so it begins at 30 + 90.
    expect(endgameStartSec(match)).toBe(120);
  });

  it('tiles the match exactly once with no gaps or overlaps', () => {
    const windows = matchTimeline(match);
    expect(windows.map((w) => w.phase)).toEqual(['AUTO', 'TELEOP', 'ENDGAME']);

    expect(windows[0]?.startSec).toBe(0);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]?.startSec).toBe(windows[i - 1]?.endSec);
    }
    expect(windows[windows.length - 1]?.endSec).toBe(totalMatchDurationSec(match));
  });

  it('reports the right state across the whole match', () => {
    const cases: Array<[number, string]> = [
      [-1, 'PRE'],
      [0, 'AUTO'],
      [29.9, 'AUTO'],
      [30, 'TELEOP'],
      [119.9, 'TELEOP'],
      [120, 'ENDGAME'],
      [149.9, 'ENDGAME'],
      [150, 'POST'],
    ];
    for (const [time, expected] of cases) {
      expect(matchStateAt(match, time), `at t=${time}`).toBe(expected);
    }
  });

  it('accounts for a transition gap without changing endgame length', () => {
    const withTransition: MatchStructure = {
      ...match,
      transitionSec: explicit(8),
    };
    expect(totalMatchDurationSec(withTransition)).toBe(158);
    expect(teleopStartSec(withTransition)).toBe(38);
    expect(endgameStartSec(withTransition)).toBe(128);
    // Endgame is still 30 s long, just later.
    expect(totalMatchDurationSec(withTransition) - endgameStartSec(withTransition)).toBe(30);
  });

  it('clamps a nonsensical endgame threshold instead of producing garbage', () => {
    // The schema rejects this, but the derivation must stay sane regardless.
    const broken: MatchStructure = {
      periods: [
        match.periods[0],
        { ...match.periods[1], subPhases: [{ id: 'ENDGAME', startsAtRemainingSec: explicit(500) }] },
      ],
    };
    expect(endgameStartSec(broken)).toBe(teleopStartSec(broken));
    expect(totalMatchDurationSec(broken)).toBe(150);
  });

  it('omits an empty teleop window when endgame covers all of teleop', () => {
    const allEndgame: MatchStructure = {
      periods: [
        match.periods[0],
        { ...match.periods[1], subPhases: [{ id: 'ENDGAME', startsAtRemainingSec: explicit(120) }] },
      ],
    };
    expect(matchTimeline(allEndgame).map((w) => w.phase)).toEqual(['AUTO', 'ENDGAME']);
  });

  it('marks the conventional timings as assumed, not explicit', () => {
    // These are rules that vary by season; claiming otherwise would be exactly
    // the silent invention PRODUCT_SPEC.md §3 forbids.
    expect(match.periods[0].durationSec.confidence).toBe('assumed');
    expect(match.periods[1].durationSec.confidence).toBe('assumed');
    expect(match.periods[1].subPhases[0].startsAtRemainingSec.confidence).toBe('assumed');
  });
});

describe('phase scoping — endgame counts as teleop', () => {
  /**
   * The asymmetry that makes the sub-phase model correct: a teleop rule keeps
   * scoring during endgame, but an endgame rule does not fire earlier.
   */
  it('applies a TELEOP-scoped rule during endgame', () => {
    expect(isWithinPhase('ENDGAME', 'TELEOP')).toBe(true);
    expect(isWithinPhase('TELEOP', 'TELEOP')).toBe(true);
  });

  it('does not apply an ENDGAME-scoped rule during ordinary teleop', () => {
    expect(isWithinPhase('TELEOP', 'ENDGAME')).toBe(false);
    expect(isWithinPhase('ENDGAME', 'ENDGAME')).toBe(true);
  });

  it('keeps autonomous separate', () => {
    expect(isWithinPhase('AUTO', 'AUTO')).toBe(true);
    expect(isWithinPhase('AUTO', 'TELEOP')).toBe(false);
    expect(isWithinPhase('TELEOP', 'AUTO')).toBe(false);
  });

  it('scores nothing outside the match', () => {
    for (const phase of ['AUTO', 'TELEOP', 'ENDGAME', 'ANY'] as const) {
      expect(isWithinPhase('PRE', phase)).toBe(false);
      expect(isWithinPhase('POST', phase)).toBe(false);
    }
  });

  it('applies an ANY-scoped rule in every scoring phase', () => {
    for (const state of ['AUTO', 'TELEOP', 'ENDGAME'] as const) {
      expect(isWithinPhase(state, 'ANY')).toBe(true);
    }
  });
});

describe('objectives and capabilities', () => {
  const objectives: readonly Objective[] = [
    {
      id: 'score-low',
      label: 'Score in the low goal',
      phase: 'ANY',
      pointValue: explicit(2, 40),
      requiredCapabilities: ['acquire', 'release'],
      repeatable: true,
    },
    {
      id: 'score-high',
      label: 'Score in the high goal',
      phase: 'ANY',
      pointValue: explicit(6, 40),
      requiredCapabilities: ['acquire', 'release', 'elevate'],
      repeatable: true,
    },
    {
      id: 'hang',
      label: 'Hang at endgame',
      phase: 'ENDGAME',
      pointValue: explicit(20, 42),
      requiredCapabilities: ['climb'],
      repeatable: false,
    },
  ];

  it('finds objectives a robot can actually pursue', () => {
    const reachable = objectivesReachableBy(objectives, ['acquire', 'release']);
    expect(reachable.map((o) => o.id)).toEqual(['score-low']);
  });

  it('unlocks more objectives as capabilities are added', () => {
    const withLift = objectivesReachableBy(objectives, ['acquire', 'release', 'elevate']);
    expect(withLift.map((o) => o.id)).toEqual(['score-low', 'score-high']);
  });

  it('reports exactly what a robot is missing', () => {
    const highGoal = objectives[1] as Objective;
    expect(missingCapabilitiesFor(highGoal, ['acquire', 'release'])).toEqual(['elevate']);
    expect(missingCapabilitiesFor(highGoal, ['acquire', 'release', 'elevate'])).toEqual([]);
  });

  it('returns nothing for a robot with no capabilities', () => {
    expect(objectivesReachableBy(objectives, [])).toEqual([]);
  });
});

describe('scoring rules', () => {
  const rule = (patch: Partial<ScoringRule> = {}): ScoringRule => ({
    id: 'low-goal',
    label: 'Low goal',
    phase: 'ANY',
    trigger: { event: 'PieceEnteredRegion', filters: [{ field: 'regionId', equals: 'low-goal' }] },
    award: { points: explicit(2, 40), alliance: 'owner' },
    ...patch,
  });

  it('bounds a capped rule and leaves a repeatable one unbounded', () => {
    expect(maxContributionOf(rule({ maxAwards: 5 }))).toBe(10);
    expect(maxContributionOf(rule())).toBeNull();
  });

  /**
   * Conditions are identifiers into a code registry, never expressions. A
   * GameDefinition may come from a language model reading a PDF; executable
   * content in it would be both a security hole and a determinism hazard.
   */
  it('expresses a condition as a registry reference, not code', () => {
    const conditional = rule({ condition: { predicateId: 'supportedByGoal' } });
    expect(conditional.condition?.predicateId).toBe('supportedByGoal');
    expect(typeof conditional.condition?.predicateId).toBe('string');
  });
});
