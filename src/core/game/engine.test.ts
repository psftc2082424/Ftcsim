import { describe, expect, it } from 'vitest';
import { MatchClock, phaseTransitions } from './matchClock.js';
import { PredicateError, PredicateRegistry, createDefaultRegistry } from './predicates.js';
import { createAwardState, evaluateRules, validateRuleSet } from './rulesEngine.js';
import {
  EMPTY_SCORE,
  applyScoreDeltas,
  assertNeverEffect,
  scoreBreakdown,
  type Effect,
} from './effects.js';
import { compareEvents, readEventField, type SimEvent } from './events.js';
import { DECODE_MATCH } from './fixtures/decode.js';
import { explicit } from './sourced.js';
import type { PredicateContext } from './predicates.js';
import type { MatchState } from './matchStructure.js';
import type { ScoringRule } from './scoring.js';

const DT = 1 / 200;

const pieceEvent = (regionId: string, pieceId = 'p1', tick = 10): SimEvent => ({
  kind: 'PieceEnteredRegion',
  tick,
  timeSec: tick * DT,
  pieceId,
  pieceType: 'G',
  regionId,
  byAlliance: 'red',
});

const emptyContext = (event: SimEvent): PredicateContext => ({
  event,
  matchState: 'AUTO',
  regionSlots: {},
  regionContents: {},
  variables: {},
  robotsFullyInZone: {},
  robotsPartiallyInZone: {},
});

const rule = (patch: Partial<ScoringRule> = {}): ScoringRule => ({
  id: 'test-rule',
  label: 'Test',
  phase: 'AUTO',
  trigger: { event: 'PieceEnteredRegion', filters: [{ field: 'regionId', equals: 'goal' }] },
  award: { points: explicit(5), alliance: 'owner' },
  ...patch,
});

// ============================================================== predicates ===

describe('predicate registry — safety', () => {
  /**
   * The security property the whole design rests on: a condition is an
   * identifier resolved by lookup, never text that becomes code. In Phase 4
   * these ids arrive from a language model.
   */
  it('rejects anything that is not a plain identifier', () => {
    const registry = new PredicateRegistry();
    for (const id of [
      '() => true',
      'require("fs")',
      'eval(1)',
      '../escape',
      'a b',
      '',
      '1startsWithDigit',
    ]) {
      expect(() => registry.register(id, () => true), id).toThrow(PredicateError);
    }
  });

  it('accepts conventional identifiers', () => {
    const registry = new PredicateRegistry();
    for (const id of ['simple', 'with_underscore', 'with-dash', 'camelCase42']) {
      expect(() => registry.register(id, () => true)).not.toThrow();
    }
  });

  /**
   * A definition citing a predicate this build lacks cannot be scored correctly.
   * Silently skipping it would turn a typo into free points, so it throws.
   */
  it('throws on an unknown predicate rather than skipping it', () => {
    const registry = createDefaultRegistry();
    expect(() =>
      registry.evaluate({ predicateId: 'notRegistered' }, emptyContext(pieceEvent('goal'))),
    ).toThrow(/Unknown predicate/);
  });

  it('refuses to shadow an existing predicate', () => {
    const registry = new PredicateRegistry();
    registry.register('dup', () => true);
    expect(() => registry.register('dup', () => false)).toThrow(/already registered/);
  });

  it('reports which referenced predicates it cannot resolve', () => {
    const registry = createDefaultRegistry();
    const missing = registry.missingFor([
      { predicateId: 'robotFullyInZone' },
      { predicateId: 'nope' },
      undefined,
      { predicateId: 'alsoMissing' },
    ]);
    expect(missing).toEqual(['alsoMissing', 'nope']);
  });

  it('validates parameter types instead of coercing them', () => {
    const registry = createDefaultRegistry();
    expect(() =>
      registry.evaluate(
        { predicateId: 'regionHoldsAtLeast', params: { regionId: 'r', count: 'three' } },
        emptyContext(pieceEvent('goal')),
      ),
    ).toThrow(/must be a finite number/);
  });
});

