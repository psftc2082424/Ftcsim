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

import { assumed, explicit, explicitRule, inferred, type Sourced } from '../sourced.js';
import type { MatchStructure } from '../matchStructure.js';
import type { Objective, ScoringRule } from '../scoring.js';
import type {
  MatchSetupSpec,
  MechanismActionRoute,
  PenaltyValues,
  RankingPointRules,
} from '../gameDefinition.js';
import { ARTIFACT, CONTROL_LIMIT, GOAL, ZONES } from './decodeDimensions.js';
import type { PieceConveyorSpec } from '../conveyor.js';
import { inchesToMeters } from '../../units/convert.js';
import { vec2 } from '../../math/vec2.js';

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

/**
 * Nominal diameter as printed, distinct from the toleranced spec above.
 *
 * Aliased rather than re-cited: a second copy had its own quote, which had lost
 * the trademark mark the manual prints and so no longer matched the source.
 */
export const ARTIFACT_NOMINAL_DIAMETER_IN = ARTIFACT.nominalDiameterIn;

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

/**
 * The MOTIF table as Figure 10-4 prints it, cited.
 *
 * Worth carrying separately from `DECODE_MOTIFS` because the figure settles the
 * *direction* the indices run — `GATE G P P G P P G P P SQUARE` — and that is
 * what decides which end of the RAMP an arriving artifact fills. Reading it the
 * other way silently mismatches every PATTERN.
 */
export const DECODE_MOTIF_TABLE = {
  gpp: explicit('GPP', 86, 'GATE G P P G P P G P P SQUARE', 'OBELISK tag ID 21.'),
  pgp: explicit('PGP', 86, 'GATE P G P P G P P G P SQUARE', 'OBELISK tag ID 22.'),
  ppg: explicit('PPG', 86, 'P P G P P G P P G SQUARE', 'OBELISK tag ID 23.'),
  repeats: explicit(
    3,
    86,
    'selects the MOTIF which is repeated 3 times to define the PATTERN colors for each of the 9 indices on the RAMP',
  ),
} as const;

export type DecodeMotifKey = keyof typeof DECODE_MOTIFS;

/**
 * SPIKE MARKS per alliance.
 *
 * §9.3 gives six on the field; §10.3.1 arranges them as three rows — near,
 * middle and far — which is three per alliance.
 */
export const SPIKE_MARKS_PER_ALLIANCE = explicit(
  2,
  63,
  'SPIKE MARK: 1 of 6 white tape marks 10 in. (25.40 cm) long used to identify the placement of 3 ARTIFACTS before the MATCH',
  'Six marks in three rows (near, middle, far per §10.3.1) gives two locations per row.',
);

/** Number of ordered scoring slots on a RAMP (§10.5.2: indices 1–9). */
export const RAMP_SLOT_COUNT = explicit(9, 86, 'Index 1 2 3 4 5 6 7 8 9');

/**
 * Seconds between successive CLASSIFIED artifacts leaving an opened RAMP.
 *
 * The manual establishes the GATE as a robot-activated gravity return but does
 * not publish its throughput. dSim's visible classifier flow is used as an
 * observational reference: balls leave as a controlled train rather than as a
 * single high-speed burst. The generic conveyor latches one activation until
 * its queue is empty, so this is a per-ball cadence rather than a requirement
 * that the robot remain in the GATE ZONE.
 */
export const RAMP_DRAIN_INTERVAL_SEC = inferred(
  0.35,
  'Observed dSim-style classifier cadence. The manual states the drain is not ' +
    'instantaneous but gives no throughput; a gate activation is latched until the queue empties.',
  72,
);

/**
 * Exit speed for a released ARTIFACT, m/s.
 *
 * dSim starts a gate-released ball near 22 in/s and lets ball-only rolling loss
 * settle it through the return. The manual supplies the tunnel geometry but no
 * release speed, so this is explicitly inferred rather than pretending the
 * previous full-length-ramp calculation was a sourced fact.
 */
export const TUNNEL_EXIT_SPEED_MPS = inferred(
  inchesToMeters(22),
  'dSim-style observed gate-release speed; the manual specifies no release rate.',
  72,
);

/** dSim-observed downslope guide for the physical classifier lane. */
export const CLASSIFIER_LANE_ACCELERATION_MPS2 = inferred(
  inchesToMeters(80),
  'dSim rail acceleration (80 in/s²) used as an observable guide for the physical lane; the manual gives no slope acceleration.',
  72,
);

/** Limited funnel pull so a landed ball joins the six-inch classifier lane. */
export const CLASSIFIER_LANE_CENTERING_ACCELERATION_MPS2 = inferred(
  inchesToMeters(80),
  'dSim-style funnel guide, capped at the same 80 in/s² scale as the rail acceleration.',
  72,
);

/** dSim's stronger GOAL-funnel surface pulls accepted balls toward the arch. */
export const GOAL_BASIN_FUNNEL_ACCELERATION_MPS2 = inferred(
  inchesToMeters(1150),
  'dSim uses 1150 in/s² for its retained GOAL basin funnel. It represents the equivalent of the sloped/funnel surfaces, not a launcher force.',
  72,
);

/** Raised centre heights observed in dSim and confirmed as assemblies by the STEP model. */
export const CLASSIFIER_BASIN_HEIGHT_M = inferred(
  inchesToMeters(14),
  'dSim models the retained GOAL basin floor at 14 in; the STEP assembly confirms GOAL/RAMP are elevated physical assemblies, not field-floor regions.',
  72,
);

export const CLASSIFIER_SURFACE_HEIGHT_M = inferred(
  inchesToMeters(10),
  'dSim models normal classifier balls on a 10 in raised rail; the STEP model contains the corresponding upper/lower ramp assemblies.',
  72,
);

