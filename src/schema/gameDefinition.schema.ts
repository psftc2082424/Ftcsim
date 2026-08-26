/**
 * Runtime validation for the GameDefinition type layer.
 *
 * This matters more here than anywhere else in the project: in Phase 4 these
 * structures arrive from a language model reading a PDF. The schema is the
 * boundary where model output stops being text and becomes something the
 * simulator will act on.
 *
 * Two properties it enforces that the TypeScript types cannot:
 *
 *   1. **Endgame cannot escape teleop.** The threshold is validated against
 *      teleop's own duration, so a definition claiming a 200 s endgame inside a
 *      120 s teleop is rejected rather than silently clamped.
 *
 *   2. **No executable content.** A condition is an identifier matching a strict
 *      pattern. There is no field anywhere that could carry an expression, and
 *      unknown keys are stripped rather than passed through.
 *
 * Only the parts of `GameDefinition` that exist today are modelled. Field
 * geometry, game pieces and metrics are not yet defined, so there is no
 * container schema — adding one now would mean inventing shapes for things that
 * do not exist.
 */

import { z } from 'zod';
import type { Objective, ScoringRule } from '../core/game/scoring.js';
import { SIM_EVENT_KINDS } from '../core/game/events.js';
import type { MatchStructure } from '../core/game/matchStructure.js';
import type { Confidence } from '../core/game/sourced.js';

const CONFIDENCE_VALUES = ['explicit', 'inferred', 'assumed', 'unknown'] as const;

export const confidenceSchema = z.enum(CONFIDENCE_VALUES);

/** Wrap any value schema in the provenance envelope. */
export function sourcedSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({
    value: valueSchema,
    confidence: confidenceSchema,
    sourcePage: z.number().int().positive().optional(),
    sourceQuote: z.string().max(500).optional(),
    note: z.string().max(500).optional(),
  });
}

/** Durations are bounded well beyond any plausible match to catch unit errors. */
const durationSec = z.number().finite().min(0).max(3600);
const points = z.number().finite().min(-1000).max(1000);

/**
 * Identifiers are restricted to a conservative pattern.
 *
 * Predicate ids in particular are looked up in a code registry, so allowing
 * arbitrary text would invite someone to try smuggling an expression through.
 */
const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'Identifiers must be alphanumeric with - or _.');

// ---------------------------------------------------------- match structure ---

const endgameSubPhaseSchema = z.object({
  id: z.literal('ENDGAME'),
  startsAtRemainingSec: sourcedSchema(durationSec),
});

const autoPeriodSchema = z.object({
  id: z.literal('AUTO'),
  durationSec: sourcedSchema(durationSec),
});

const teleopPeriodSchema = z.object({
  id: z.literal('TELEOP'),
  durationSec: sourcedSchema(durationSec),
  subPhases: z.tuple([endgameSubPhaseSchema]),
});

export const matchStructureSchema = z
  .object({
    periods: z.tuple([autoPeriodSchema, teleopPeriodSchema]),
    transitionSec: sourcedSchema(durationSec).optional(),
  })
  .refine(
    (match) => match.periods[1].subPhases[0].startsAtRemainingSec.value <= match.periods[1].durationSec.value,
    {
      message:
        'Endgame cannot start before teleop does: its remaining-time threshold exceeds the teleop duration. Endgame is a sub-phase of teleop, not an additional period.',
      path: ['periods', 1, 'subPhases', 0, 'startsAtRemainingSec'],
    },
  );

// ------------------------------------------------------------------ scoring ---

const phaseScopeSchema = z.enum(['AUTO', 'TELEOP', 'ENDGAME', 'ANY']);

const filterValueSchema = z.union([z.string().max(200), z.number().finite(), z.boolean()]);

/**
 * Taken from the event model itself, never restated.
 *
 * This was a hand-written copy and it drifted: it lacked `RobotAssessed` and
 * `PhaseChanged`, which is to say it rejected every end-of-period rule DECODE
 * has — LEAVE, BASE and all 36 PATTERN rules. Deriving it means a new event kind
 * reaches definitions the moment it exists.
 */
const simEventKindSchema = z.enum(SIM_EVENT_KINDS);

/**
 * A field on an event payload, addressed the way `readEventField` reads it.
 *
 * Dotted, because events carry arrays and objects: DECODE's DEPOT rule filters
 * on `regionIds.0`, "the innermost region this piece is resting in". A bare
 * identifier rejected that. Still conservative — segments are identifiers or
 * array indices, and nothing here reaches code.
 */
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

const eventFieldPath = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_-]*(\.[a-zA-Z0-9_-]+)*$/,
    'Event field paths are dot-separated identifiers or indices.',
  )
  .refine(
    (path) => path.split('.').every((segment) => !UNSAFE_PATH_SEGMENTS.has(segment)),
    'Event field paths may not walk the prototype chain.',
  );

export const predicateRefSchema = z.object({
  predicateId: identifier,
  params: z.record(filterValueSchema).optional(),
});

export const scoringRuleSchema = z.object({
  id: identifier,
  label: z.string().min(1).max(120),
  phase: phaseScopeSchema,
  trigger: z.object({
    event: simEventKindSchema,
    filters: z.array(z.object({ field: eventFieldPath, equals: filterValueSchema })),
  }),
  condition: predicateRefSchema.optional(),
  award: z.object({
    points: sourcedSchema(points),
    alliance: z.enum(['owner', 'red', 'blue']),
  }),
  oncePerPiece: z.boolean().optional(),
  maxAwards: z.number().int().positive().max(10_000).optional(),
  contributesTo: z.array(identifier).max(16).optional(),
});

const capabilityKindSchema = z.enum([
  'acquire',
  'release',
  'launch',
  'elevate',
  'climb',
  'traverse',
]);

export const objectiveSchema = z.object({
  id: identifier,
  label: z.string().min(1).max(120),
  phase: phaseScopeSchema,
  pointValue: sourcedSchema(points),
  requiredCapabilities: z.array(capabilityKindSchema),
  repeatable: z.boolean(),
  estimatedCycleSec: sourcedSchema(z.number().finite().min(0).max(600)).optional(),
  notes: z.string().max(1000).optional(),
});

// ------------------------------------------------------------------ parsing ---

export interface GameParseFailure {
  readonly path: string;
  readonly message: string;
}

export type GameParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly GameParseFailure[] };

function toResult<T>(parsed: z.SafeParseReturnType<unknown, unknown>, cast: (v: unknown) => T): GameParseResult<T> {
  if (parsed.success) return { ok: true, value: cast(parsed.data) };
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

export function safeParseMatchStructure(raw: unknown): GameParseResult<MatchStructure> {
  return toResult(matchStructureSchema.safeParse(raw), (v) => v as MatchStructure);
}

export function safeParseScoringRule(raw: unknown): GameParseResult<ScoringRule> {
  return toResult(scoringRuleSchema.safeParse(raw), (v) => v as ScoringRule);
}

export function safeParseObjective(raw: unknown): GameParseResult<Objective> {
  return toResult(objectiveSchema.safeParse(raw), (v) => v as Objective);
}

/** Provenance levels that a human must review before a definition is trusted. */
export function isReviewRequired(confidence: Confidence): boolean {
  return confidence === 'assumed' || confidence === 'unknown';
}
