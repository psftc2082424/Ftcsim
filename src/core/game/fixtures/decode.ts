/**
 * DECODE (2025–26) — the Phase 3 golden fixture.
 *
 * Hand-authored from the official *DECODE Competition Manual* (Team Update 32).
 * Every externally sourced value carries a `Sourced<T>` citing its manual
 * section; every value the manual does not state is marked `assumed` or
 * `unresolved` with a reason. Nothing here is recalled from memory.
 *
 * This file is **data**, not engine. It exists to prove the engine is
 * season-agnostic: DECODE's rules, regions, pieces and point values live here,
 * and `rulesEngine.ts` scores them without containing the word "artifact".
 *
 * ── Two structural findings from the manual ────────────────────────────────
 *
 * 1. **DECODE has no endgame.** The word appears nowhere in the manual. BASE is
 *    assessed "at the end of the TELEOP" (§10.5, F). The fixture therefore sets
 *    `startsAtRemainingSec: 0`, which the match-structure model already treats
 *    as "no endgame" — validating the sub-phase design against a real season
 *    that simply does not use it.
 *
 * 2. **The 8-second AUTO→TELEOP gap is real and load-bearing** (§10.4). It is
 *    modelled by `transitionSec`, and it is why total match length is 158 s
 *    rather than 150 s.
 */

import { assumed, explicit, explicitRule, unresolved } from '../sourced.js';
import type { MatchStructure } from '../matchStructure.js';
import type { Objective, ScoringRule } from '../scoring.js';

// ---------------------------------------------------------------- pieces ---

export interface DecodePieceType {
  readonly id: string;
  readonly label: string;
  readonly diameterIn: ReturnType<typeof explicit<number>>;
  readonly count: ReturnType<typeof explicit<number>>;
}

/**
 * ARTIFACTS are alliance-neutral balls in two colours (§9.9).
 *
 * Piece type ids are the single-letter motif symbols `G` and `P`, because the
 * manual's PATTERN notation is written in exactly those symbols (§10.5.2,
 * Figure 10-4). That lets the generic `slotMatchesRepeatingPattern` predicate
 * compare a slot's occupant against a pattern string directly, with no DECODE
 * lookup table in the engine.
 */
export const DECODE_PIECES: readonly DecodePieceType[] = [
  {
    id: 'G',
    label: 'Green ARTIFACT',
    // Nominal 5 in; the manufacturer spec is 4.9 in +/- 0.25 in at the mold seam.
    diameterIn: explicit(4.9, 73, 'ARTFACTS are specified to be 4.9 in +/- 0.25 in.'),
    count: explicit(12, 73, 'There are 24 purple (P) ARTIFACTS and 12 green (G) ARTIFACTS'),
  },
  {
    id: 'P',
    label: 'Purple ARTIFACT',
    diameterIn: explicit(4.9, 73, 'ARTFACTS are specified to be 4.9 in +/- 0.25 in.'),
    count: explicit(24, 73, 'There are 24 purple (P) ARTIFACTS and 12 green (G) ARTIFACTS'),
  },
];

/** Nominal diameter as printed, distinct from the toleranced spec above. */
export const ARTIFACT_NOMINAL_DIAMETER_IN = explicit(
  5,
  73,
  'ARTIFACTS are 5 in. (12.70 cm) nominal Gopher ResisDent polypropylene balls',
);

// ---------------------------------------------------------------- motifs ---

/**
 * The OBELISK randomisation selects one MOTIF, repeated 3 times across the 9
 * RAMP indices (§10.5.2, Figure 10-4).
 */
export const DECODE_MOTIFS = {
  GPP: { pattern: 'GPP', aprilTagId: 21 },
  PGP: { pattern: 'PGP', aprilTagId: 22 },
  PPG: { pattern: 'PPG', aprilTagId: 23 },
} as const;

export type DecodeMotifKey = keyof typeof DECODE_MOTIFS;

/** Number of ordered scoring slots on a RAMP (§10.5.2: indices 1–9). */
export const RAMP_SLOT_COUNT = explicit(9, 86, 'Index 1 2 3 4 5 6 7 8 9');

// ---------------------------------------------------------------- regions ---

/**
 * Region ids the rules reference.
 *
 * Alliance-scoped because DEPOTS and GOALS are alliance specific (§10.5.1).
 */
export const DECODE_REGIONS = {
  redRamp: 'red-ramp',
  blueRamp: 'blue-ramp',
  redOverflow: 'red-overflow',
  blueOverflow: 'blue-overflow',
  redDepot: 'red-depot',
  blueDepot: 'blue-depot',
} as const;

export const DECODE_ZONES = {
  redBase: 'red-base',
  blueBase: 'blue-base',
  redLaunchLine: 'red-launch-line',
  blueLaunchLine: 'blue-launch-line',
} as const;