/** A tenth ball rides the upper physical overflow path above the packed column. */
export const CLASSIFIER_OVERFLOW_HEIGHT_M = inferred(
  inchesToMeters(13.5),
  'dSim places overflow above the 10 in classifier rail at 13.5 in. The manual establishes overflow but not its exact ball-centre height.',
  72,
);

/**
 * Physical approach point for the GOAL-to-classifier throat.
 *
 * dSim's logical rail hand-off is at y=57 in.  In this simulator the same
 * transition is performed by a 5 in physical disc around a 2 in face wall, so
 * the basin first aims at the clear side of that arch (y=68 in); normal lane
 * guidance then carries it down through the observed 57 in throat.
 */
export const CLASSIFIER_BASIN_THROAT = inferred(
  { xIn: 69, yIn: 68 },
  'Adapted from dSim\'s x = field half - 3 in, y = gate origin + 55 in rail hand-off: the physical disc/face-wall clearance requires a short turn at the back of the basin before the same lane flow.',
  72,
);

/** Field-facing point immediately outside dSim's clipped GOAL-to-ramp throat. */
export const CLASSIFIER_INBOUND_REJECT_POINT = inferred(
  { xIn: 63, yIn: 57 },
  'dSim clips the GOAL face at the six-inch classifier channel and projects ordinary ground balls out of that channel on the field side.',
  72,
);

/** Shared GOAL/ramp guide surface reaches the physical basin hand-off neighbourhood. */
export const CLASSIFIER_BASIN_HANDOFF_DISTANCE_M = inferred(
  inchesToMeters(10),
  "dSim's basin and rail overlap at the GOAL/classifier arch; the physical disc model hands to lane guidance within a 10 in throat neighbourhood rather than requiring a centre to occupy the wall corner.",
  72,
);

// ---------------------------------------------------------------- regions ---

/**
 * Region ids the rules reference.
 *
 * Alliance-scoped because DEPOTS and GOALS are alliance specific (§10.5.1).
 */
export const DECODE_REGIONS = {
  /**
   * The open top of the GOAL, which an ARTIFACT has to clear to score.
   *
   * Carries a vertical span starting at the top lip, 38.75 in above the TILE
   * (§9.7), so entering it means being *above* it — a shot, not a piece pushed
   * along the floor. This is where CLASSIFIED and OVERFLOW are decided; the
   * RAMP below is where they come to rest and PATTERN reads them.
   */
  redGoal: 'red-goal',
  blueGoal: 'blue-goal',
  redRamp: 'red-ramp',
  blueRamp: 'blue-ramp',
  redDepot: 'red-depot',
  blueDepot: 'blue-depot',
} as const;

/**
 * Why there is no OVERFLOW region.
 *
 * The glossary makes both outcomes properties of one arrival: CLASSIFIED is "an
 * ARTIFACT that passes through the SQUARE and transitions directly to the RAMP",
 * OVERFLOW is "an ARTIFACT that passes through the SQUARE but does not meet
 * CLASSIFIED criteria", and §9.8.2 gives the criterion — "The RAMP can fit up to
 * 9 CLASSIFIED ARTIFACTS before newly entered ARTIFACTS will OVERFLOW."
 *
 * OVERFLOW is therefore a *state*, not a place. It used to be modelled as a
 * second region with invented coordinates, which meant two things were wrong at
 * once: an artifact scored OVERFLOW by reaching a made-up patch of floor, and a
 * tenth artifact reaching a full RAMP still scored CLASSIFIED. Both rules now
 * trigger on the same arrival and are told apart by capacity, which deletes a
 * set of invented coordinates rather than adding any.
 *
 * **Not modelled:** §9.8.2 also says an artifact "LAUNCHED into the GOAL at a
 * high velocity or with significant spin may skip over the 9th open CLASSIFIER
 * slot and count as OVERFLOW". That is stochastic and depends on a launch this
 * simulator cannot yet make. Recorded in ASSUMPTIONS.md §10.15.
 */
export const RAMP_ARRIVAL = 'classified-or-overflow-by-capacity';

export const DECODE_ZONES = {
  redBase: 'red-base',
  blueBase: 'blue-base',
  /**
   * The two LAUNCH ZONES are FIELD property, not an alliance's (§9.3), so they
   * are named for the side of the field they sit on rather than for a colour.
   */
  audienceLaunchZone: 'audience-launch-zone',
  goalLaunchZone: 'goal-launch-zone',
  /** Each alliance's half, which G402 defines as three FIELD columns each. */
  redSide: 'red-side',
  blueSide: 'blue-side',
  /**
   * Zones the setup guide places by TILE and the rules describe but do not yet
   * score against. Present because they are part of a correct FIELD, and
   * because a rule that needs one should find it rather than need a layout
   * change: LOADING ZONE and SECRET TUNNEL ZONE are alliance property (§9.3),
   * and the GATE ZONE bounds where a ROBOT may operate a GATE (G417).
   */
  redLoadingZone: 'red-loading-zone',
  blueLoadingZone: 'blue-loading-zone',
  redGateZone: 'red-gate-zone',
  blueGateZone: 'blue-gate-zone',
  redSecretTunnel: 'red-secret-tunnel',
  blueSecretTunnel: 'blue-secret-tunnel',
} as const;

/**
 * Region id for one of an alliance's three SPIKE MARKS.
 *
 * Ordered audience side inward, matching how §10.3.1 reads the staging: index 0
 * is Near, 1 Middle, 2 Far.
 */
export function spikeMarkId(alliance: 'red' | 'blue', index: number): string {
  return `${alliance}-spike-${index}`;
}

/** The three SPIKE MARK ids for an alliance, Near to Far. */
export function spikeMarkIds(alliance: 'red' | 'blue'): readonly string[] {
  return [0, 1, 2].map((index) => spikeMarkId(alliance, index));
}

