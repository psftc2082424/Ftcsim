/**
 * BIOBUZZ (2026-27) — hand-authored from the 2026-2027 FIRST Tech Challenge
 * Competition Manual (V1).
 *
 * Every externally sourced value carries a `Sourced<T>` citing its manual
 * section; every value the manual does not state is marked `assumed` with a
 * reason. This file is data, following exactly the same discipline as
 * `decode.ts` — it exists to prove the same engine that runs DECODE runs a
 * structurally different game (a tipping goal, a human-fed reserve, a
 * stack-ownership scoring rule) with no new season vocabulary in the engine.
 *
 * ── Table 10-2's point values, honestly flagged ────────────────────────────
 *
 * The PDF's point-value table extracted with its columns scrambled (a text
 * extraction limit, not a manual defect); the values below are reconstructed
 * from row/column position and cross-checked against the prose sections that
 * describe each achievement. They read as internally consistent, but a human
 * should confirm them against the actual table image before this fixture is
 * trusted for competition prep.
 *
 * ── Two structural findings from the manual ────────────────────────────────
 *
 * 1. **The HIVE tip has no published threshold.** It is a real bistable
 *    mechanism (§9.6.2), not a rules-declared count, and the manual says
 *    outright that referees are not expected to watch for the literal instant
 *    it happens (§10.5.1). `BIOBUZZ_HIVE_TIP_THRESHOLD` is therefore an
 *    engineering estimate — the first genuinely new kind of `assumed` value
 *    this project has needed, distinct from an estimated mass or an inferred
 *    position.
 * 2. **NECTAR is not fully staged at kickoff.** Only 6 of 16 NECTAR start on
 *    the FIELD; the other 10 sit in each ALLIANCE AREA and enter through the
 *    LOADING ZONE only as HIVE tips unlock them, or all at once with a minute
 *    left (§10.1, G426). `biobuzzStaging.ts` models the unlockable ones as
 *    ordinary staged pieces, held until `reserveFeed.ts` releases them — see
 *    that module for why this needs no new "pieces spawn mid-match" concept.
 */

import { assumed, explicit, explicitRule, type Sourced } from '../sourced.js';
import type { MatchStructure } from '../matchStructure.js';
import type { ScoringRule } from '../scoring.js';
import type {
  MatchSetupSpec,
  MechanismActionRoute,
  PenaltyValues,
  RankingPointRules,
  RobotConstraints,
} from '../gameDefinition.js';
import type { TippingStructureSpec } from '../tipper.js';
import type { ReserveFeedSpec } from '../reserveFeed.js';
import type { ElevatedRegionSpec } from '../elevatedRegion.js';
import { inchesToMeters } from '../../units/convert.js';
import {
  EXPANSION_DEPTH_IN,
  EXPANSION_HEIGHT_IN,
  EXPANSION_WIDTH_IN,
  FLOWER,
  HIVE_FRAME,
  NECTAR_COUNT_PER_ALLIANCE,
  NECTAR_DIAMETER_IN,
  NECTAR_MASS_LB,
  POLLEN_COUNT,
  POLLEN_DIAMETER_IN,
  POLLEN_MASS_LB,
  STARTING_CUBE_IN,
} from './biobuzzDimensions.js';
import { BIOBUZZ_REGIONS, BIOBUZZ_ZONES, WALL_CONTACT_ZONE_IDS } from './biobuzzField.js';

// ---------------------------------------------------------------- pieces ---

export interface BiobuzzPieceType {
  readonly id: string;
  readonly label: string;
  readonly diameterIn: Sourced<number>;
  readonly massLb: Sourced<number>;
  readonly count: Sourced<number>;
}

export const BIOBUZZ_PIECES: readonly BiobuzzPieceType[] = [
  { id: 'pollen', label: 'POLLEN', diameterIn: POLLEN_DIAMETER_IN, massLb: POLLEN_MASS_LB, count: POLLEN_COUNT },
  {
    id: 'nectar-red',
    label: 'Red NECTAR',
    diameterIn: NECTAR_DIAMETER_IN,
    massLb: NECTAR_MASS_LB,
    count: NECTAR_COUNT_PER_ALLIANCE,
  },
  {
    id: 'nectar-blue',
    label: 'Blue NECTAR',
    diameterIn: NECTAR_DIAMETER_IN,
    massLb: NECTAR_MASS_LB,
    count: NECTAR_COUNT_PER_ALLIANCE,
  },
];

// ---------------------------------------------------------------- match ---