describe('built-in predicates', () => {
  const registry = createDefaultRegistry();

  it('matches a slot against a repeating pattern', () => {
    const context: PredicateContext = {
      ...emptyContext(pieceEvent('goal')),
      regionSlots: { ramp: ['G', 'P', 'P', 'G'] },
      variables: { motif: 'GPP' },
    };

    const check = (slotIndex: number): boolean =>
      registry.evaluate(
        {
          predicateId: 'slotMatchesRepeatingPattern',
          params: { regionId: 'ramp', slotIndex, patternVariable: 'motif' },
        },
        context,
      );

    // GPP repeating gives G P P G ...
    expect(check(0)).toBe(true);
    expect(check(1)).toBe(true);
    expect(check(2)).toBe(true);
    expect(check(3)).toBe(true);
  });

  it('reports a mismatched or empty slot as false', () => {
    const context: PredicateContext = {
      ...emptyContext(pieceEvent('goal')),
      regionSlots: { ramp: ['P', null] },
      variables: { motif: 'GPP' },
    };
    const check = (slotIndex: number): boolean =>
      registry.evaluate(
        {
          predicateId: 'slotMatchesRepeatingPattern',
          params: { regionId: 'ramp', slotIndex, patternVariable: 'motif' },
        },
        context,
      );

    expect(check(0)).toBe(false); // holds P, expects G
    expect(check(1)).toBe(false); // empty
    expect(check(9)).toBe(false); // beyond the region
  });

  it('distinguishes fully from partially occupied zones', () => {
    const context: PredicateContext = {
      ...emptyContext({
        kind: 'RobotOverlapsZone',
        tick: 1,
        timeSec: 0,
        robotId: 'r1',
        alliance: 'red',
        zoneId: 'base',
      }),
      robotsFullyInZone: { base: ['r1'] },
      robotsPartiallyInZone: { base: ['r2'] },
    };

    expect(
      registry.evaluate({ predicateId: 'robotFullyInZone', params: { zoneId: 'base' } }, context),
    ).toBe(true);
    // A fully-inside robot must not also count as partial.
    expect(
      registry.evaluate(
        { predicateId: 'robotPartiallyInZone', params: { zoneId: 'base' } },
        context,
      ),
    ).toBe(false);
  });

  describe('robotNotInZone', () => {
    /**
     * The inverse of the zone predicates, which a rule cannot express as "no
     * event fired". Written for DECODE's LEAVE — "no longer over any LAUNCH
     * LINE at the end of AUTO" (§10.5.3) — so it takes a *list* of zones.
     */
    const assessed = (robotId: string) =>
      ({
        kind: 'RobotAssessed',
        tick: 1,
        timeSec: 0,
        robotId,
        alliance: 'red',
      }) as const;

    const context = (robotId: string): PredicateContext => ({
      ...emptyContext(assessed(robotId)),
      robotsFullyInZone: { 'line-a': ['r1'] },
      robotsPartiallyInZone: { 'line-b': ['r2'] },
    });

    const check = (robotId: string, zoneIds: string): boolean =>
      registry.evaluate(
        { predicateId: 'robotNotInZone', params: { zoneIds } },
        context(robotId),
      );

    it('is true for a robot in none of the zones', () => {
      expect(check('r3', 'line-a,line-b')).toBe(true);
    });

    it('is false for a robot fully in one of them', () => {
      expect(check('r1', 'line-a,line-b')).toBe(false);
    });

    /** Partial support still counts as being in the zone. */
    it('is false for a robot partially in one of them', () => {
      expect(check('r2', 'line-a,line-b')).toBe(false);
    });

    /** The whole point of the list: a robot clear of one line but not another. */
    it('narrows to the zones it is given', () => {
      expect(check('r1', 'line-b')).toBe(true);
      expect(check('r1', 'line-a')).toBe(false);
    });

    it('tolerates whitespace around the delimiters', () => {
      expect(check('r1', ' line-a , line-b ')).toBe(false);
    });

    it('rejects an empty list rather than passing everything', () => {
      expect(() => check('r1', ' , ')).toThrow(/at least one id/);
    });

    /** An event with no robot cannot answer a question about a robot. */
    it('is false for an event that names no robot', () => {
      expect(
        registry.evaluate(
          { predicateId: 'robotNotInZone', params: { zoneIds: 'line-a' } },
          emptyContext(pieceEvent('goal')),
        ),
      ).toBe(false);
    });
  });

  it('counts allied robots in a zone', () => {
    const context: PredicateContext = {
      ...emptyContext(pieceEvent('goal')),
      robotsFullyInZone: { base: ['r1', 'r2'] },
    };
    const check = (count: number): boolean =>
      registry.evaluate(
        { predicateId: 'alliedRobotsFullyInZone', params: { zoneId: 'base', count } },
        context,
      );

    expect(check(2)).toBe(true);
    expect(check(3)).toBe(false);
  });
});