/**
 * Every zone LEAVE is assessed against, comma-separated for `robotNotInZone`.
 *
 * §10.5.3 says "no longer over **any** LAUNCH LINE", and LAUNCH LINES are not
 * an alliance's property: §9.3 puts one LAUNCH ZONE on the audience side and one
 * on the GOAL side, both belonging to the FIELD.
 *
 * ── Known incompleteness ───────────────────────────────────────────────
 *
 * §9.3 also makes the DEPOT tape a LAUNCH LINE ("The DEPOT tape is a LAUNCH
 * LINE"), and the DEPOT is modelled here as a *region* — a place artifacts rest
 * — not as a zone a robot's support is measured against. A robot parked over a
 * DEPOT at the end of AUTO therefore scores LEAVE here and would not on a real
 * field. Recorded in ASSUMPTIONS.md §10.12 rather than papered over; fixing it
 * means giving the DEPOT a zone as well as a region, which needs the positions
 * this layout does not yet have.
 */
export const ALL_LAUNCH_LINE_ZONE_IDS = `${DECODE_ZONES.audienceLaunchZone},${DECODE_ZONES.goalLaunchZone}`;

/**
 * BASE ZONE side, re-exported from the transcribed dimensions.
 *
 * Was a second copy with its own citation, which drifted: it named p.61 where
 * the text is on p.62. A dimension should exist once, so this is now an alias.
 */
export const BASE_ZONE_SIDE_IN = ZONES.baseZoneSideIn;

// ------------------------------------------------------------- CLASSIFIER ---

/**
 * The CLASSIFIER, as a piece conveyor (`game/conveyor.ts`).
 *
 * §10.5.1 describes the path an ARTIFACT takes: "enter the GOAL through the open
 * top, exit under the archway, and pass through the diverting SQUARE". What
 * happens next is capacity: "The RAMP can fit up to 9 CLASSIFIED ARTIFACTS
 * before newly entered ARTIFACTS will OVERFLOW" (§9.8.2), and OVERFLOW
 * artifacts "pass over the top of the GATE to exit the RAMP into the opposing
 * ALLIANCE'S SECRET TUNNEL ZONE" (§9.8.3).
 *
 * That is one conveyor exactly: a GOAL to arrive in, a RAMP to queue on, a GATE
 * a ROBOT holds open, and the opposing SECRET TUNNEL to come out into.
 *
 * ── Which tunnel, and why it settles a conflict ────────────────────────────
 *
 * §9.8.3 makes the pairing geometric rather than a matter of colour: a GATE
 * releases into the **opposing** ALLIANCE'S SECRET TUNNEL ZONE, and G424.A
 * contemplates a ROBOT being in its own GATE ZONE and its opponent's SECRET
 * TUNNEL ZONE at once — so the two are adjacent. The setup guide puts the blue
 * GATE ZONE on TILES A3/A4 and a SECRET TUNNEL on A2/A3 immediately below it,
 * and labels that tunnel red. Read through §9.8.3 the guide is right and
 * consistent; see `DECODE_SETUP_GUIDE_COLOUR_CONFLICT`.
 */
export const DECODE_CONVEYORS: readonly PieceConveyorSpec[] = (['red', 'blue'] as const).map(
  (alliance) => ({
    id: `${alliance}-classifier`,
    entryRegionId: alliance === 'red' ? DECODE_REGIONS.redGoal : DECODE_REGIONS.blueGoal,
    queueRegionId: alliance === 'red' ? DECODE_REGIONS.redRamp : DECODE_REGIONS.blueRamp,
    capacity: RAMP_SLOT_COUNT.value,
    // G417: a ROBOT may not contact the opposing ALLIANCE'S GATE, so only the
    // owner opens it. The GATE is "a ROBOT-activated, push to open mechanism"
    // (§9.8.3) and the GATE ZONE is the 2.75 in strip "adjacent to each GATE"
    // (§9.3) — a ROBOT in it is by construction pushing the arm, and the GATE
    // "is closed by gravity" the moment it stops.
    releaseZoneId: alliance === 'red' ? DECODE_ZONES.redGateZone : DECODE_ZONES.blueGateZone,
    releaseAlliance: alliance,
    // The opposing ALLIANCE'S, per §9.8.3.
    exitZoneId:
      alliance === 'red' ? DECODE_ZONES.blueSecretTunnel : DECODE_ZONES.redSecretTunnel,
    blocksInboundExit: true,
    lane: {
      receivingBasin: true,
      receivingBasinTargetM: vec2(
        inchesToMeters(alliance === 'red' ? CLASSIFIER_BASIN_THROAT.value.xIn : -CLASSIFIER_BASIN_THROAT.value.xIn),
        inchesToMeters(CLASSIFIER_BASIN_THROAT.value.yIn),
      ),
      receivingBasinHandoffDistanceM: CLASSIFIER_BASIN_HANDOFF_DISTANCE_M.value,
      receivingBasinHeightM: CLASSIFIER_BASIN_HEIGHT_M.value,
      receivingBasinAccelerationMps2: GOAL_BASIN_FUNNEL_ACCELERATION_MPS2.value,
      inboundRejectPointM: vec2(
        inchesToMeters(alliance === 'red' ? CLASSIFIER_INBOUND_REJECT_POINT.value.xIn : -CLASSIFIER_INBOUND_REJECT_POINT.value.xIn),
        inchesToMeters(CLASSIFIER_INBOUND_REJECT_POINT.value.yIn),
      ),
      travelDirection: vec2(0, -1),
      driveAccelerationMps2: CLASSIFIER_LANE_ACCELERATION_MPS2.value,
      // The same speed a released ARTIFACT already leaves the GATE at
      // (`exitVelocityMps` below): one coherent "how fast do these balls
      // move" number rather than the lane quietly running faster or slower
      // than the piece it eventually hands off to the SECRET TUNNEL.
      maxDriveSpeedMps: TUNNEL_EXIT_SPEED_MPS.value,
      lateralCenteringAccelerationMps2: CLASSIFIER_LANE_CENTERING_ACCELERATION_MPS2.value,
      surfaceHeightM: CLASSIFIER_SURFACE_HEIGHT_M.value,
      surfaceHeightRateMps: inchesToMeters(30),
      gateColliderTag: `${alliance}-classifier-gate`,
      overflowHeightM: CLASSIFIER_OVERFLOW_HEIGHT_M.value,
      overflowHeightRateMps: inchesToMeters(30),
      // A scored shot strikes the GOAL's internal funnel rather than retaining
      // enough across-basin momentum to cross the open plan-view footprint.
      entryVelocityRetention: 0.05,
    },
    // Every SECRET TUNNEL runs the same way regardless of which side of the
    // field it is mirrored to: audience-side tiles are the lower seam numbers
    // (`decodeTiles.ts`), so "out of the tunnel" is toward -Y for both
    // alliances. Only X mirrors between them; this does not.
    exitVelocityMps: vec2(0, -TUNNEL_EXIT_SPEED_MPS.value),
    drainIntervalSec: RAMP_DRAIN_INTERVAL_SEC.value,
  }),
);

