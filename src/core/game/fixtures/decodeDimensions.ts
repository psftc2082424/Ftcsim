/**
 * DECODE dimensions, transcribed from the Competition Manual (Team Update 32).
 *
 * Every value here is read from a document with a citation and a verbatim quote.
 * Nothing is estimated. Almost all of it is the manual; the one exception is
 * ARTIFACT mass, which the manual omits and the vendor publishes for the part
 * number the manual names — see `ARTIFACT_MASS_LB`. This module deliberately
 * contains **sizes only, never positions** — see `decodeField.ts` for why that
 * split exists.
 *
 * ── The manual's own accuracy statement (§9.1, p.59) ───────────────────────
 *
 * The manual is explicit that it is not the dimensional authority:
 *
 *   "The 3D CAD model is the official representation of the DECODE FIELD and
 *    how it is constructed. Measurements may be taken from this model with a
 *    general tolerance of +/- 1 in."
 *
 *   "Illustrations included in the Competition Manual are for a general visual
 *    understanding ... and any dimensions included are nominal. Unless
 *    specifically noted, all these dimensions carry a tolerance of +/- 1 in."
 *
 * So these figures are **nominal ±1 in** unless the manual states a tighter
 * tolerance itself (the BASE ZONE does: ±0.125 in). That is recorded per value
 * rather than assumed away, and it is why `ARENA_DIMENSION_TOLERANCE_IN` exists.
 */

import { explicit, inferred, type Sourced } from '../sourced.js';

/**
 * Default tolerance on every dimension in this file, per §9.1.
 *
 * Worth keeping in view: a ±1 in tolerance is a fifth of an ARTIFACT's diameter
 * and a sixteenth of a robot's width, so a simulation built on nominal figures
 * cannot claim precision it does not have.
 */
export const ARENA_DIMENSION_TOLERANCE_IN = explicit(
  1,
  59,
  'all these dimensions carry a tolerance of +/- 1 in. (+/- 2.5 cm)',
);

// ------------------------------------------------------------------ FIELD ---

export const FIELD = {
  sideIn: explicit(
    144,
    60,
    'Each FIELD for DECODE is an approximately 144 in. by 144 in. ... area bounded by the inside surface of the walls of the FIELD perimeter',
  ),
  tileSideIn: explicit(
    24,
    60,
    '36 interlocking soft foam TILES which are each approximately 24 in. by 24 in. by 0.59 in.',
  ),
  tileThicknessIn: explicit(0.59, 60, '24 in. by 24 in. by 0.59 in.'),
  tileCount: explicit(36, 60, 'The flooring surface of the FIELD is made of 36 interlocking soft foam TILES'),
  /** Gaffers tape used for every line and zone boundary unless noted (§9.3). */
  tapeWidthIn: explicit(
    1,
    61,
    'the tape used to mark lines and zones throughout the FIELD is 1 in. (2.50 cm) wide',
  ),
} as const;

// ------------------------------------------------------ areas and markings ---