// ============================================================ rules engine ===

describe('rules engine — matching', () => {
  const registry = createDefaultRegistry();
  const evaluate = (
    rules: readonly ScoringRule[],
    event: SimEvent,
    matchState: MatchState = 'AUTO',
  ) =>
    evaluateRules({
      rules,
      event,
      matchState,
      registry,
      context: emptyContext(event),
      awards: createAwardState(),
    });

  it('awards when phase, event and filters all match', () => {
    const result = evaluate([rule()], pieceEvent('goal'));
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]?.points).toBe(5);
    expect(result.deltas[0]?.alliance).toBe('red');
  });

  it('does not award when the filter misses', () => {
    expect(evaluate([rule()], pieceEvent('elsewhere')).deltas).toHaveLength(0);
  });

  it('does not award outside the rule phase', () => {
    expect(evaluate([rule({ phase: 'AUTO' })], pieceEvent('goal'), 'TELEOP').deltas).toHaveLength(0);
  });

  it('does not award on a different event kind', () => {
    const other: SimEvent = {
      kind: 'PieceCameToRest',
      tick: 1,
      timeSec: 0,
      pieceId: 'p1',
      pieceType: 'G',
      regionIds: ['goal'],
    };
    expect(evaluate([rule()], other).deltas).toHaveLength(0);
  });

  it('treats a missing event field as a non-match rather than an error', () => {
    const withOddFilter = rule({
      trigger: { event: 'PieceEnteredRegion', filters: [{ field: 'nope.deep', equals: 'x' }] },
    });
    expect(() => evaluate([withOddFilter], pieceEvent('goal'))).not.toThrow();
    expect(evaluate([withOddFilter], pieceEvent('goal')).deltas).toHaveLength(0);
  });

  it('awards nobody when `owner` cannot be attributed', () => {
    const unattributed: SimEvent = {
      kind: 'PieceEnteredRegion',
      tick: 1,
      timeSec: 0,
      pieceId: 'p1',
      pieceType: 'G',
      regionId: 'goal',
    };
    expect(evaluate([rule()], unattributed).deltas).toHaveLength(0);
  });

  it('honours a fixed alliance target regardless of who caused the event', () => {
    const result = evaluate([rule({ award: { points: explicit(2), alliance: 'blue' } })], pieceEvent('goal'));
    expect(result.deltas[0]?.alliance).toBe('blue');
  });
});

