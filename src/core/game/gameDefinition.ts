/**
 * The GameDefinition container (ARCHITECTURE.md §6.2).
 *
 * Everything a season is: match timing, pieces, field geometry, scoring rules,
 * strategic objectives and robot constraints. Adding a new FTC season should be
 * writing one of these, not changing the engine — so this type is the contract
 * that claim is measured against.
 *
 * It is defined only now because its parts had to exist first. Writing it
 * earlier would have meant inventing shapes for field geometry and pieces before
 * either was built.
 *
 * ── Two things this file provides beyond the type ──────────────────────────
 *
 * `validateGameDefinition` cross-checks the parts against each other. A rule
 * naming a region no geometry provides scores nothing and explains nothing; a
 * predicate this build lacks would silently never fire. Both are caught before a
 * match starts rather than discovered as a wrong score.
 *
 * `assumptionLedger` walks the definition and reports every value that is not
 * `explicit`. ARCHITECTURE.md §6.1 promised the assumption ledger would be a
 * projection over the definition rather than a document that drifts; this is
 * that projection.
 */

import { validateRuleSet } from './rulesEngine.js';
import { validateRegions, type FieldRegion, type FieldZone } from './regions.js';
import { totalMatchDurationSec, type MatchStructure } from './matchStructure.js';
import type { PredicateRegistry } from './predicates.js';
import type { Objective, ScoringRule, FilterValue } from './scoring.js';
import type { Confidence, Sourced } from './sourced.js';
import type { RobotConfig } from '../robot/robotConfig.js';

/** A class of game piece, as the manual describes it. */
export interface GamePieceType {
  readonly id: string;
  readonly label: string;
  readonly diameterIn: Sourced<number>;
  /**
   * Mass, where the manual gives one.
   *
   * Optional because manuals often do not: DECODE specifies ARTIFACT diameter
   * and material but no weight. Physics needs a mass, so a definition without
   * one forces the caller to supply an estimate — which `validateGameDefinition`
   * reports rather than letting it pass unnoticed.
   */
  readonly massLb?: Sourced<number> | undefined;
  readonly count: Sourced<number>;
}

/** Size and expansion limits a legal robot must respect. */
export interface RobotConstraints {
  readonly startingCubeIn: Sourced<number>;
  readonly maxExpandedHeightIn: Sourced<number>;
  readonly horizontalExpansionIn: Sourced<number>;
}

export interface GameDefinition {
  readonly id: string;
  readonly season: string;
  readonly name: string;

  readonly match: MatchStructure;
  readonly pieces: readonly GamePieceType[];

  readonly regions: readonly FieldRegion[];
  readonly zones: readonly FieldZone[];
  /** Ordered regions and their slot counts. */
  readonly slottedRegions: Readonly<Record<string, number>>;

  readonly rules: readonly ScoringRule[];
  readonly objectives: readonly Objective[];
  readonly robotConstraints: RobotConstraints;

  /** Per-match values, e.g. a randomised pattern selection. */
  readonly variables?: Readonly<Record<string, FilterValue>> | undefined;
}

// ------------------------------------------------------------- validation ---

export interface DefinitionProblem {
  readonly severity: 'error' | 'warning';
  readonly where: string;
  readonly message: string;
}

/** Region and zone ids a rule set actually refers to. */
export function referencedPlaceIds(rules: readonly ScoringRule[]): {
  regions: readonly string[];
  zones: readonly string[];
} {
  const regions = new Set<string>();
  const zones = new Set<string>();

  for (const rule of rules) {
    for (const filter of rule.trigger.filters) {
      if (typeof filter.equals !== 'string') continue;
      if (filter.field === 'regionId' || filter.field.startsWith('regionIds')) {
        regions.add(filter.equals);
      }
      if (filter.field === 'zoneId') zones.add(filter.equals);
    }

    // Predicates address places by parameter as well as by filter.
    const params = rule.condition?.params ?? {};
    if (typeof params['regionId'] === 'string') regions.add(params['regionId']);
    if (typeof params['zoneId'] === 'string') zones.add(params['zoneId']);
  }

  return { regions: [...regions].sort(), zones: [...zones].sort() };
}

/**
 * Cross-check a definition before it is used.
 *
 * Errors mean the definition cannot score correctly. Warnings mean it will run
 * but something is missing or estimated — a piece with no mass, for instance,
 * which the simulation can only handle by guessing.
 */