/**
 * Clearance a shot arcs to above the GOAL's top lip, inches.
 *
 * Not sourced — the manual gives the lip height (38.75 in, §9.7) but nothing
 * about how a robot actually aims over it. This is the margin that makes a
 * correctly-aimed shot clear reliably rather than by luck: enough that the
 * piece's own radius (about 2.45 in) plus ordinary numerical slack cannot put
 * it back under the lip at the moment it crosses over.
 */
const GOAL_CLEARANCE_MARGIN_IN = 6;

/**
 * DECODE scoring actions use the owning alliance's GOAL.
 *
 * The game rules make entering a GOAL's open top the scored action (§10.5.1).
 * A capable, enabled launcher gives its held ARTIFACT a real ballistic arc
 * toward that opening (`sim/simWorld.ts`'s `launchPieceTowards`) — high enough
 * to clear the GOAL assembly's 54 in backboard, not merely the 38.75 in scoring
 * lip — and the normal region event, rules and
 * CLASSIFIER still decide CLASSIFIED versus OVERFLOW from where it actually
 * lands. No score is granted by this route itself.
 */
export const DECODE_MECHANISM_ACTION_ROUTES: readonly MechanismActionRoute[] = [
  {
    id: 'own-goal-launch',
    action: 'launch',
    destinationRegionByAlliance: {
      red: DECODE_REGIONS.redGoal,
      blue: DECODE_REGIONS.blueGoal,
    },
    arcApexHeightM: inchesToMeters(GOAL.heightIn.value + GOAL_CLEARANCE_MARGIN_IN),
  },
];

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
          // Deduced from an absence, so `inferred` rather than `explicit`: the
          // manual gives the match exactly two periods and the word ENDGAME
          // appears nowhere in it. Zero means the sub-phase never opens.
          startsAtRemainingSec: inferred(
            0,
            'The manual defines AUTO and TELEOP and no third period; "ENDGAME" does ' +
              'not appear anywhere in it. BASE is assessed at the end of TELEOP.',
            83,
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
  /**
   * The gap is dead time for the robots but not for the score.
   *
   * An artifact launched in the last second of AUTO is still in the air when
   * the clock hits 0:30, and the manual attributes it to AUTO — which is what
   * the 8 seconds are for.
   */
  transitionScoresAs: explicit(
    'AUTO',
    83,
    'ARTIFACTS that meet scoring criteria prior to the start of TELEOP are assessed as part of AUTO',
  ),
};

// ------------------------------------------------------------ point values ---

/** Table 10-2, DECODE point values (§10.5.4, p.88). */
export const DECODE_POINTS = {
  leaveAuto: explicit(3, 88, 'LEAVE 3', 'AUTO column; the row has no TELEOP entry'),
  classifiedAuto: explicit(3, 88, 'CLASSIFIED 3 3', 'AUTO column'),
  classifiedTeleop: explicit(3, 88, 'CLASSIFIED 3 3', 'TELEOP column'),
  overflowAuto: explicit(1, 88, 'ARTIFACT OVERFLOW 1 1', 'AUTO column'),
  overflowTeleop: explicit(1, 88, 'ARTIFACT OVERFLOW 1 1', 'TELEOP column'),
  depotTeleop: explicit(1, 88, 'DEPOT 1', 'TELEOP column; the row has no AUTO entry'),
  patternAuto: explicit(2, 88, 'PATTERN ARTIFACT matches MOTIF 2 2', 'AUTO column'),
  patternTeleop: explicit(2, 88, 'PATTERN ARTIFACT matches MOTIF 2 2', 'TELEOP column'),
  basePartial: explicit(5, 88, 'Partially returned to BASE 5'),
  baseFull: explicit(10, 88, 'Fully returned to BASE 10'),
  baseBothBonus: explicit(
    10,
    88,
    'Additional Bonus: 2 ROBOTS fully',
    'Table 10-2, TELEOP column: 10. The PDF wraps "returned to BASE." onto the ' +
      'line below the value, so the label and its value are not contiguous.',
  ),
} as const;

/**
 * Ranking points (Tables 10-2 and 10-3, p.88).
 *
 * Recorded but **not** scored by the rules engine: RP decides tournament
 * ranking rather than match score, and an RP is earned by an alliance's whole
 * match performance rather than by any single event. A caller that wants them
 * computes them from the final score with `decodeRankingPointsFor` below.
 */