describe('rules engine — award caps', () => {
  const registry = createDefaultRegistry();

  it('scores a piece once under oncePerPiece', () => {
    const awards = createAwardState();
    const rules = [rule({ oncePerPiece: true })];

    const run = (pieceId: string) =>
      evaluateRules({
        rules,
        event: pieceEvent('goal', pieceId),
        matchState: 'AUTO',
        registry,
        context: emptyContext(pieceEvent('goal', pieceId)),
        awards,
      });

    expect(run('p1').deltas).toHaveLength(1);
    expect(run('p1').deltas).toHaveLength(0);
    expect(run('p2').deltas).toHaveLength(1);
  });

  it('refuses oncePerPiece on an event carrying no piece', () => {
    const awards = createAwardState();
    const event: SimEvent = {
      kind: 'RobotOverlapsZone',
      tick: 1,
      timeSec: 0,
      robotId: 'r1',
      alliance: 'red',
      zoneId: 'base',
    };
    const result = evaluateRules({
      rules: [
        rule({
          oncePerPiece: true,
          trigger: { event: 'RobotOverlapsZone', filters: [] },
        }),
      ],
      event,
      matchState: 'AUTO',
      registry,
      context: emptyContext(event),
      awards,
    });

    expect(result.deltas).toHaveLength(0);
    expect(result.suppressed).toContain('test-rule');
  });

  it('stops awarding once maxAwards is reached', () => {
    const awards = createAwardState();
    const rules = [rule({ maxAwards: 2 })];
    const run = (n: number) =>
      evaluateRules({
        rules,
        event: pieceEvent('goal', `p${n}`),
        matchState: 'AUTO',
        registry,
        context: emptyContext(pieceEvent('goal', `p${n}`)),
        awards,
      });

    expect(run(1).deltas).toHaveLength(1);
    expect(run(2).deltas).toHaveLength(1);
    expect(run(3).deltas).toHaveLength(0);
    expect(run(4).suppressed).toContain('test-rule');
  });
});

describe('rules engine — rule set validation', () => {
  const registry = createDefaultRegistry();

  it('accepts a sound rule set', () => {
    expect(validateRuleSet([rule()], registry)).toEqual([]);
  });

  it('reports duplicate ids', () => {
    const problems = validateRuleSet([rule(), rule()], registry);
    expect(problems[0]?.message).toMatch(/Duplicate rule id/);
  });

  it('reports an unresolvable predicate before the match starts', () => {
    const problems = validateRuleSet([rule({ condition: { predicateId: 'ghost' } })], registry);
    expect(problems[0]?.message).toMatch(/unknown predicate "ghost"/i);
  });

  it('reports oncePerPiece on a trigger with no piece', () => {
    const problems = validateRuleSet(
      [rule({ oncePerPiece: true, trigger: { event: 'RobotOverlapsZone', filters: [] } })],
      registry,
    );
    expect(problems[0]?.message).toMatch(/piece-bearing trigger/);
  });
});

// ================================================================= effects ===

describe('score state', () => {
  it('accumulates per alliance and keeps every delta', () => {
    const score = applyScoreDeltas(EMPTY_SCORE, [
      { alliance: 'red', points: 3, ruleId: 'a', label: 'A', tick: 1 },
      { alliance: 'blue', points: 5, ruleId: 'b', label: 'B', tick: 2 },
      { alliance: 'red', points: 2, ruleId: 'a', label: 'A', tick: 3 },
    ]);

    expect(score.red).toBe(5);
    expect(score.blue).toBe(5);
    expect(score.deltas).toHaveLength(3);
  });

  it('returns the same object when there is nothing to apply', () => {
    expect(applyScoreDeltas(EMPTY_SCORE, [])).toBe(EMPTY_SCORE);
  });

  it('breaks the score down by rule, summing to the total', () => {
    const score = applyScoreDeltas(EMPTY_SCORE, [
      { alliance: 'red', points: 3, ruleId: 'leave', label: 'L', tick: 1 },
      { alliance: 'red', points: 3, ruleId: 'goal', label: 'G', tick: 2 },
      { alliance: 'red', points: 3, ruleId: 'goal', label: 'G', tick: 3 },
      { alliance: 'blue', points: 9, ruleId: 'goal', label: 'G', tick: 4 },
    ]);

    const red = scoreBreakdown(score, 'red');
    expect(red).toEqual({ leave: 3, goal: 6 });
    expect(Object.values(red).reduce((a, b) => a + b, 0)).toBe(score.red);
  });

  it('refuses an unhandled effect variant loudly', () => {
    const rogue = { kind: 'notARealEffect' } as unknown as never;
    expect(() => assertNeverEffect(rogue)).toThrow(/Unhandled effect/);
  });

  it('keeps the Effect union serialisable', () => {
    const effects: Effect[] = [
      { kind: 'consumePiece', pieceId: 'p1' },
      { kind: 'setPieceRegion', pieceId: 'p1', regionId: 'ramp', slotIndex: 2 },
      { kind: 'setVariable', name: 'motif', value: 'GPP' },
    ];
    expect(JSON.parse(JSON.stringify(effects))).toEqual(effects);
  });
});