/** BASE ZONE is an 18 in square (§9.3). */
export const BASE_ZONE_SIDE_IN = explicit(
  18,
  61,
  'BASE ZONE: an 18 in. +/- 0.125 in. wide by 18 in. +/- 0.125 in.',
);

// ------------------------------------------------------------ match timing ---

/**
 * §10.4: AUTO is 30 s, there is an 8-second delay before TELEOP, and TELEOP is
 * 2:00. No endgame exists in this game.
 */
export const DECODE_MATCH: MatchStructure = {
  periods: [
    {
      id: 'AUTO',
      durationSec: explicit(
        30,
        83,
        'The first period of each MATCH is 30 seconds (0:30) long and called the Autonomous Period',
      ),
    },
    {
      id: 'TELEOP',
      durationSec: explicit(
        120,
        83,
        'The second period of each MATCH is 2 minutes (2:00) long and called the teleoperated period',
      ),
      subPhases: [
        {
          id: 'ENDGAME',
          // DECODE defines no endgame; zero means the sub-phase never opens.
          startsAtRemainingSec: explicit(
            0,
            83,
            'The DECODE manual defines no ENDGAME period; BASE is assessed at the end of TELEOP.',
          ),
        },
      ],
    },
  ],
  transitionSec: explicit(
    8,
    83,
    'There is an 8-second delay between AUTO and TELEOP for scoring purposes',
  ),
};

// ------------------------------------------------------------ point values ---

/** Table 10-2, DECODE point values (§10.5.4, p.88). */
export const DECODE_POINTS = {
  leaveAuto: explicit(3, 88, 'LEAVE | AUTO 3'),
  classifiedAuto: explicit(3, 88, 'CLASSIFIED | AUTO 3'),
  classifiedTeleop: explicit(3, 88, 'CLASSIFIED | TELEOP 3'),
  overflowAuto: explicit(1, 88, 'OVERFLOW | AUTO 1'),
  overflowTeleop: explicit(1, 88, 'OVERFLOW | TELEOP 1'),
  depotTeleop: explicit(1, 88, 'DEPOT | TELEOP 1'),
  patternAuto: explicit(2, 88, 'PATTERN ARTIFACT matches MOTIF | AUTO 2'),
  patternTeleop: explicit(2, 88, 'PATTERN ARTIFACT matches MOTIF | TELEOP 2'),
  basePartial: explicit(5, 88, 'Partially returned to BASE | 5'),
  baseFull: explicit(10, 88, 'Fully returned to BASE | 10'),
  baseBothBonus: explicit(10, 88, 'Additional Bonus: 2 ROBOTS fully returned to BASE. | 10'),
} as const;

/**
 * Ranking points are recorded for completeness but are **not** scored by the
 * rules engine: RP thresholds vary by event tier (Table 10-3) and RP affects
 * tournament ranking rather than match score.
 */
export const DECODE_RANKING_POINTS = {
  win: explicit(3, 88, 'WIN | 3'),
  tie: explicit(1, 88, 'TIE | 1'),
  movement: explicit(1, 88, 'MOVEMENT RP | 1'),
  goal: explicit(1, 88, 'GOAL RP | 1'),
  pattern: explicit(1, 88, 'PATTERN RP | 1'),
  thresholds: unresolved(
    0,
    'RP thresholds (Table 10-3) vary by event tier and were not transcribed; not needed for match scoring.',
  ),
} as const;

// ------------------------------------------------------------ robot limits ---

export const DECODE_ROBOT_CONSTRAINTS = {
  startingCubeIn: explicitRule(
    18,
    'R104',
    'within an 18 in. wide, by 18 in. long, by 18 in. high volume',
  ),
  maxExpandedHeightIn: explicit(
    38,
    103,
    'ROBOTS may only expand above 18 in. (45.70 cm) up to 38 in. (96.50 cm)',
  ),
  horizontalExpansionIn: explicit(
    18,
    103,
    'fixed 18 in. by 18 in. when fully expanded per G414',
  ),
} as const;

// ------------------------------------------------------------- rule builder ---

interface RampRuleSpec {
  readonly alliance: 'red' | 'blue';
  readonly rampRegion: string;
  readonly phase: 'AUTO' | 'TELEOP';
}

/**
 * PATTERN rules: one per RAMP slot per alliance per phase.
 *
 * Nine slots is a property of DECODE's ramp, so the rules are *generated from
 * data here* rather than the engine looping over "the pattern". The engine only
 * ever sees ordinary rules with a predicate reference.
 */