export const DECODE_RANKING_POINTS = {
  win: explicit(
    3,
    88,
    'Completing a MATCH with more MATCH points than your',
    'Table 10-2, WIN row: 3. The PDF wraps "opponent" below the value.',
  ),
  tie: explicit(
    1,
    88,
    'Completing a MATCH with the same MATCH points as your',
    'Table 10-2, TIE row: 1. The PDF wraps "opponent" below the value.',
  ),
  movement: explicit(
    1,
    88,
    'Combined LEAVE + BASE points earned at or above',
    'Table 10-2, MOVEMENT RP row: 1. The PDF wraps "threshold" below the value.',
  ),
  goal: explicit(
    1,
    88,
    'The number of ARTIFACTS scored through the SQUARE at or',
    'Table 10-2, GOAL RP row: 1. The PDF wraps "above threshold" below the value.',
  ),
  pattern: explicit(
    1,
    88,
    'PATTERN RP - PATTERN points earned at or above threshold',
    'Table 10-2, PATTERN RP row: 1.',
  ),
} as const;

/**
 * Event tiers, because DECODE's RP thresholds are not one set of numbers.
 *
 * Table 10-3 gives three columns, and the manual adds that Championship
 * thresholds may still move ("RP thresholds for Regional Championships and FIRST
 * Championship will be announced in Team Updates") and that Premier Events set
 * their own. So a threshold is only meaningful alongside the tier it came from,
 * and the tier is the caller's choice rather than a property of the game.
 */
export type DecodeEventTier = 'firstChampionship' | 'regionalChampionship' | 'other';

/** Table 10-3 (p.88), transcribed column by column. */
export const DECODE_RP_THRESHOLDS: Readonly<
  Record<DecodeEventTier, Readonly<Record<'movement' | 'goal' | 'pattern', Sourced<number>>>>
> = {
  firstChampionship: {
    movement: explicit(21, 88, 'MOVEMENT RP 21 21 16', 'FIRST Championship column'),
    goal: explicit(67, 88, 'GOAL RP 67 42 36', 'FIRST Championship column'),
    pattern: explicit(22, 88, 'PATTERN RP 22 22 18', 'FIRST Championship column'),
  },
  regionalChampionship: {
    movement: explicit(21, 88, 'MOVEMENT RP 21 21 16', 'Regional Championships column'),
    goal: explicit(42, 88, 'GOAL RP 67 42 36', 'Regional Championships column'),
    pattern: explicit(22, 88, 'PATTERN RP 22 22 18', 'Regional Championships column'),
  },
  other: {
    movement: explicit(16, 88, 'MOVEMENT RP 21 21 16', 'All Other Events column'),
    goal: explicit(36, 88, 'GOAL RP 67 42 36', 'All Other Events column'),
    pattern: explicit(18, 88, 'PATTERN RP 22 22 18', 'All Other Events column'),
  },
} as const;

/**
 * Two of the three tiers are provisional, and that is the manual's own
 * statement rather than a caveat added here.
 */
export const DECODE_RP_THRESHOLD_STABILITY = explicit(
  false,
  88,
  'RP thresholds for Regional Championships and FIRST Championship will be announced in Team Updates. *Premier Events will be able to set their own thresholds to best reflect the experience they want to provide teams.',
);

/**
 * DECODE's ranking points as definition data.
 *
 * The criterion ids are the keys a caller supplies totals under, and each says
 * what it measures rather than naming a rule — `rankingPointsFor` in
 * `gameDefinition.ts` does the arithmetic and knows nothing about DECODE.
 *
 * Does not model the rules that make an alliance *ineligible* for an RP (G206,
 * G417, G418, G431). Those are referee judgement, and the simulator has no
 * referee. See ASSUMPTIONS.md §10.13.
 */
/**
 * Ranking-point criterion ids, named once.
 *
 * Rules tag themselves with these through `contributesTo`, and the criteria
 * below are keyed by them. A typo in either place would silently measure
 * nothing, so both sides read the same constant.
 */
export const DECODE_RP_CRITERIA = {
  movement: 'movement',
  goal: 'goal',
  pattern: 'pattern',
} as const;

export const DECODE_RANKING_POINT_RULES: RankingPointRules = {
  win: DECODE_RANKING_POINTS.win,
  tie: DECODE_RANKING_POINTS.tie,
  criteria: [
    {
      id: DECODE_RP_CRITERIA.movement,
      label: 'MOVEMENT RP - combined LEAVE + BASE points',
      award: DECODE_RANKING_POINTS.movement,
      thresholdByTier: tierMap('movement'),
      // "Combined LEAVE + BASE points earned at or above threshold" (p.88).
      quantity: 'points',
    },
    {
      id: DECODE_RP_CRITERIA.goal,
      label: 'GOAL RP - ARTIFACTS scored through the SQUARE',
      award: DECODE_RANKING_POINTS.goal,
      thresholdByTier: tierMap('goal'),
      /**
       * "The **number of** ARTIFACTS scored through the SQUARE" (p.88) — a
       * count, not points. The thresholds prove it cannot be points *or* a
       * count of distinct artifacts: 67 exceeds the 36 a field holds, because
       * artifacts recirculate through the SECRET TUNNEL and can be scored
       * again. Both CLASSIFIED and OVERFLOW pass through the SQUARE, so both
       * contribute (§10.5.1).
       */
      quantity: 'awards',
    },
    {
      id: DECODE_RP_CRITERIA.pattern,
      label: 'PATTERN RP - PATTERN points',
      award: DECODE_RANKING_POINTS.pattern,
      thresholdByTier: tierMap('pattern'),
      // "PATTERN points earned at or above threshold" (p.88).
      quantity: 'points',
    },
  ],
};

function tierMap(
  criterion: 'movement' | 'goal' | 'pattern',
): Readonly<Record<DecodeEventTier, Sourced<number>>> {
  return {
    firstChampionship: DECODE_RP_THRESHOLDS.firstChampionship[criterion],
    regionalChampionship: DECODE_RP_THRESHOLDS.regionalChampionship[criterion],
    other: DECODE_RP_THRESHOLDS.other[criterion],
  };
}

