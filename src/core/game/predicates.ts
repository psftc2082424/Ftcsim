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
  /**
   * Ids of the pieces currently in each region, by region id.
   *
   * **The event's own piece is already counted, in the region it entered.**
   * `MatchRunner` applies an event to world state before evaluating rules
   * against it, so a predicate reading this during a `PieceEnteredRegion` sees
   * the arriving piece in *that* region. A rule asking about a different region
   * — DECODE asks whether the RAMP has room while a piece is entering the GOAL
   * above it — sees the count before this piece arrives, which is exactly the
   * question a capacity check wants.
   */
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

/**
 * Read a plural parameter as a delimited list.
 *
 * `FilterValue` is deliberately scalar — `string | number | boolean` — so a
 * generated GameDefinition cannot smuggle structure through a predicate's
 * parameters. A rule that genuinely needs several ids therefore encodes them as
 * one comma-separated string, which stays inert data and stays reviewable.
 *
 * DECODE's LEAVE needs this: the criterion is "no longer over **any** LAUNCH
 * LINE" (§10.5.3), which names a set rather than a single zone.
 */
function readList(params: PredicateParams, key: string): readonly string[] {
  const value = params[key];
  if (typeof value !== 'string') {
    throw new PredicateError(`Predicate parameter "${key}" must be a string.`);
  }

  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (items.length === 0) {
    throw new PredicateError(`Predicate parameter "${key}" must name at least one id.`);
  }
  return items;
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

  /**
   * A region holds fewer than `count` pieces — it still has room.
   *
   * The exact complement of `regionHoldsAtLeast`, so a game can split one
   * arrival into two outcomes with both rules reading the same capacity and
   * neither doing arithmetic on it. DECODE needs the pair: an ARTIFACT that
   * clears the GOAL lip is CLASSIFIED if the RAMP has room and OVERFLOW if it
   * does not (§9.8.2), and those are the same arrival.
   */
  registry.register('regionHoldsFewerThan', (context, params) => {
    const regionId = readString(params, 'regionId');
    const count = readNumber(params, 'count');
    return (context.regionContents[regionId]?.length ?? 0) < count;
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

  /**
   * The triggering robot has no support inside any of the named zones.
   *
   * The inverse of the zone predicates, and it needs to exist separately because
   * a rule cannot be written as "no event fired". DECODE's LEAVE awards a robot
   * for being clear of every LAUNCH LINE at the end of AUTO (§10.5.3), which is
   * a question about absence.
   *
   * Paired with `RobotAssessed`, which restates a robot regardless of where it
   * is, so there is something for such a rule to trigger on.
   *
   * Params: `zoneIds`, a comma-separated list. True only when the robot has no
   * support — full or partial — in any of them.
   */
  registry.register('robotNotInZone', (context, params) => {
    const robotId = robotIdOf(context.event);
    if (robotId === null) return false;
    return !inAnyZone(context, robotId, readList(params, 'zoneIds'));
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

/** Any support at all — full or partial — in any of the named zones. */
function inAnyZone(
  context: PredicateContext,
  robotId: string,
  zoneIds: readonly string[],
): boolean {
  return zoneIds.some(
    (zoneId) =>
      (context.robotsFullyInZone[zoneId] ?? []).includes(robotId) ||
      (context.robotsPartiallyInZone[zoneId] ?? []).includes(robotId),
  );
}
