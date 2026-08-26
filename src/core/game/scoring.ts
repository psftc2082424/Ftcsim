/**
 * Objective and scoring-rule types (ARCHITECTURE.md §6.4).
 *
 * Two separate ideas, deliberately not merged:
 *
 *   **Objectives** are strategic: things worth points, what they are worth, and
 *   which capabilities a robot needs to pursue them. They are what the archetype
 *   generator reasons over in Phase 5 — "what is worth building for?"
 *
 *   **Scoring rules** are mechanical: which simulated event awards which points
 *   under which conditions. They are what the rules engine evaluates.
 *
 * ── Rules are data, never code ────────────────────────────────────────────
 *
 * A condition is a `PredicateRef` — an identifier into a TypeScript registry —
 * not an expression to evaluate. A `GameDefinition` may be produced by a
 * language model from a PDF; letting it carry executable code would put
 * model output on the execution path and destroy determinism at the same time.
 * The registry is the audited escape hatch.
 *
 * This module is types only. The registry, the engine and the event stream are
 * not part of this chunk.
 */

import type { CapabilityKind } from '../mechanism/capability.js';
import type { SimEventKind } from './events.js';
import type { PhaseId } from './matchStructure.js';
import type { Sourced } from './sourced.js';

/** A phase scope, or every scoring phase. */
export type PhaseScope = PhaseId | 'ANY';

/**
 * Facts the physics layer emits. Rules consume these; physics never computes
 * score itself (ARCHITECTURE.md §3.2).
 *
 * Defined alongside the event payloads in `events.ts` so the vocabulary a rule
 * may reference and the events actually emitted cannot drift apart. Re-exported
 * here because a rule's trigger is the main place it is written down.
 */
export type { SimEventKind } from './events.js';

export type FilterValue = string | number | boolean;

/** Narrows which instances of an event a rule responds to. */
export interface RuleFilter {
  /** Field on the event payload, e.g. `regionId` or `pieceType`. */
  readonly field: string;
  readonly equals: FilterValue;
}

export interface ScoringTrigger {
  readonly event: SimEventKind;
  readonly filters: readonly RuleFilter[];
}

/**
 * Reference to a named predicate implemented in TypeScript.
 *
 * Never an expression, never source text. If a game needs a condition the
 * declarative filters cannot express, the predicate is written and reviewed in
 * the codebase and referenced here by id.
 */
export interface PredicateRef {
  readonly predicateId: string;
  readonly params?: Readonly<Record<string, FilterValue>> | undefined;
}

/**
 * Whose score moves.
 *
 * `owner` is the alliance that caused the event. `opponent` is the other one,
 * which is how every FTC season scores a foul: the manual credits points "towards
 * the opponent's MATCH point total" rather than deducting them from the
 * violator, and those are different numbers once a tiebreak looks at either
 * alliance's own score.
 */
export type AllianceTarget = 'owner' | 'opponent' | 'red' | 'blue';

export interface ScoringAward {
  readonly points: Sourced<number>;
  readonly alliance: AllianceTarget;
}

export interface ScoringRule {
  readonly id: string;
  readonly label: string;
  readonly phase: PhaseScope;
  readonly trigger: ScoringTrigger;
  /** Optional extra condition beyond the trigger's filters. */
  readonly condition?: PredicateRef | undefined;
  readonly award: ScoringAward;
  /**
   * Award at most once for any given game piece. Models "a piece scores once,
   * however many times it re-enters the goal".
   */
  readonly oncePerPiece?: boolean | undefined;
  /** Cap on total awards from this rule in a match. */
  readonly maxAwards?: number | undefined;
  /**
   * Ranking-point criteria this rule's awards count toward.
   *
   * FTC ranking points are measured over *subsets* of a match score — DECODE's
   * MOVEMENT RP is "combined LEAVE + BASE points", its GOAL RP "the number of
   * ARTIFACTS scored through the SQUARE" — and nothing in a score breakdown says
   * which awards belong to which subset. Naming the criteria here puts that
   * where the rule is, so `rankingPointTotals` can measure them without the
   * engine matching rule ids by shape or knowing what a RAMP is.
   */
  readonly contributesTo?: readonly string[] | undefined;
}

/**
 * Something worth doing, in strategic terms.
 *
 * `requiredCapabilities` is what ties objectives to the capability model: an
 * objective is reachable by a robot only if the robot declares the capabilities
 * it needs. That is the link the archetype generator will follow, and it is why
 * neither side names a mechanism type.
 */
export interface Objective {
  readonly id: string;
  readonly label: string;
  readonly phase: PhaseScope;
  readonly pointValue: Sourced<number>;
  readonly requiredCapabilities: readonly CapabilityKind[];
  /** Whether the objective can be completed more than once in a match. */
  readonly repeatable: boolean;
  /** Rough seconds to complete once, when the manual or geometry implies it. */
  readonly estimatedCycleSec?: Sourced<number> | undefined;
  readonly notes?: string | undefined;
}

/** Objectives a robot with these capabilities could pursue at all. */
export function objectivesReachableBy(
  objectives: readonly Objective[],
  capabilities: readonly CapabilityKind[],
): readonly Objective[] {
  const available = new Set(capabilities);
  return objectives.filter((objective) =>
    objective.requiredCapabilities.every((required) => available.has(required)),
  );
}

/** Capabilities an objective needs that a robot does not have. */
export function missingCapabilitiesFor(
  objective: Objective,
  capabilities: readonly CapabilityKind[],
): readonly CapabilityKind[] {
  const available = new Set(capabilities);
  return objective.requiredCapabilities.filter((required) => !available.has(required));
}

/**
 * Maximum points a rule can contribute in one match, where that is bounded.
 * Returns `null` for an unbounded rule, which is the common case for repeatable
 * cycle scoring.
 */
export function maxContributionOf(rule: ScoringRule): number | null {
  if (rule.maxAwards === undefined) return null;
  return rule.maxAwards * rule.award.points.value;
}