// -------------------------------------------------------------- penalties ---

/**
 * Table 10-4 (p.89). Point values only.
 *
 * A foul is *credited to the opponent's* total rather than deducted from the
 * violator's, which matters: a penalised alliance's own score is unchanged.
 *
 * None of DECODE's violations are simulated, and that is a limit of the
 * simulator rather than an omission from the manual. Every foul turns on
 * referee perception — the manual says so directly, "All rules throughout the
 * Game Rules section are called as perceived by a REFEREE" (p.89) — and on
 * judgements like MOMENTARY, PERSISTENT and REPEATED that no geometric
 * predicate decides. The values are recorded so a caller applying a foul
 * externally uses the right number.
 */
export const DECODE_PENALTIES: PenaltyValues = {
  minorToOpponent: explicit(
    5,
    89,
    "a credit of 5 points towards the opponent's MATCH point total",
    'Table 10-4, MINOR FOUL row. The PDF renders the two penalty labels above ' +
      'their two descriptions, so the label and its value are not adjacent in ' +
      'the extracted text; 5 is the first description and MINOR FOUL the first label.',
  ),
  majorToOpponent: explicit(
    15,
    89,
    "a credit of 15 points towards the opponent's MATCH point total",
    'Table 10-4, MAJOR FOUL row.',
  ),
};

/**
 * Recorded as a fact about the source, not as a value: fouls are judgement, not
 * geometry, so no amount of simulation detail would let the engine assess one.
 */
export const DECODE_FOULS_ASSESSED_BY_REFEREE = explicit(
  true,
  89,
  'All rules throughout the Game Rules section are called as perceived by a REFEREE.',
);

// ------------------------------------------------------------ robot limits ---

/**
 * Sizing rules, re-read against the manual.
 *
 * An earlier version cited R104 for the starting cube and p.103 for both
 * expansion limits. R104 is "Keep it together" and says nothing about size; the
 * sizing rules are R101 (p.121) and R105 (p.123). Corrected here, and worth
 * noting as the failure mode a citation is supposed to catch — the *values*
 * were right, so nothing downstream was wrong, and only the citation revealed
 * that they had not actually been read from where they claimed.
 */
export const DECODE_ROBOT_CONSTRAINTS = {
  startingCubeIn: explicitRule(
    18,
    'R101',
    'the ROBOT must be fully self-contained within an 18 in. (45.70 cm) wide, by 18 in. (45.70 cm) long, by 18 in. (45.70 cm) high volume',
    121,
  ),
  /**
   * The 38 in ceiling is conditional, not a general limit: R105.C allows it only
   * "within the limitations per G415", and G415 permits it only during the final
   * 20 seconds and only outside every LAUNCH ZONE. Modelled as the maximum a
   * legal robot may ever reach, which is what a builder needs; the conditions
   * are a referee's call and are not simulated (ASSUMPTIONS.md §10.13).
   */
  maxExpandedHeightIn: explicitRule(
    38,
    'R105.C',
    'Within the limitations per G415, ROBOTS may expand vertically up to 38 in. (96.50 cm).',
    123,
  ),
  horizontalExpansionIn: explicitRule(
    18,
    'R105.A',
    'ROBOTS may expand horizontally but must remain within a fixed 18 in. (45.70 cm) by 18 in. (45.70 cm) when fully expanded per G414',
    123,
  ),
} as const;

/**
 * DECODE sets no weight limit, which is why nothing here caps robot mass.
 *
 * Recorded rather than left implicit: a simulator that silently clamped mass
 * would be enforcing a rule the game does not have, and mass is the single
 * biggest determinant of acceleration in the drivetrain model.
 */
export const DECODE_HAS_NO_WEIGHT_LIMIT = explicitRule(
  true,
  'R103',
  'There is no explicit weight limit for FIRST Tech Challenge ROBOTS.',
  122,
);

// ----------------------------------------------------------- match staging ---

/**
 * Where the 36 ARTIFACTS start, per §10.3.1 (p.81).
 *
 * Composition only — the manual gives the full staging but leaves SPIKE MARK and
 * LOADING ZONE *positions* to the CAD, like every other coordinate in DECODE.
 *
 * The arrangements are stated to read outward: "with the MOTIFS starting from
 * the middle of the FIELD and continuing toward the FIELD perimeter". The three
 * SPIKE MARK rows carry the three MOTIFS, which is what makes them worth
 * transcribing rather than summarising as "18 artifacts on spike marks" — a
 * robot that knows which row holds which colours can plan its AUTO.
 *
 * It adds up exactly: 12 green and 24 purple, matching §9.9. That reconciliation
 * is enforced by `validateGameDefinition`, so a mistranscribed group fails at
 * load rather than starting a match with the wrong pieces.
 */