export const BIOBUZZ_MATCH: MatchStructure = {
  periods: [
    { id: 'AUTO', durationSec: explicitRule(30, 'S10.4', 'The first period of each MATCH is 30 seconds (0:30) long and called the Autonomous Period (AUTO).', 85) },
    {
      id: 'TELEOP',
      durationSec: explicitRule(120, 'S10.4', 'The third period of each MATCH is 2 minutes (2:00) long and called the teleoperated period (TELEOP).', 85),
      subPhases: [
        {
          id: 'ENDGAME',
          // Modelled as BIOBUZZ's own sub-phase because it is exactly what
          // the manual's own scoring/foul boundary is: FLOWER scoring and
          // unrestricted NECTAR entry both begin "with one minute left"
          // (G410, §10.1), and both this fixture's FLOWER rules and its
          // reserve feeds key off the same 60 s mark.
          startsAtRemainingSec: explicitRule(60, 'G410', 'ROBOTS may not enter NECTAR into the FLOWER scoring volume until the last 60 seconds of the MATCH.', 92),
        },
      ],
    },
  ],
  transitionSec: explicitRule(8, 'S10.1', 'an 8-second transition period between AUTO and TELEOP for scoring purposes', 81),
  // §10.5.B: "HIVE TIPS that are complete prior to the start of TELEOP are
  // assessed as part of AUTO." The manual calls this out specifically for
  // HIVE TIPS, but nothing else can complete during an 8 s dead window (FLOWER
  // scoring is barred until the last minute; GARDEN/PARK are match-end only),
  // so applying it match-wide is equivalent in practice and needs no per-rule
  // exception, the same mechanism DECODE's own transition rule uses.
  transitionScoresAs: explicitRule('AUTO', 'S10.5.B', 'HIVE TIPS that are complete prior to the start of TELEOP are assessed as part of AUTO.', 86),
};

// ------------------------------------------------------------ constraints ---

export const BIOBUZZ_ROBOT_CONSTRAINTS: RobotConstraints = {
  startingCubeIn: STARTING_CUBE_IN,
  maxExpandedHeightIn: EXPANSION_HEIGHT_IN,
  // `RobotConstraints` models one horizontal expansion figure; R105's box is
  // 18 x 24 in horizontally. The narrower dimension is used so a check
  // against this constraint is conservative rather than permissive.
  horizontalExpansionIn: EXPANSION_WIDTH_IN,
};

export const BIOBUZZ_HAS_NO_WEIGHT_LIMIT: Sourced<string> = explicitRule(
  'no weight limit',
  'R104',
  'There is no explicit weight limit for FIRST Tech Challenge ROBOTS playing BIOBUZZ.',
  121,
);

/** Recorded for `assumptionLedger`, not used elsewhere: R105's full 3D box. */
export const BIOBUZZ_EXPANSION_DEPTH_IN = EXPANSION_DEPTH_IN;

// -------------------------------------------------------- tipping (HIVE) ---

/**
 * No published tip threshold exists (see file banner). Three balls is a
 * reasoned middle estimate: the CELL opening (20 x 14 x 12 in) comfortably
 * holds far more than three 2.8-3.6 in balls by volume, but a bistable
 * mechanism tips on accumulated *torque*, not volume, and the manual's own
 * framing — that the exact moment is not meant to be watched for precisely —
 * argues against tuning this to a tight, CAD-derived number that this pass
 * cannot verify.
 */
export const BIOBUZZ_HIVE_TIP_THRESHOLD: Sourced<number> = assumed(
  5,
  'The HIVE tips on real accumulated torque (§9.6.2); no rule states a piece ' +
    'count. Estimated as a middle value the CELL geometry could plausibly hold ' +
    'before overbalancing, and deliberately set above the 3 NECTAR staged in ' +
    'the CELL at kickoff (§10.3.1) — a threshold at or below that count would ' +
    'tip the HIVE before AUTO starts, which is not the intended achievement. ' +
    'Needs the CAD/mass to derive a physically exact figure.',
);

export const HIVE_CELL_REST_HEIGHT_IN = HIVE_FRAME.pivotHeightIn.value - 6;