export const ZONES = {
  /** Outside the FIELD; where the DRIVE TEAM stands. */
  allianceAreaWidthIn: explicit(
    96,
    62,
    'ALLIANCE AREA: a 96 in. (243.85 cm) wide by 54 in. (137.15 cm) deep by infinitely tall volume',
  ),
  allianceAreaDepthIn: explicit(54, 62, '96 in. ... wide by 54 in. ... deep'),

  /**
   * The BASE ZONE carries its own tighter tolerance, so it is one of the few
   * DECODE dimensions that is not merely nominal.
   */
  baseZoneSideIn: explicit(
    18,
    62,
    'BASE ZONE: an 18 in. +/- 0.125 in. ... wide by 18 in. +/- 0.125 in. ... deep infinitely tall volume bounded by ALLIANCE colored tape',
  ),
  baseZoneToleranceIn: explicit(0.125, 62, '18 in. +/- 0.125 in.'),

  gateZoneWidthIn: explicit(
    2.75,
    62,
    'GATE ZONE: a 2.75 in. (7.00 cm) wide by 10 in. (25.40 cm) long infinitely tall volume',
  ),
  gateZoneLengthIn: explicit(10, 62, '2.75 in. ... wide by 10 in. ... long'),

  loadingZoneSideIn: explicit(
    23,
    62,
    'LOADING ZONE: an approximately 23 in. (58.40 cm) wide by 23 in. (58.40 cm) deep infinitely tall volume',
  ),

  secretTunnelLengthIn: explicit(
    46.5,
    63,
    'SECRET TUNNEL ZONE: an approximately 46.5 in. (118.10 cm) long by approximately 6.125 in. (15.55 cm) wide infinitely tall volume',
  ),
  secretTunnelWidthIn: explicit(6.125, 63, 'approximately 6.125 in. (15.55 cm) wide'),

  /**
   * The DEPOT is tape at the base of the GOAL, and is itself a LAUNCH LINE
   * (§9.3). It is a marked area artifacts rest *over*, not a container.
   */
  depotLengthIn: explicit(
    30,
    62,
    'DEPOT: the white tape approximately 30 in. (76.20 cm) long which spans the entire length of the GOAL front face and is located at the base of the GOAL. The DEPOT tape is a LAUNCH LINE',
  ),

  spikeMarkLengthIn: explicit(
    10,
    63,
    'SPIKE MARK: 1 of 6 white tape marks 10 in. (25.40 cm) long used to identify the placement of 3 ARTIFACTS before the MATCH',
  ),
  spikeMarkCount: explicit(6, 63, '1 of 6 white tape marks'),
} as const;

/**
 * LAUNCH ZONES are triangular and measured in TILES, not inches (§9.3).
 *
 * There are two, and they belong to the FIELD rather than to an alliance: the
 * audience-side zone spans 2 tiles by 1, the GOAL-side zone 6 tiles by 3. Both
 * are bounded by LAUNCH LINES and the FIELD perimeter.
 */
export const LAUNCH_ZONES = {
  audienceWidthTiles: explicit(
    2,
    62,
    'the LAUNCH ZONE on the audience side of the FIELD spans a section 2 TILES wide and 1 TILE deep',
  ),
  audienceDepthTiles: explicit(1, 62, '2 TILES wide and 1 TILE deep'),
  goalSideWidthTiles: explicit(
    6,
    62,
    'the LAUNCH ZONE on the GOAL side of the FIELD spans a section 6 TILES wide by 3 TILES deep',
  ),
  goalSideDepthTiles: explicit(3, 62, '6 TILES wide by 3 TILES deep'),
} as const;

// ------------------------------------------------------------------- GOAL ---

export const GOAL = {
  footprintIn: explicit(
    27,
    66,
    'The GOAL is an approximately 27 in. (68.60 cm) by 27 in. (68.60 cm) by 54 in. (137.15 cm) tall structure',
  ),
  heightIn: explicit(54, 66, '27 in. ... by 27 in. ... by 54 in. (137.15 cm) tall structure'),
  openingWidthIn: explicit(
    26.5,
    66,
    'The opening of the GOAL is approximately 26.5 in. (67.30 cm) wide and 18.3 in. (46.45 cm) deep',
  ),
  openingDepthIn: explicit(18.3, 66, '26.5 in. ... wide and 18.3 in. ... deep'),
  /**
   * The height an ARTIFACT must clear to enter the GOAL, which is what a
   * shooter has to reach. One of the few numbers here that directly constrains
   * robot design.
   */
  topLipHeightIn: explicit(
    38.75,
    66,
    'The top lip of the GOAL is 38.75 in. (98.45 cm) from the surface of the TILE',
  ),
  backboardAboveOpeningIn: explicit(
    15,
    66,
    'The maximum height of the backboard with the FIRST Tech Challenge logo is 15 in. (38.10 cm) from the open top of the GOAL',
  ),
} as const;