export const DECODE_SETUP: MatchSetupSpec = {
  staging: [
    {
      id: 'spike-near',
      label: 'SPIKE MARKS, audience side',
      locationCount: SPIKE_MARKS_PER_ALLIANCE,
      arrangement: explicit(
        ['G', 'P', 'P'],
        81,
        '3 ARTIFACTS on each SPIKE MARK arranged as follows: i. Near (audience side): GPP',
      ),
    },
    {
      id: 'spike-middle',
      label: 'SPIKE MARKS, middle',
      locationCount: SPIKE_MARKS_PER_ALLIANCE,
      arrangement: explicit(['P', 'G', 'P'], 81, 'ii. Middle: PGP'),
    },
    {
      id: 'spike-far',
      label: 'SPIKE MARKS, GOAL side',
      locationCount: SPIKE_MARKS_PER_ALLIANCE,
      arrangement: explicit(['P', 'P', 'G'], 81, 'iii. Far (GOAL side): PPG'),
    },
    {
      id: 'loading-zone',
      label: 'LOADING ZONES',
      locationCount: explicit(2, 81, '3 ARTIFACTS (2P, 1G) in each LOADING ZONE', 'One per alliance.'),
      arrangement: explicit(
        ['P', 'G', 'P'],
        81,
        '3 ARTIFACTS (2P, 1G) in each LOADING ZONE biased against the FIELD perimeter adjacent to the ALLIANCE AREA and closest to the corner arranged PGP',
      ),
    },
    {
      id: 'alliance-area',
      label: 'ALLIANCE AREAS',
      locationCount: explicit(
        2,
        81,
        '6 ARTIFACTS (4P, 2G) in each ALLIANCE AREA',
        'One per alliance.',
      ),
      // No arrangement: the manual says "with no set order", so a composition is
      // the whole truth rather than an ordering invented to fill the field.
      composition: explicit(
        { P: 4, G: 2 },
        81,
        '6 ARTIFACTS (4P, 2G) in each ALLIANCE AREA (may be organized in provided ARTIFACT tray or similar container) with no set order',
      ),
    },
  ],
  maxPreloadPerRobot: explicit(
    3,
    81,
    'Each ROBOT may be pre-loaded with up to 3 ARTIFACTS from their own ALLIANCE AREA pre-staged ARTIFACTS in C such that each ARTIFACT is in direct contact with the ROBOT.',
  ),
};

/**
 * Staging is not fixed across every event, and the manual says so.
 *
 * Recorded so a Championship result computed from this fixture is not mistaken
 * for the real thing.
 */