export const BIOBUZZ_TIPPING_STRUCTURES: readonly TippingStructureSpec[] = (['red', 'blue'] as const).map(
  (alliance) => ({
    id: `${alliance}-hive`,
    alliance,
    cellRegionIds:
      alliance === 'red'
        ? [BIOBUZZ_REGIONS.redCellNear, BIOBUZZ_REGIONS.redCellFar]
        : [BIOBUZZ_REGIONS.blueCellNear, BIOBUZZ_REGIONS.blueCellFar],
    // Which CELL starts upward-facing is set up per-match by FIELD STAFF
    // (§10.3.1) and not fixed by the manual; the near (audience-side) CELL is
    // an arbitrary but consistent default.
    initialUpIndex: 0,
    tipThresholdCount: BIOBUZZ_HIVE_TIP_THRESHOLD,
    cellRestHeightM: inchesToMeters(HIVE_CELL_REST_HEIGHT_IN),
    cellHeightRateMps: 2,
    // A modest scatter so simultaneously-dumped balls do not perfectly
    // overlap; not a rule, just enough to avoid a degenerate stack.
    dumpSpeedMps: inchesToMeters(18),
  }),
);

/**
 * One route, not one per alliance: `MatchSimulation.routeMechanismActions`
 * resolves a fired action by matching its `action` kind against the first
 * route that declares it (mirroring DECODE's single `OWN_GOAL_ROUTE`, which
 * likewise maps both alliances in one object), so a second `'launch'` route
 * would simply never be reached. Each alliance's own HIVE is encoded in the
 * one alliance-keyed map instead.
 */
export const BIOBUZZ_MECHANISM_ACTION_ROUTES: readonly MechanismActionRoute[] = [
  {
    id: 'hive-launch',
    action: 'launch',
    dynamicDestinationStructureByAlliance: { red: 'red-hive', blue: 'blue-hive' },
    arcApexHeightM: inchesToMeters(HIVE_FRAME.pivotHeightIn.value + 4),
  },
];

// ------------------------------------------------------ reserve NECTAR ---

/**
 * Each alliance stages 8 NECTAR total: 3 pre-loaded in its own starting
 * up-facing CELL, 5 held in reserve until its HIVE tips (§10.3.1.B, §10.1,
 * G426). `biobuzzStaging.ts` assigns ids 1-3 to the pre-loaded three and 4-8
 * to the reserve, matching this list.
 */
export function reserveNectarIds(alliance: 'red' | 'blue'): readonly string[] {
  return [4, 5, 6, 7, 8].map((n) => `nectar-${alliance}-${n}`);
}

export const BIOBUZZ_RESERVE_FEEDS: readonly ReserveFeedSpec[] = (['red', 'blue'] as const).map((alliance) => ({
  id: `${alliance}-nectar-reserve`,
  pieceIds: reserveNectarIds(alliance),
  spawnZoneId: alliance === 'red' ? BIOBUZZ_ZONES.redLoadingZone : BIOBUZZ_ZONES.blueLoadingZone,
  triggerStructureId: `${alliance}-hive`,
  perTriggerCount: 1,
  // G426.B: "when 60 seconds or less remain in the MATCH, all remaining
  // NECTAR can be entered" — BIOBUZZ's ENDGAME sub-phase starts at exactly
  // that mark.
  releaseAllAtState: 'ENDGAME',
}));

// -------------------------------------------------------- elevated FLOWERs ---

/**
 * Holds a piece inside a FLOWER's scoring band once it arrives there.
 *
 * This 2D-plus-height engine has no true 3D stacking, so a FLOWER cannot
 * genuinely hold several pieces resting on top of one another the way the
 * real narrow tube does (§9.7); at most one piece is reliably held per
 * FLOWER at a time in this pass. The ownership/bottom-bonus rules in
 * `BIOBUZZ_RULE_SET` are still written generally (against arrival order, not
 * a fixed count), so they score correctly for however many pieces the
 * physics actually lets coexist, and will score correctly for more if a
 * future pass adds real stacking.
 */
const FLOWER_REST_HEIGHT_IN = FLOWER.topOpeningHeightIn.value - 4;

export const BIOBUZZ_ELEVATED_REGIONS: readonly ElevatedRegionSpec[] = [
  BIOBUZZ_REGIONS.flowerNorth,
  BIOBUZZ_REGIONS.flowerSouth,
  BIOBUZZ_REGIONS.flowerEast,
  BIOBUZZ_REGIONS.flowerWest,
].map((regionId) => ({
  id: `${regionId}-hold`,
  regionId,
  restHeightM: inchesToMeters(FLOWER_REST_HEIGHT_IN),
  heightRateMps: 2,
}));

// ------------------------------------------------------------------ rules ---