// ------------------------------------------------------------- CLASSIFIER ---

export const CLASSIFIER = {
  /**
   * Nine is a capacity, not a fixed set of slots: the manual says artifacts
   * OVERFLOW once the RAMP is full, and that a fast or spinning artifact can
   * skip the ninth slot even when one is open.
   */
  rampCapacity: explicit(
    9,
    69,
    'The RAMP can fit up to 9 CLASSIFIED ARTIFACTS before newly entered ARTIFACTS will OVERFLOW.',
  ),
  gateClosedMinHeightIn: explicit(
    3.75,
    72,
    'When closed, the height of the contact area of the GATE above the surface of the TILE ranges from approximately 3.75 in. (9.55 cm) to 5.5 in. (14.00 cm)',
  ),
  gateClosedMaxHeightIn: explicit(5.5, 72, 'ranges from approximately 3.75 in. ... to 5.5 in.'),
  gateOpenContactHeightIn: explicit(
    3,
    72,
    'when open the contact point is approximately 3 in. (7.60 cm) above the TILES',
  ),
  gateOpenDisplacementIn: explicit(
    2,
    72,
    'The total horizontal displacement required to move the GATE from closed to open is approximately 2 in. (5.10 cm)',
  ),
} as const;

// --------------------------------------------------------------- ARTIFACT ---

export const ARTIFACT = {
  nominalDiameterIn: explicit(
    5,
    73,
    'ARTIFACTS are 5 in. (12.70 cm) nominal Gopher ResisDentTM polypropylene balls in purple ... and green',
  ),
  specifiedDiameterIn: explicit(
    4.9,
    73,
    'ARTFACTS are specified to be 4.9 in +/- 0.25 in. (12.45 cm +/- 0.65 cm) in diameter at the mold seam',
  ),
  diameterToleranceIn: explicit(0.25, 73, '4.9 in +/- 0.25 in.'),
  purpleCount: explicit(24, 73, 'There are 24 purple (P) ARTIFACTS and 12 green (G) ARTIFACTS total in a DECODE MATCH.'),
  greenCount: explicit(12, 73, 'There are 24 purple (P) ARTIFACTS and 12 green (G) ARTIFACTS'),
} as const;

/**
 * ARTIFACT mass is **not stated anywhere in the Competition Manual**.
 *
 * §9.9 gives diameter, tolerance, colour, part numbers (am-3376a_purple /
 * am-3376a_green) and material — "Gopher ResisDent polypropylene" — but no
 * weight. Searching the manual for a mass figure returns nothing.
 *
 * Recorded as a fact about the source, so that `ARTIFACT_MASS_LB` reads as
 * filling a genuine gap rather than as a failure to look in the right place.
 */
export const ARTIFACT_MASS_NOT_IN_MANUAL = true;

/**
 * ARTIFACT mass, from the vendor's specification for the part the manual names.
 *
 * ── Why this is `inferred` and not `explicit` ──────────────────────────────
 *
 * `explicit` in this codebase means the *Competition Manual* says so, and it
 * does not. What the manual does is name the part: §9.9 cites `am-3376a_purple`
 * and `am-3376a_green`. AndyMark publishes that part's specification, and the
 * chain manual → part number → vendor spec is a deduction, so `inferred` is the
 * honest level. The quote and URL are here for anyone who wants to check it.
 *
 * ── Why it matters more than most numbers in this file ─────────────────────
 *
 * This is the only ARTIFACT property that reaches the physics. Piece mass sets
 * how far an artifact travels when a robot strikes it, and with no piece damping
 * (ASSUMPTIONS.md §5.5) a struck artifact slides until it meets something. Every
 * "did it reach the goal" outcome depends on it.
 *
 * It replaced an estimate of 0.3 lb, which was 82 % too heavy. As a sanity
 * check the published figure is the physically plausible one: 0.165 lb (75 g)
 * spread over the 0.051 m² surface of a 5 in sphere at polypropylene's
 * 905 kg/m³ implies a 1.6 mm wall, which is an ordinary moulding for a play
 * ball. The old estimate implied 3 mm.
 */
