/**
 * Declarative rules engine (ARCHITECTURE.md §6.4).
 *
 * A pure function of `(rules, event, context) → { deltas, effects }`. It holds no
 * state, reads no clock, and touches nothing in the physics world. Everything
 * DECODE-specific lives in the rules it is handed; this file could score a
 * different season without a line changing.
 *
 * ── How a rule fires ───────────────────────────────────────────────────────
 *
 *   1. The rule's phase scope must include the current match state.
 *   2. The event kind must match the rule's trigger.
 *   3. Every filter must match a field on the event.
 *   4. The optional predicate must return true.
 *   5. Award caps (`oncePerPiece`, `maxAwards`) must not already be spent.
 *
 * All five are data except step 4, which is an id resolved against a reviewed
 * registry. There is no point at which text from a definition is executed.
 */

import { readEventField, type SimEvent } from './events.js';
import { isWithinPhase, type MatchState } from './matchStructure.js';
import type { PredicateContext, PredicateRegistry } from './predicates.js';
import type { RuleFilter, ScoringRule } from './scoring.js';
import type { Effect, ScoreDelta } from './effects.js';

/** Mutable bookkeeping the engine needs across a match. */
export interface RuleAwardState {
  /** Awards made per rule id, against `maxAwards`. */
  readonly awardCounts: Map<string, number>;
  /** `${ruleId}:${pieceId}` pairs already awarded, against `oncePerPiece`. */
  readonly awardedPieces: Set<string>;
}

export function createAwardState(): RuleAwardState {
  return { awardCounts: new Map(), awardedPieces: new Set() };
}

export interface RulesEvaluation {
  readonly deltas: readonly ScoreDelta[];
  readonly effects: readonly Effect[];
  /** Rules that matched but were blocked by a cap, for diagnostics. */
  readonly suppressed: readonly string[];
}

export interface EvaluateOptions {
  readonly rules: readonly ScoringRule[];
  readonly event: SimEvent;
  readonly matchState: MatchState;
  readonly registry: PredicateRegistry;
  readonly context: PredicateContext;
  readonly awards: RuleAwardState;
  /**
   * Effects a rule produces when it awards. Keyed by rule id and supplied by the
   * GameDefinition's host rather than embedded in the rule, so rule data stays
   * free of anything resembling behaviour.
   */
  readonly effectsForRule?: Readonly<Record<string, readonly Effect[]>> | undefined;
}

/** Does a single filter match this event? */
function filterMatches(event: SimEvent, filter: RuleFilter): boolean {
  const actual = readEventField(event, filter.field);
  // A field the event does not carry never matches, rather than erroring: a rule
  // watching for it simply does not apply to this event kind.
  if (actual === undefined) return false;
  return actual === filter.equals;
}

/** Which alliance an award goes to. */
function resolveAlliance(
  target: ScoringRule['award']['alliance'],
  event: SimEvent,
): 'red' | 'blue' | null {
  if (target === 'red' || target === 'blue') return target;

  // `owner` means whoever caused the event; an unattributable event awards
  // nobody rather than defaulting to a side.
  const alliance =
    ('alliance' in event ? event.alliance : undefined) ??
    ('byAlliance' in event ? event.byAlliance : undefined);

  return alliance === 'red' || alliance === 'blue' ? alliance : null;
}

function pieceIdOf(event: SimEvent): string | null {
  return 'pieceId' in event && typeof event.pieceId === 'string' ? event.pieceId : null;
}

/**
 * Evaluate every rule against one event.
 *
 * Rules are evaluated in the order given, and that order is part of the
 * GameDefinition. Award state is mutated as caps are consumed, so evaluating the
 * same event twice does not double-score a capped rule.
 */
export function evaluateRules(options: EvaluateOptions): RulesEvaluation {
  const { rules, event, matchState, registry, context, awards } = options;

  const deltas: ScoreDelta[] = [];
  const effects: Effect[] = [];
  const suppressed: string[] = [];

  for (const rule of rules) {
    if (!isWithinPhase(matchState, rule.phase)) continue;
    if (rule.trigger.event !== event.kind) continue;
    if (!rule.trigger.filters.every((filter) => filterMatches(event, filter))) continue;

    if (rule.condition !== undefined && !registry.evaluate(rule.condition, context)) continue;

    const alliance = resolveAlliance(rule.award.alliance, event);
    if (alliance === null) continue;

    // --- caps -------------------------------------------------------------
    const pieceId = pieceIdOf(event);
    if (rule.oncePerPiece === true) {
      if (pieceId === null) {
        // A once-per-piece rule triggered by an event with no piece cannot be
        // deduplicated, so it is refused rather than allowed to repeat freely.
        suppressed.push(rule.id);
        continue;
      }
      const key = `${rule.id}:${pieceId}`;
      if (awards.awardedPieces.has(key)) {
        suppressed.push(rule.id);
        continue;
      }
      awards.awardedPieces.add(key);
    }

    const used = awards.awardCounts.get(rule.id) ?? 0;
    if (rule.maxAwards !== undefined && used >= rule.maxAwards) {
      suppressed.push(rule.id);
      continue;
    }
    awards.awardCounts.set(rule.id, used + 1);

    // --- award ------------------------------------------------------------
    deltas.push({
      alliance,
      points: rule.award.points.value,
      ruleId: rule.id,
      label: rule.label,
      tick: event.tick,
    });

    const ruleEffects = options.effectsForRule?.[rule.id];
    if (ruleEffects !== undefined) effects.push(...ruleEffects);
  }

  return { deltas, effects, suppressed };
}

/**
 * Validate that a rule set can actually be scored by this build before a match
 * starts, rather than throwing partway through one.
 */
export interface RuleSetProblem {
  readonly ruleId: string;
  readonly message: string;
}

export function validateRuleSet(
  rules: readonly ScoringRule[],
  registry: PredicateRegistry,
): readonly RuleSetProblem[] {
  const problems: RuleSetProblem[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    if (seen.has(rule.id)) {
      problems.push({ ruleId: rule.id, message: `Duplicate rule id "${rule.id}".` });
    }
    seen.add(rule.id);

    if (rule.condition !== undefined && !registry.has(rule.condition.predicateId)) {
      problems.push({
        ruleId: rule.id,
        message: `References unknown predicate "${rule.condition.predicateId}".`,
      });
    }

    if (rule.oncePerPiece === true && !rule.trigger.event.startsWith('Piece')) {
      problems.push({
        ruleId: rule.id,
        message: `oncePerPiece needs a piece-bearing trigger, but this rule watches ${rule.trigger.event}.`,
      });
    }
  }

  return problems;
}