const HIVE_TIP_POINTS = explicit(20, 90, 'HIVE TIP 20 20 -', 'Table 10-2; same value in AUTO and TELEOP.');
const REMAINING_IN_CELL_POINTS = explicit(2, 90, 'POLLEN and/or NECTAR remaining in CELL - 2 -', 'Table 10-2.');
const BOTTOM_NECTAR_BONUS_POINTS = explicit(5, 90, 'Bottom NECTAR Bonus - 5 -', 'Table 10-2.');
const FLOWER_OWNED_POINTS = explicit(2, 91, 'POLLEN and/or NECTAR in an owned FLOWER - 2 -', 'Table 10-2.');
const GARDEN_POINTS = explicit(1, 91, 'GARDEN POLLEN and/or NECTAR in GARDEN - 1 -', 'Table 10-2.');
const LEAVE_POINTS = explicit(3, 90, 'Table 10-2 (reconstructed — see file banner).', 'LEAVE column value.');
const PARK_POINTS = explicit(5, 90, 'Table 10-2 (reconstructed — see file banner).', 'PARK column value.');

const CELL_REGION_IDS: readonly string[] = [
  BIOBUZZ_REGIONS.redCellNear,
  BIOBUZZ_REGIONS.redCellFar,
  BIOBUZZ_REGIONS.blueCellNear,
  BIOBUZZ_REGIONS.blueCellFar,
];

const cellAlliance = (regionId: string): 'red' | 'blue' => (regionId.startsWith('red') ? 'red' : 'blue');

const FLOWER_REGION_IDS: readonly string[] = [
  BIOBUZZ_REGIONS.flowerNorth,
  BIOBUZZ_REGIONS.flowerSouth,
  BIOBUZZ_REGIONS.flowerEast,
  BIOBUZZ_REGIONS.flowerWest,
];

export const BIOBUZZ_RULE_SET: readonly ScoringRule[] = [
  // HIVE TIP (§10.5.1, Table 10-2) — one rule covers both alliances' HIVEs:
  // `owner` resolves from the event's own `alliance` field.
  {
    id: 'hive-tip',
    label: 'HIVE TIP',
    phase: 'ANY',
    trigger: { event: 'StructureTipped', filters: [] },
    award: { points: HIVE_TIP_POINTS, alliance: 'owner' },
    contributesTo: ['pollinator1', 'pollinator2'],
  },

  // POLLEN/NECTAR remaining in the CELL at match end (§10.5.1 C, §10.5 C).
  ...CELL_REGION_IDS.map((regionId) => ({
    id: `remaining-in-cell-${regionId}`,
    label: `POLLEN/NECTAR remaining in ${regionId}`,
    phase: 'TELEOP' as const,
    trigger: { event: 'PieceCameToRest' as const, filters: [{ field: 'regionIds.0', equals: regionId }] },
    award: { points: REMAINING_IN_CELL_POINTS, alliance: cellAlliance(regionId) },
  })),

  // FLOWER ownership: every piece resting in a FLOWER at match end scores for
  // whichever alliance's NECTAR sits topmost there (§10.5.2), regardless of
  // which alliance placed it.
  ...FLOWER_REGION_IDS.flatMap((regionId) =>
    (['red', 'blue'] as const).map((owner) => ({
      id: `flower-owned-${regionId}-${owner}`,
      label: `${regionId} owned by ${owner}`,
      phase: 'ENDGAME' as const,
      trigger: { event: 'PieceCameToRest' as const, filters: [{ field: 'regionIds.0', equals: regionId }] },
      condition: { predicateId: 'regionLastArrivalHasType', params: { regionId, pieceType: `nectar-${owner}` } },
      award: { points: FLOWER_OWNED_POINTS, alliance: owner },
    })),
  ),

  // Bottom NECTAR Bonus: a flat, once-per-FLOWER credit to whichever alliance's
  // NECTAR is lowest (§10.5.2) — gated on piece identity so a FLOWER holding
  // several same-colour NECTAR cannot award this more than once.
  ...FLOWER_REGION_IDS.flatMap((regionId) =>
    (['red', 'blue'] as const).map((owner) => ({
      id: `bottom-nectar-bonus-${regionId}-${owner}`,
      label: `Bottom NECTAR bonus, ${regionId}, ${owner}`,
      phase: 'ENDGAME' as const,
      trigger: {
        event: 'PieceCameToRest' as const,
        filters: [
          { field: 'regionIds.0', equals: regionId },
          { field: 'pieceType', equals: `nectar-${owner}` },
        ],
      },
      condition: { predicateId: 'pieceIsRegionFirstArrival', params: { regionId } },
      award: { points: BOTTOM_NECTAR_BONUS_POINTS, alliance: owner },
    })),
  ),

  // GARDEN (§10.5.3): any piece resting there scores for that GARDEN's own
  // alliance regardless of who placed it.
  {
    id: 'garden-red',
    label: 'POLLEN/NECTAR in red GARDEN',
    phase: 'ENDGAME',
    trigger: { event: 'PieceCameToRest', filters: [{ field: 'regionIds.0', equals: BIOBUZZ_REGIONS.redGarden }] },
    award: { points: GARDEN_POINTS, alliance: 'red' },
  },
  {
    id: 'garden-blue',
    label: 'POLLEN/NECTAR in blue GARDEN',
    phase: 'ENDGAME',
    trigger: { event: 'PieceCameToRest', filters: [{ field: 'regionIds.0', equals: BIOBUZZ_REGIONS.blueGarden }] },
    award: { points: GARDEN_POINTS, alliance: 'blue' },
  },

  // LEAVE (§10.5.4): the ROBOT is no longer contacting the perimeter wall,
  // assessed at the end of AUTO.
  {
    id: 'leave',
    label: 'LEAVE',
    phase: 'AUTO',
    trigger: { event: 'RobotAssessed', filters: [] },
    condition: { predicateId: 'robotNotInZone', params: { zoneIds: WALL_CONTACT_ZONE_IDS.join(',') } },
    award: { points: LEAVE_POINTS, alliance: 'owner' },
    contributesTo: ['swarm'],
  },

  // PARK (§10.5.4): at least partially in the LOADING ZONE, assessed at match end.
  {
    id: 'park-red',
    label: 'PARK (red)',
    phase: 'ENDGAME',
    trigger: { event: 'RobotOverlapsZone', filters: [{ field: 'zoneId', equals: BIOBUZZ_ZONES.redLoadingZone }] },
    award: { points: PARK_POINTS, alliance: 'owner' },
    contributesTo: ['swarm'],
  },
  {
    id: 'park-blue',
    label: 'PARK (blue)',
    phase: 'ENDGAME',
    trigger: { event: 'RobotOverlapsZone', filters: [{ field: 'zoneId', equals: BIOBUZZ_ZONES.blueLoadingZone }] },
    award: { points: PARK_POINTS, alliance: 'owner' },
    contributesTo: ['swarm'],
  },
];

