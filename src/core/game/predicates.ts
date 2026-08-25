/**
 * Predicate registry.
 *
 * The audited escape hatch for conditions the declarative filters cannot express
 * — "the artifacts on this ramp spell the motif", "this robot is fully supported
 * by the base tile".
 *
 * ── The security property ──────────────────────────────────────────────────
 *
 * A GameDefinition is data, and in Phase 4 it will be produced by a language
 * model reading a PDF. A rule's `condition` is therefore an **identifier**, not
 * an expression. Resolution is a `Map` lookup against predicates written and
 * reviewed in this repository.
 *
 * There is no `eval`, no `new Function`, no dynamic `import()`, and no template
 * that becomes code. An unknown id is a hard error rather than a silent skip:
 * silently ignoring an unresolvable condition would turn a typo into free
 * points, which is precisely the failure mode a generated definition is prone
 * to.
 *
 * Predicates must be **pure and deterministic**. They receive a frozen context
 * and return a boolean. Anything stateful belongs in the world, not here.
 */

import type { SimEvent } from './events.js';
import type { FilterValue, PredicateRef } from './scoring.js';
import type { MatchState } from './matchStructure.js';

/** Read-only view of the world a predicate is allowed to see. */
export interface PredicateContext {
  readonly event: SimEvent;
  readonly matchState: MatchState;
  /**
   * Ordered contents of each sequenced region, by region id. A slot holds a
   * piece type id, or `null` when empty.
   */
  readonly regionSlots: Readonly<Record<string, readonly (string | null)[]>>;
  /** Pieces currently at rest in each region, by region id. */
  readonly regionContents: Readonly<Record<string, readonly string[]>>;
  /** Arbitrary per-match values a game needs, e.g. the randomised motif. */
  readonly variables: Readonly<Record<string, FilterValue>>;
  /** Robots whose support is entirely inside the named zone. */
  readonly robotsFullyInZone: Readonly<Record<string, readonly string[]>>;
  /** Robots partially inside the named zone. */
  readonly robotsPartiallyInZone: Readonly<Record<string, readonly string[]>>;
}

export type PredicateParams = Readonly<Record<string, FilterValue>>;

export type Predicate = (context: PredicateContext, params: PredicateParams) => boolean;

export class PredicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PredicateError';
  }
}

/** Identifier shape accepted for predicate ids. Mirrors the schema. */
const IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export class PredicateRegistry {
  private readonly predicates = new Map<string, Predicate>();

  register(id: string, predicate: Predicate): this {
    if (!IDENTIFIER.test(id)) {
      throw new PredicateError(`Predicate id "${id}" is not a valid identifier.`);
    }
    if (this.predicates.has(id)) {
      throw new PredicateError(`Predicate "${id}" is already registered.`);
    }
    this.predicates.set(id, predicate);
    return this;
  }

  has(id: string): boolean {
    return this.predicates.has(id);
  }

  ids(): readonly string[] {
    return [...this.predicates.keys()].sort();
  }

  /**
   * Evaluate a reference.
   *
   * An unresolvable id throws. A GameDefinition citing a predicate this build
   * does not have is a definition that cannot be scored correctly, and failing
   * loudly is the only safe response.
   */
  evaluate(ref: PredicateRef, context: PredicateContext): boolean {
    const predicate = this.predicates.get(ref.predicateId);
    if (predicate === undefined) {
      throw new PredicateError(
        `Unknown predicate "${ref.predicateId}". Registered: ${this.ids().join(', ') || '(none)'}.`,
      );
    }
    return predicate(context, ref.params ?? {});
  }

  /** Ids referenced by a set of rules that this registry cannot resolve. */
  missingFor(refs: readonly (PredicateRef | undefined)[]): readonly string[] {
    const missing = new Set<string>();
    for (const ref of refs) {
      if (ref !== undefined && !this.has(ref.predicateId)) missing.add(ref.predicateId);
    }
    return [...missing].sort();
  }
}

// ------------------------------------------------------------- built-ins ---

function readString(params: PredicateParams, key: string): string {
  const value = params[key];
  if (typeof value !== 'string') {
    throw new PredicateError(`Predicate parameter "${key}" must be a string.`);
  }
  return value;
}

function readNumber(params: PredicateParams, key: string): number {
  const value = params[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PredicateError(`Predicate parameter "${key}" must be a finite number.`);
  }
  return value;
}

/**
 * Built-in predicates.
 *
 * Deliberately general. `slotMatchesRepeatingPattern` expresses DECODE's motif
 * scoring, but it is written as "does slot *i* of an ordered region match a
 * repeating colour sequence?" — a question many games ask. The DECODE-specific
 * part (which sequence, which region) lives in the GameDefinition's parameters.
 */
export function createDefaultRegistry(): PredicateRegistry {
  const registry = new PredicateRegistry();

  /**
   * The piece in a given slot of an ordered region matches the corresponding
   * element of a repeating pattern.
   *
   * Params: `regionId`, `slotIndex`, `patternVariable` (a match variable holding
   * the pattern, e.g. "GPP"), and `pieceTypeForSymbol` prefix mapping is handled
   * by the definition using piece type ids equal to the symbols.
   */
  registry.register('slotMatchesRepeatingPattern', (context, params) => {
    const regionId = readString(params, 'regionId');
    const slotIndex = readNumber(params, 'slotIndex');
    const patternVariable = readString(params, 'patternVariable');

    const pattern = context.variables[patternVariable];
    if (typeof pattern !== 'string' || pattern.length === 0) return false;

    const slots = context.regionSlots[regionId];
    if (slots === undefined) return false;

    const occupant = slots[slotIndex];
    if (occupant === undefined || occupant === null) return false;

    // The pattern repeats to cover however many slots the region has.
    const expected = pattern[slotIndex % pattern.length];
    return occupant === expected;
  });

  /** A region holds at least `count` pieces. */
  registry.register('regionHoldsAtLeast', (context, params) => {
    const regionId = readString(params, 'regionId');
    const count = readNumber(params, 'count');
    return (context.regionContents[regionId]?.length ?? 0) >= count;
  });

  /** The triggering robot is entirely supported inside a zone. */
  registry.register('robotFullyInZone', (context, params) => {
    const zoneId = readString(params, 'zoneId');
    const robotId = robotIdOf(context.event);
    if (robotId === null) return false;
    return (context.robotsFullyInZone[zoneId] ?? []).includes(robotId);
  });

  /** The triggering robot is partly, but not entirely, supported inside a zone. */
  registry.register('robotPartiallyInZone', (context, params) => {
    const zoneId = readString(params, 'zoneId');
    const robotId = robotIdOf(context.event);
    if (robotId === null) return false;

    const fully = context.robotsFullyInZone[zoneId] ?? [];
    if (fully.includes(robotId)) return false;
    return (context.robotsPartiallyInZone[zoneId] ?? []).includes(robotId);
  });

  /** At least `count` robots of the triggering alliance are fully in a zone. */
  registry.register('alliedRobotsFullyInZone', (context, params) => {
    const zoneId = readString(params, 'zoneId');
    const count = readNumber(params, 'count');
    return (context.robotsFullyInZone[zoneId] ?? []).length >= count;
  });

  /** A named match variable equals a given value. */
  registry.register('variableEquals', (context, params) => {
    const name = readString(params, 'name');
    return context.variables[name] === params['value'];
  });

  return registry;
}

function robotIdOf(event: SimEvent): string | null {
  return 'robotId' in event && typeof event.robotId === 'string' ? event.robotId : null;
}