export const DECODE_STAGING_MAY_BE_MODIFIED = explicit(
  true,
  81,
  'the number, type, and distribution of SCORING ELEMENTS may be adjusted for the FIRST Championship and FIRST Premier Events',
);

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
    contributesTo: [DECODE_RP_CRITERIA.pattern],
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
    const goal = alliance === 'red' ? DECODE_REGIONS.redGoal : DECODE_REGIONS.blueGoal;
    const ramp = alliance === 'red' ? DECODE_REGIONS.redRamp : DECODE_REGIONS.blueRamp;
    const depot = alliance === 'red' ? DECODE_REGIONS.redDepot : DECODE_REGIONS.blueDepot;
    const base = alliance === 'red' ? DECODE_ZONES.redBase : DECODE_ZONES.blueBase;

    return [
      // CLASSIFIED and OVERFLOW are the same arrival, told apart by whether the
      // RAMP still had room. See `RAMP_ARRIVAL` below for why they are not two
      // places.
      ...(['AUTO', 'TELEOP'] as const).flatMap((phase) => {
        const classified =
          phase === 'AUTO' ? DECODE_POINTS.classifiedAuto : DECODE_POINTS.classifiedTeleop;
        const overflowed =
          phase === 'AUTO' ? DECODE_POINTS.overflowAuto : DECODE_POINTS.overflowTeleop;

        // Entering the GOAL means clearing its lip, so only a shot scores.
        const arrival = {
          event: 'PieceEnteredRegion' as const,
          filters: [{ field: 'regionId', equals: goal }],
        };

        return [
          {
            id: `${alliance}-classified-${phase.toLowerCase()}`,
            contributesTo: [DECODE_RP_CRITERIA.goal],
            label: `${alliance} CLASSIFIED (${phase})`,
            phase,
            trigger: arrival,
            // The RAMP still has room, so this one is CLASSIFIED.
            condition: {
              predicateId: 'regionHoldsFewerThan',
              params: { regionId: ramp, count: RAMP_SLOT_COUNT.value },
            },
            award: { points: classified, alliance },
          },
          {
            id: `${alliance}-overflow-${phase.toLowerCase()}`,
            contributesTo: [DECODE_RP_CRITERIA.goal],
            label: `${alliance} OVERFLOW (${phase})`,
            phase,
            trigger: arrival,
            // The RAMP was already full when this one arrived (§9.8.2).
            condition: {
              predicateId: 'regionHoldsAtLeast',
              params: { regionId: ramp, count: RAMP_SLOT_COUNT.value },
            },
            award: { points: overflowed, alliance },
          },
        ];
      }),

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
      //
      // The manual's criterion is a *final position*, not a crossing:
      //
      //   "To qualify for LEAVE points, a ROBOT must move such that it is no
      //    longer over any LAUNCH LINE at the end of AUTO." (p.87)
      //
      // Two consequences the earlier `RobotExitedZone` version got wrong. A
      // robot that leaves and drives back scored anyway, because the exit had
      // already fired; and "any LAUNCH LINE" means every line on the field, not
      // the robot's own — the DEPOT tape is a LAUNCH LINE too (§9.3), and the
      // LAUNCH ZONES belong to the FIELD rather than to an alliance.
      //
      // So it triggers on the end-of-AUTO assessment and asks where the robot
      // is *not*, which is what `RobotAssessed` exists for.
      {
        id: `${alliance}-leave`,
        contributesTo: [DECODE_RP_CRITERIA.movement],
        label: `${alliance} LEAVE`,
        phase: 'AUTO' as const,
        trigger: {
          event: 'RobotAssessed' as const,
          filters: [{ field: 'alliance', equals: alliance }],
        },
        condition: {
          predicateId: 'robotNotInZone',
          params: { zoneIds: ALL_LAUNCH_LINE_ZONE_IDS },
        },
        award: { points: DECODE_POINTS.leaveAuto, alliance },
        // One award per robot per match; two robots per alliance.
        maxAwards: 2,
      },

      // --- BASE, assessed at the end of TELEOP (§10.5, F; §10.5.3) ---------
      //
      // The manual defines both tiers by *support*, not by overlap:
      //
      //   "A ROBOT fully returned to BASE must only be supported, either
      //    directly or transitively, by the TILE in the BASE ZONE."
      //   "A ROBOT partially returned to BASE must be partially supported ...
      //    by the TILE in the BASE ZONE." (p.87)
      //
      // and settles the boundary: "If all of the support of the ROBOT in the
      // BASE ZONE is from the TILE in the BASE ZONE, the ROBOT is fully
      // returned"; if some support comes from tiles outside it, the ROBOT is
      // partially returned. That is exactly the support fraction the detector
      // measures, so `robotFullyInZone` / `robotPartiallyInZone` are the right
      // questions — what changes is *when* they are asked.
      //
      // Triggering on `RobotOverlapsZone` assessed the moment a robot crossed
      // the boundary, so a robot that touched BASE mid-match and drove away
      // still scored. `RobotAssessed` fires at the end of the period, which is
      // when the manual assesses it.
      //
      // The two tiers are mutually exclusive by construction: full support
      // makes `robotPartiallyInZone` false, so a robot cannot collect both.
      {
        id: `${alliance}-base-full`,
        contributesTo: [DECODE_RP_CRITERIA.movement],
        label: `${alliance} fully returned to BASE`,
        phase: 'TELEOP' as const,
        trigger: {
          event: 'RobotAssessed' as const,
          filters: [{ field: 'alliance', equals: alliance }],
        },
        condition: { predicateId: 'robotFullyInZone', params: { zoneId: base } },
        award: { points: DECODE_POINTS.baseFull, alliance },
        maxAwards: 2,
      },
      {
        id: `${alliance}-base-partial`,
        contributesTo: [DECODE_RP_CRITERIA.movement],
        label: `${alliance} partially returned to BASE`,
        phase: 'TELEOP' as const,
        trigger: {
          event: 'RobotAssessed' as const,
          filters: [{ field: 'alliance', equals: alliance }],
        },
        condition: { predicateId: 'robotPartiallyInZone', params: { zoneId: base } },
        award: { points: DECODE_POINTS.basePartial, alliance },
        maxAwards: 2,
      },
      {
        id: `${alliance}-base-bonus`,
        contributesTo: [DECODE_RP_CRITERIA.movement],
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

// ------------------------------------------------------------- foul rules ---

/**
 * The one violation this simulator can assess: G408's CONTROL limit.
 *
 * Almost every DECODE foul turns on referee perception — the manual says so
 * outright, "All rules throughout the Game Rules section are called as perceived
 * by a REFEREE" (p.89) — and on judgements like PERSISTENT and REPEATED that no
 * geometry decides. `DECODE_FOULS_ASSESSED_BY_REFEREE` records that, and it
 * remains true of the rest.
 *
 * G408 is different because it is a count:
 *
 *   "A ROBOT may not simultaneously CONTROL more than 3 ARTIFACTS.
 *    Violation: MINOR FOUL per SCORING ELEMENT over the limit." (p.105)
 *
 * With possession decided from simulation state, the count is available. What is
 * not available is intent, and the same rule excludes "bulldozing" — inadvertent
 * contact with a piece in the robot's path — which is geometrically identical to
 * herding. So these rules trigger on **sustained** possession rather than on
 * acquisition: the manual measures excessive violations as "greater-than-
 * MOMENTARY CONTROL of 4 or more ARTIFACTS", and MOMENTARY is "fewer than
 * approximately 3 seconds" (§16). A robot driving through a cluster does not
 * hold it for three seconds; a robot hoarding does.
 *
 * That is a proxy, not the rule as written, and ASSUMPTIONS.md §10.14 says so.
 *
 * ── Why the count of rules is what it is ───────────────────────────────────
 *
 * One rule per count over the limit, because the award is per excess piece and
 * a filter compares equality. The upper bound is geometric rather than chosen:
 * a legal robot starts inside an 18 in cube (R101, via `DECODE_ROBOT_
 * CONSTRAINTS`), and artifacts are 4.9 in across, so at most `4 x 18 / 4.9`
 * of them can touch its perimeter at once. A robot that has expanded
 * horizontally could touch more and would be under-fined; that bound needs
 * R105.A, which this fixture does not model.
 */
const MAX_SIMULTANEOUS_CONTACTS = Math.floor(
  (4 * DECODE_ROBOT_CONSTRAINTS.startingCubeIn.value) / ARTIFACT.specifiedDiameterIn.value,
);

export const DECODE_FOUL_RULES: readonly ScoringRule[] = (['red', 'blue'] as const).flatMap(
  (alliance) =>
    Array.from(
      { length: Math.max(0, MAX_SIMULTANEOUS_CONTACTS - CONTROL_LIMIT.value) },
      (_unused, index): ScoringRule => {
        const count = CONTROL_LIMIT.value + 1 + index;

        return {
          id: `${alliance}-control-limit-${count}`,
          label: `${alliance} CONTROL limit exceeded (${count} ARTIFACTS)`,
          phase: 'ANY',
          trigger: {
            event: 'PossessionSustained',
            filters: [
              { field: 'alliance', equals: alliance },
              { field: 'possessedCount', equals: count },
            ],
          },
          // A foul credits the opponent rather than deducting from the
          // violator, so the penalised alliance's own total is unchanged.
          award: { points: DECODE_PENALTIES.minorToOpponent, alliance: 'opponent' },
        };
      },
    ),
);

/**
 * Everything the rules engine runs: scoring and the one assessable foul.
 *
 * Kept as two lists and joined here because the manual keeps them apart — Table
 * 10-2 is what an alliance earns, Table 10-4 is what it concedes — and because a
 * caller studying scoring in isolation should be able to take
 * `DECODE_SCORING_RULES` without the penalty machinery.
 */
export const DECODE_RULE_SET: readonly ScoringRule[] = [
  ...DECODE_SCORING_RULES,
  ...DECODE_FOUL_RULES,
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
  'The manual states the two counts; 36 is their sum.',
);