// ============================================================= match clock ===

describe('match clock', () => {
  it('derives time from ticks, never a wall clock', () => {
    const clock = new MatchClock({ structure: DECODE_MATCH, dtSec: DT });
    for (let i = 0; i < 200; i++) clock.advance();
    expect(clock.tick).toBe(200);
    expect(clock.timeSec).toBeCloseTo(1, 9);
  });

  it('rejects a non-positive timestep', () => {
    expect(() => new MatchClock({ structure: DECODE_MATCH, dtSec: 0 })).toThrow(/positive/);
  });

  it('emits a transition only on the tick the phase changes', () => {
    const transitions = phaseTransitions(DECODE_MATCH, DT);
    expect(transitions.map((t) => `${t.from}->${t.to}`)).toEqual([
      'AUTO->PRE', // the 8 s scoring gap
      'PRE->TELEOP',
      'TELEOP->POST',
    ]);
  });

  it('places transitions at the manual-stated times', () => {
    const [toGap, toTeleop, toPost] = phaseTransitions(DECODE_MATCH, DT);
    expect(toGap?.timeSec).toBeCloseTo(30, 6);
    expect(toTeleop?.timeSec).toBeCloseTo(38, 6);
    expect(toPost?.timeSec).toBeCloseTo(158, 6);
  });

  it('reports running and finished states', () => {
    const clock = new MatchClock({ structure: DECODE_MATCH, dtSec: DT });
    expect(clock.isRunning).toBe(true);

    while (!clock.isFinished) clock.advance();
    expect(clock.isRunning).toBe(false);
    expect(clock.remainingSec).toBe(0);
  });

  it('resets to the start', () => {
    const clock = new MatchClock({ structure: DECODE_MATCH, dtSec: DT });
    for (let i = 0; i < 10_000; i++) clock.advance();
    clock.reset();
    expect(clock.tick).toBe(0);
    expect(clock.currentState).toBe('AUTO');
  });

  it('produces identical transitions on every run', () => {
    const a = JSON.stringify(phaseTransitions(DECODE_MATCH, DT));
    const b = JSON.stringify(phaseTransitions(DECODE_MATCH, DT));
    expect(a).toBe(b);
  });
});

// ================================================================== events ===

describe('event helpers', () => {
  it('reads nested fields by dotted path', () => {
    const event: SimEvent = {
      kind: 'PieceCameToRest',
      tick: 1,
      timeSec: 0,
      pieceId: 'p1',
      pieceType: 'G',
      regionIds: ['depot', 'ramp'],
    };

    expect(readEventField(event, 'pieceType')).toBe('G');
    expect(readEventField(event, 'regionIds.0')).toBe('depot');
    expect(readEventField(event, 'missing')).toBeUndefined();
    expect(readEventField(event, 'missing.deeper')).toBeUndefined();
  });

  it('orders events deterministically for replay', () => {
    const later = pieceEvent('goal', 'p1', 20);
    const earlier = pieceEvent('goal', 'p2', 10);
    expect(compareEvents(earlier, later)).toBeLessThan(0);
    expect(compareEvents(later, earlier)).toBeGreaterThan(0);
    expect(compareEvents(earlier, earlier)).toBe(0);
  });
});