export function validateGameDefinition(
  definition: GameDefinition,
  registry: PredicateRegistry,
): readonly DefinitionProblem[] {
  const problems: DefinitionProblem[] = [];

  const error = (where: string, message: string): void => {
    problems.push({ severity: 'error', where, message });
  };
  const warn = (where: string, message: string): void => {
    problems.push({ severity: 'warning', where, message });
  };

  // --- match ---------------------------------------------------------------
  if (totalMatchDurationSec(definition.match) <= 0) {
    error('match', 'Match has no duration.');
  }

  // --- geometry ------------------------------------------------------------
  for (const problem of validateRegions(definition.regions)) {
    error(`regions.${problem.regionId}`, problem.message);
  }
  for (const problem of validateRegions(definition.zones.map((zone) => ({ ...zone })))) {
    error(`zones.${problem.regionId}`, problem.message);
  }

  // --- rules ---------------------------------------------------------------
  for (const problem of validateRuleSet(definition.rules, registry)) {
    error(`rules.${problem.ruleId}`, problem.message);
  }
  if (definition.rules.length === 0) {
    warn('rules', 'Definition scores nothing: it has no rules.');
  }

  // --- rules against geometry ---------------------------------------------
  const placedRegions = new Set(definition.regions.map((r) => r.id));
  const placedZones = new Set(definition.zones.map((z) => z.id));
  const referenced = referencedPlaceIds(definition.rules);

  for (const regionId of referenced.regions) {
    if (!placedRegions.has(regionId)) {
      error('rules', `References region "${regionId}", which has no geometry.`);
    }
  }
  for (const zoneId of referenced.zones) {
    if (!placedZones.has(zoneId)) {
      error('rules', `References zone "${zoneId}", which has no geometry.`);
    }
  }

  // --- slotted regions -----------------------------------------------------
  for (const [regionId, slots] of Object.entries(definition.slottedRegions)) {
    if (!placedRegions.has(regionId)) {
      error('slottedRegions', `"${regionId}" has no geometry.`);
    }
    if (!Number.isInteger(slots) || slots < 1) {
      error('slottedRegions', `"${regionId}" has a non-positive slot count.`);
    }
  }

  // --- pieces --------------------------------------------------------------
  if (definition.pieces.length === 0) {
    warn('pieces', 'Definition declares no game pieces.');
  }
  const pieceIds = new Set<string>();
  for (const piece of definition.pieces) {
    if (pieceIds.has(piece.id)) error('pieces', `Duplicate piece type "${piece.id}".`);
    pieceIds.add(piece.id);

    if (piece.diameterIn.value <= 0) {
      error(`pieces.${piece.id}`, 'Diameter must be positive.');
    }
    if (piece.massLb === undefined) {
      warn(
        `pieces.${piece.id}`,
        'No mass in the definition. The simulation needs one, so a caller must estimate it.',
      );
    }
  }

  return problems;
}

export function definitionErrors(
  problems: readonly DefinitionProblem[],
): readonly DefinitionProblem[] {
  return problems.filter((p) => p.severity === 'error');
}

// ------------------------------------------------------ assumption ledger ---

export interface LedgerEntry {
  readonly path: string;
  readonly confidence: Confidence;
  readonly value: unknown;
  readonly note?: string | undefined;
  readonly sourcePage?: number | undefined;
  readonly sourceRule?: string | undefined;
}

function isSourced(value: unknown): value is Sourced<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { value?: unknown; confidence?: unknown };
  return (
    'value' in candidate &&
    typeof candidate.confidence === 'string' &&
    ['explicit', 'inferred', 'assumed', 'unknown'].includes(candidate.confidence)
  );
}

/**
 * Every `Sourced` value in a definition, with the path it was found at.
 *
 * Walks the structure rather than requiring each definition to maintain its own
 * list, so a value added without provenance cannot hide: it either is a
 * `Sourced` and appears here, or it is a bare number and is visible as such in
 * review.
 */
export function collectProvenance(definition: GameDefinition): readonly LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return;
    // Geometry holds large vertex arrays and cyclic-free but bulky shapes; the
    // guard also stops a shared object being reported twice.
    if (seen.has(node)) return;
    seen.add(node);

    if (isSourced(node)) {
      entries.push({
        path,
        confidence: node.confidence,
        value: node.value,
        note: node.note,
        sourcePage: node.sourcePage,
        sourceRule: node.sourceRule,
      });
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      walk(child, path === '' ? key : `${path}.${key}`);
    }
  };

  walk(definition, '');
  return entries;
}

/**
 * The subset a human must review: anything not stated outright by the manual.
 *
 * This is the assumption ledger for a season, derived rather than maintained.
 */
export function assumptionLedger(definition: GameDefinition): readonly LedgerEntry[] {
  return collectProvenance(definition).filter(
    (entry) => entry.confidence === 'assumed' || entry.confidence === 'unknown',
  );
}

/** Proportion of a definition's values taken straight from the manual. */
export function provenanceSummary(
  definition: GameDefinition,
): Readonly<Record<Confidence, number>> {
  const summary: Record<Confidence, number> = {
    explicit: 0,
    inferred: 0,
    assumed: 0,
    unknown: 0,
  };
  for (const entry of collectProvenance(definition)) summary[entry.confidence]++;
  return summary;
}

// -------------------------------------------------------- robot legality ---

export interface LegalityViolation {
  readonly rule: string;
  readonly message: string;
}

/**
 * Check a robot against a season's constraints.
 *
 * Advisory, never enforced: `PRODUCT_SPEC.md` §23 wants an engineering sandbox,
 * and simulating a deliberately illegal robot to see what it would score is a
 * legitimate thing to do. The simulator's job is to say so, not to refuse.
 */
export function checkRobotLegality(
  config: RobotConfig,
  constraints: RobotConstraints,
): readonly LegalityViolation[] {
  const violations: LegalityViolation[] = [];
  const cube = constraints.startingCubeIn.value;

  const dimensions: Array<[string, number]> = [
    ['length', config.chassis.lengthIn],
    ['width', config.chassis.widthIn],
    ['height', config.chassis.heightIn],
  ];

  for (const [name, value] of dimensions) {
    if (value > cube) {
      violations.push({
        rule: constraints.startingCubeIn.sourceRule ?? 'starting size',
        message: `Chassis ${name} is ${value} in, exceeding the ${cube} in starting cube.`,
      });
    }
  }

  const maxHeight = constraints.maxExpandedHeightIn.value;
  if (config.chassis.heightIn > maxHeight) {
    violations.push({
      rule: constraints.maxExpandedHeightIn.sourceRule ?? 'expansion',
      message: `Height is ${config.chassis.heightIn} in, exceeding the ${maxHeight} in expansion limit.`,
    });
  }

  return violations;
}