// -------------------------------------------------------------- penalties ---

export const BIOBUZZ_PENALTIES: PenaltyValues = {
  minorToOpponent: explicitRule(5, 'S10.6', 'MINOR FOUL - a credit of 5 points towards the opponent\'s MATCH point total', 92),
  majorToOpponent: explicitRule(20, 'S10.6', 'MAJOR FOUL - a credit of 20 points towards the opponent\'s MATCH point total', 92),
};

export const BIOBUZZ_FOULS_ASSESSED_BY_REFEREE: Sourced<string> = assumed(
  'fouls are assessed by a human referee, not this simulator',
  'Every G-rule violation (e.g. G410\'s early NECTAR foul, G407\'s possession ' +
    'limit) is "as perceived by a REFEREE" (S10.6) — a judgement call, not a ' +
    'geometric fact this engine can decide. Recorded here so the values are ' +
    'available to a caller applying a foul manually, matching DECODE\'s own ' +
    'position on fouls.',
);

// ----------------------------------------------------------- ranking points ---

export const BIOBUZZ_RANKING_POINT_RULES: RankingPointRules = {
  win: explicitRule(3, 'S10.5.5', 'WIN - Completing a MATCH with more MATCH points than your opponent - 3', 91),
  tie: explicitRule(1, 'S10.5.5', 'TIE - Completing a MATCH with the same MATCH points as your opponent - 1', 91),
  criteria: [
    {
      id: 'swarm',
      label: 'SWARM RP',
      award: explicit(1, 91, 'SWARM RP', 'Table 10-2.'),
      thresholdByTier: {
        'all-other-events': explicitRule(16, 'S10.5.5', 'SWARM RP ... 16 Points', 91),
      },
    },
    {
      id: 'pollinator1',
      label: 'POLLINATOR 1 RP',
      award: explicit(1, 91, 'POLLINATOR 1 RP', 'Table 10-2.'),
      quantity: 'awards',
      thresholdByTier: {
        'all-other-events': explicitRule(4, 'S10.5.5', 'POLLINATOR 1 RP ... 4 TIPS', 91),
      },
    },
    {
      id: 'pollinator2',
      label: 'POLLINATOR 2 RP',
      award: explicit(1, 91, 'POLLINATOR 2 RP', 'Table 10-2.'),
      quantity: 'awards',
      thresholdByTier: {
        'all-other-events': explicitRule(7, 'S10.5.5', 'POLLINATOR 2 RP ... 7 TIPS', 91),
      },
    },
  ],
};