function patternRules({ alliance, rampRegion, phase }: RampRuleSpec): ScoringRule[] {
  const points = phase === 'AUTO' ? DECODE_POINTS.patternAuto : DECODE_POINTS.patternTeleop;

  return Array.from({ length: RAMP_SLOT_COUNT.value }, (_unused, slotIndex) => ({
    id: `${alliance}-pattern-${phase.toLowerCase()}-${slotIndex}`,
    label: `${alliance} PATTERN slot ${slotIndex + 1} (${phase})`,
    phase,
    trigger: {
      event: 'PhaseChanged' as const,
      filters: [{ field: 'from', equals: phase }],
    },
    condition: {
      predicateId: 'slotMatchesRepeatingPattern',
      params: { regionId: rampRegion, slotIndex, patternVariable: 'motif' },
    },
    award: { points, alliance },
  }));
}

/**
 * The DECODE rule set.
 *
 * Ordering is part of the definition: the two-robot BASE bonus is evaluated
 * after the individual BASE awards so a breakdown reads in the order a referee
 * would assess it.
 */
export const DECODE_SCORING_RULES: readonly ScoringRule[] = [
  // --- ARTIFACT scoring, §10.5.1 -------------------------------------------
  ...(['red', 'blue'] as const).flatMap((alliance) => {
    const ramp = alliance === 'red' ? DECODE_REGIONS.redRamp : DECODE_REGIONS.blueRamp;
    const overflow =
      alliance === 'red' ? DECODE_REGIONS.redOverflow : DECODE_REGIONS.blueOverflow;
    const depot = alliance === 'red' ? DECODE_REGIONS.redDepot : DECODE_REGIONS.blueDepot;
    const base = alliance === 'red' ? DECODE_ZONES.redBase : DECODE_ZONES.blueBase;

    return [
      {
        id: `${alliance}-classified-auto`,
        label: `${alliance} CLASSIFIED (AUTO)`,
        phase: 'AUTO' as const,
        trigger: {
          event: 'PieceEnteredRegion' as const,
          filters: [{ field: 'regionId', equals: ramp }],
        },
        award: { points: DECODE_POINTS.classifiedAuto, alliance },
        oncePerPiece: true,
      },
      {
        id: `${alliance}-classified-teleop`,
        label: `${alliance} CLASSIFIED (TELEOP)`,
        phase: 'TELEOP' as const,
        trigger: {
          event: 'PieceEnteredRegion' as const,
          filters: [{ field: 'regionId', equals: ramp }],
        },
        award: { points: DECODE_POINTS.classifiedTeleop, alliance },
        oncePerPiece: true,
      },
      {
        id: `${alliance}-overflow-auto`,
        label: `${alliance} OVERFLOW (AUTO)`,
        phase: 'AUTO' as const,
        trigger: {
          event: 'PieceEnteredRegion' as const,
          filters: [{ field: 'regionId', equals: overflow }],
        },
        award: { points: DECODE_POINTS.overflowAuto, alliance },
        oncePerPiece: true,
      },
      {
        id: `${alliance}-overflow-teleop`,
        label: `${alliance} OVERFLOW (TELEOP)`,
        phase: 'TELEOP' as const,
        trigger: {
          event: 'PieceEnteredRegion' as const,
          filters: [{ field: 'regionId', equals: overflow }],
        },
        award: { points: DECODE_POINTS.overflowTeleop, alliance },
        oncePerPiece: true,
      },

      // --- DEPOT, assessed at the end of TELEOP (§10.5, D) -----------------
      {
        id: `${alliance}-depot`,
        label: `${alliance} DEPOT`,
        phase: 'TELEOP' as const,
        trigger: {
          event: 'PieceCameToRest' as const,
          filters: [{ field: 'regionIds.0', equals: depot }],
        },
        award: { points: DECODE_POINTS.depotTeleop, alliance },
        oncePerPiece: true,
      },

      // --- LEAVE, assessed at the end of AUTO (§10.5, E; §10.5.3) ----------
      {
        id: `${alliance}-leave`,
        label: `${alliance} LEAVE`,
        phase: 'AUTO' as const,
        trigger: {
          event: 'RobotExitedZone' as const,
          filters: [
            {
              field: 'zoneId',
              equals:
                alliance === 'red'
                  ? DECODE_ZONES.redLaunchLine
                  : DECODE_ZONES.blueLaunchLine,
            },
          ],
        },
        award: { points: DECODE_POINTS.leaveAuto, alliance },
        // One award per robot per match; two robots per alliance.
        maxAwards: 2,
      },

      // --- BASE, assessed at the end of TELEOP (§10.5, F; §10.5.3) ---------
      {
        id: `${alliance}-base-full`,
        label: `${alliance} fully returned to BASE`,
        phase: 'TELEOP' as const,
        trigger: {
          event: 'RobotOverlapsZone' as const,
          filters: [{ field: 'zoneId', equals: base }],
        },
        condition: { predicateId: 'robotFullyInZone', params: { zoneId: base } },
        award: { points: DECODE_POINTS.baseFull, alliance },
        maxAwards: 2,
      },
      {
        id: `${alliance}-base-partial`,
        label: `${alliance} partially returned to BASE`,
        phase: 'TELEOP' as const,
        trigger: {
          event: 'RobotOverlapsZone' as const,
          filters: [{ field: 'zoneId', equals: base }],
        },
        condition: { predicateId: 'robotPartiallyInZone', params: { zoneId: base } },
        award: { points: DECODE_POINTS.basePartial, alliance },
        maxAwards: 2,
      },
      {
        id: `${alliance}-base-bonus`,
        label: `${alliance} bonus: both ROBOTS fully returned to BASE`,
        phase: 'TELEOP' as const,
        trigger: {
          event: 'PhaseChanged' as const,
          filters: [{ field: 'from', equals: 'TELEOP' }],
        },
        condition: {
          predicateId: 'alliedRobotsFullyInZone',
          params: { zoneId: base, count: 2 },
        },
        award: { points: DECODE_POINTS.baseBothBonus, alliance },
        maxAwards: 1,
      },
    ] satisfies ScoringRule[];
  }),

  // --- PATTERN, assessed at the end of AUTO and TELEOP (§10.5, B and C) ----
  ...patternRules({ alliance: 'red', rampRegion: DECODE_REGIONS.redRamp, phase: 'AUTO' }),
  ...patternRules({ alliance: 'red', rampRegion: DECODE_REGIONS.redRamp, phase: 'TELEOP' }),
  ...patternRules({ alliance: 'blue', rampRegion: DECODE_REGIONS.blueRamp, phase: 'AUTO' }),
  ...patternRules({ alliance: 'blue', rampRegion: DECODE_REGIONS.blueRamp, phase: 'TELEOP' }),
];