export const ARTIFACT_MASS_LB: Sourced<number> = inferred(
  0.165,
  'Not in the Competition Manual. The manual names the part (§9.9, p.73: part numbers ' +
    'am-3376a_purple and am-3376a_green) and AndyMark publishes its specification as ' +
    '"Diameter: 5 in." and "Weight: 0.165 lbs." at ' +
    'https://andymark.com/products/ftc-25-26-am-3376a (retrieved 2026-08-26). The value ' +
    'comes from the vendor, and treating it as the value the manual intends is the inference.',
  73,
);

// -------------------------------------------------------- rule vocabulary ---

/**
 * Durations the rules refer to by name, from the glossary (§16).
 *
 * These are not dimensions, but they are transcribed the same way and for the
 * same reason: several rules are written in terms of them, and a simulator that
 * guessed at "momentary" would enforce a different game.
 */
export const DURATIONS = {
  momentaryMaxSec: explicit(
    3,
    185,
    'describes durations that are fewer than approximately 3 seconds',
    'Glossary, MOMENTARY. The PDF lays terms and definitions in separate ' +
      'columns, so the label and its text are not adjacent in the extracted order.',
  ),
  continuousMinSec: explicit(
    10,
    183,
    'describes durations that are more than approximately 10 seconds',
    'Glossary, CONTINUOUS. Same column layout as MOMENTARY.',
  ),
} as const;

/** §11.4, G408: how many ARTIFACTS one ROBOT may hold at once. */
export const CONTROL_LIMIT = explicit(
  3,
  105,
  'A ROBOT may not simultaneously CONTROL more than 3 ARTIFACTS.',
  'G408.',
);

// -------------------------------------------------------------- AprilTags ---

export const APRIL_TAGS = {
  sizeIn: explicit(
    8.125,
    74,
    'AprilTags for DECODE are 8.125 in. (~20.65 cm) square targets from the 36h11 tag family',
  ),
  family: explicit('36h11', 74, 'from the 36h11 tag family'),
  redGoalId: explicit(24, 74, 'The red ALLIANCE GOAL has ID 24, and the blue ALLIANCE GOAL has tag ID 20.'),
  blueGoalId: explicit(20, 74, 'the blue ALLIANCE GOAL has tag ID 20'),
} as const;

// ---------------------------------------------------------------- OBELISK ---

export const OBELISK = {
  heightIn: explicit(
    23,
    65,
    'The OBELISK is 23 in. (58.40 cm) tall and each rectangular face is 11 in. (27.95 cm) wide',
  ),
  faceWidthIn: explicit(11, 65, 'each rectangular face is 11 in. (27.95 cm) wide'),
  /**
   * Explicitly non-deterministic. Worth recording as a sourced fact so nobody
   * later "fixes" the simulator by placing it precisely.
   */
  positionIsNotDeterministic: explicit(
    true,
    65,
    'The location of the OBELISK is not intended to be deterministic relative to the field coordinate system and should not be used for navigation.',
  ),
} as const;

/** Every sourced dimension, for the provenance walker to find in one place. */
export const DECODE_DIMENSIONS = {
  toleranceIn: ARENA_DIMENSION_TOLERANCE_IN,
  field: FIELD,
  zones: ZONES,
  launchZones: LAUNCH_ZONES,
  goal: GOAL,
  classifier: CLASSIFIER,
  artifact: ARTIFACT,
  artifactMassLb: ARTIFACT_MASS_LB,
  durations: DURATIONS,
  controlLimit: CONTROL_LIMIT,
  aprilTags: APRIL_TAGS,
  obelisk: OBELISK,
} as const;

export type DecodeDimensions = typeof DECODE_DIMENSIONS;

/** Convenience for callers that only need the number. */
export function inches(sourced: Sourced<number>): number {
  return sourced.value;
}