export const BIOBUZZ_RP_THRESHOLD_TIER: Sourced<string> = assumed(
  'all-other-events',
  'FIRST Championship and Regional Championship thresholds are "TBA" (Table ' +
    '10-3); only the "All Other Events" tier has a published number, so that ' +
    'is the only tier this fixture\'s ranking-point criteria declare.',
);

// ----------------------------------------------------------------- setup ---

export const BIOBUZZ_SETUP: MatchSetupSpec = {
  staging: [
    {
      id: 'pollen-in-flowers',
      label: 'POLLEN pre-loaded in FLOWERS',
      locationCount: explicitRule(4, 'S10.3.1', '4 POLLEN in each of the 4 FLOWERS (16)', 83),
      composition: explicitRule({ pollen: 4 }, 'S10.3.1', '4 POLLEN in each of the 4 FLOWERS (16)', 83),
    },
    {
      id: 'pollen-in-gardens',
      label: 'POLLEN pre-loaded in GARDENs',
      locationCount: explicitRule(2, 'S10.3.1', '4 POLLEN in the red GARDEN (4) ... 4 POLLEN in the blue GARDEN (4)', 83),
      composition: explicitRule({ pollen: 4 }, 'S10.3.1', '4 POLLEN in the red GARDEN (4) ... 4 POLLEN in the blue GARDEN (4)', 83),
    },
    {
      id: 'pollen-preloaded-robots',
      label: 'POLLEN pre-loaded in ROBOTS',
      // 4 POLLEN in each of the 4 ROBOTS on the FIELD (2 ALLIANCES x 2 teams).
      // This solo-practice simulator seats only one, so `biobuzzStaging.ts`
      // stages just that one robot's 4 — the same declared-vs-staged split
      // DECODE's own off-field ALLIANCE AREA pieces use.
      locationCount: explicitRule(4, 'S10.3.1', '4 POLLEN pre-loaded in each ROBOT (16)', 83),
      composition: explicitRule({ pollen: 4 }, 'S10.3.1', '4 POLLEN pre-loaded in each ROBOT (16)', 83),
    },
    {
      id: 'nectar-in-red-cell',
      label: 'Red NECTAR pre-loaded in the red upward-facing CELL',
      locationCount: explicitRule(1, 'S10.3.1', '3 NECTAR in each upward-facing CELL of corresponding color (6)', 83),
      composition: explicitRule({ 'nectar-red': 3 }, 'S10.3.1', '3 NECTAR in each upward-facing CELL of corresponding color (6)', 83),
    },
    {
      id: 'nectar-in-blue-cell',
      label: 'Blue NECTAR pre-loaded in the blue upward-facing CELL',
      locationCount: explicitRule(1, 'S10.3.1', '3 NECTAR in each upward-facing CELL of corresponding color (6)', 83),
      composition: explicitRule({ 'nectar-blue': 3 }, 'S10.3.1', '3 NECTAR in each upward-facing CELL of corresponding color (6)', 83),
    },
    {
      id: 'nectar-reserve-red',
      label: 'Red NECTAR held in reserve in the red ALLIANCE AREA',
      locationCount: explicitRule(1, 'S10.3.1', '5 NECTAR are in each ALLIANCE AREA of corresponding color (10)', 83),
      composition: explicitRule({ 'nectar-red': 5 }, 'S10.3.1', '5 NECTAR are in each ALLIANCE AREA of corresponding color (10)', 83),
    },
    {
      id: 'nectar-reserve-blue',
      label: 'Blue NECTAR held in reserve in the blue ALLIANCE AREA',
      locationCount: explicitRule(1, 'S10.3.1', '5 NECTAR are in each ALLIANCE AREA of corresponding color (10)', 83),
      composition: explicitRule({ 'nectar-blue': 5 }, 'S10.3.1', '5 NECTAR are in each ALLIANCE AREA of corresponding color (10)', 83),
    },
  ],
  maxPreloadPerRobot: explicitRule(4, 'S10.3.4', 'ROBOTS must start the MATCH contacting 4 pre-loaded POLLEN.', 84),
};