// ------------------------------------------------------------- objectives ---

/**
 * Strategic view of DECODE, for the Phase 5 archetype generator.
 *
 * Cycle-time estimates are **assumed**: the manual states point values, never
 * how long an action takes. They are flagged so a reviewer sees that these are
 * the simulator's guesses, not the game's numbers.
 */
export const DECODE_OBJECTIVES: readonly Objective[] = [
  {
    id: 'score-classified',
    label: 'Score a CLASSIFIED ARTIFACT',
    phase: 'ANY',
    pointValue: DECODE_POINTS.classifiedTeleop,
    requiredCapabilities: ['acquire', 'launch'],
    repeatable: true,
    estimatedCycleSec: assumed(4, 'Not stated in the manual; estimated launch-and-reload cycle.'),
  },
  {
    id: 'score-overflow',
    label: 'Score an OVERFLOW ARTIFACT',
    phase: 'ANY',
    pointValue: DECODE_POINTS.overflowTeleop,
    requiredCapabilities: ['acquire', 'launch'],
    repeatable: true,
    estimatedCycleSec: assumed(4, 'Not stated in the manual; same cycle as CLASSIFIED.'),
  },
  {
    id: 'score-depot',
    label: 'Place an ARTIFACT over the DEPOT',
    phase: 'TELEOP',
    pointValue: DECODE_POINTS.depotTeleop,
    requiredCapabilities: ['acquire', 'release'],
    repeatable: true,
    estimatedCycleSec: assumed(5, 'Not stated in the manual; estimated collect-and-place cycle.'),
  },
  {
    id: 'leave-launch-line',
    label: 'LEAVE the LAUNCH LINE during AUTO',
    phase: 'AUTO',
    pointValue: DECODE_POINTS.leaveAuto,
    requiredCapabilities: [],
    repeatable: false,
    estimatedCycleSec: assumed(2, 'Not stated; a short drive off the line.'),
  },
  {
    id: 'return-to-base',
    label: 'Fully return to BASE by the end of TELEOP',
    phase: 'TELEOP',
    pointValue: DECODE_POINTS.baseFull,
    requiredCapabilities: [],
    repeatable: false,
    estimatedCycleSec: assumed(6, 'Not stated; estimated drive back across the field.'),
    notes: 'DECODE has no ENDGAME period; BASE is assessed at the end of TELEOP.',
  },
  {
    id: 'complete-pattern',
    label: 'Match the MOTIF PATTERN on the RAMP',
    phase: 'ANY',
    pointValue: DECODE_POINTS.patternTeleop,
    requiredCapabilities: ['acquire', 'launch'],
    repeatable: true,
    estimatedCycleSec: assumed(
      4,
      'Not stated; PATTERN is scored per matching slot, not as a separate action.',
    ),
    notes: 'Requires controlling ARTIFACT colour order, not just throughput.',
  },
];

/** Total ARTIFACTS in a match, for setup and sanity checks (§9.9). */
export const DECODE_TOTAL_ARTIFACTS = explicit(
  36,
  73,
  'There are 24 purple (P) ARTIFACTS and 12 green (G) ARTIFACTS total in a DECODE MATCH.',
);
