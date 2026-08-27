/**
 * DECODE assembled as a complete `GameDefinition` — the golden fixture.
 *
 * The architecture's claim is that adding an FTC season means writing a
 * GameDefinition rather than changing the engine. This is that claim made
 * concrete for 2025–26: everything DECODE-specific in one value, consumed by an
 * engine that contains none of its vocabulary.
 *
 * ── Provenance, honestly ───────────────────────────────────────────────────
 *
 * Rules, point values, timings, piece counts and robot limits are transcribed
 * from the Competition Manual with citations, and `assumptionLedger()` will list
 * anything that is not. Field element *positions* are invented placeholders
 * (`decodeField.ts`), because the manual defers them to the CAD model.
 *
 * The ledger is derived by walking this value, so it cannot drift out of date
 * the way a hand-maintained list would.
 */

import type { GameDefinition, GamePieceType } from '../gameDefinition.js';
import { assumed } from '../sourced.js';
import { ARTIFACT_MASS_LB } from './decodeDimensions.js';
import {
  DECODE_FOULS_ASSESSED_BY_REFEREE,
  DECODE_HAS_NO_WEIGHT_LIMIT,
  DECODE_CONVEYORS,
  DECODE_MATCH,
  DECODE_MOTIFS,
  DECODE_OBJECTIVES,
  DECODE_PENALTIES,
  DECODE_PIECES,
  DECODE_RANKING_POINT_RULES,
  DECODE_ROBOT_CONSTRAINTS,
  DECODE_RP_THRESHOLD_STABILITY,
  DECODE_RULE_SET,
  DECODE_SETUP,
  DECODE_STAGING_MAY_BE_MODIFIED,
} from './decode.js';
import {
  DECODE_FIELD_ORIENTATION,
  DECODE_FIELD_REGIONS,
  DECODE_FIELD_ZONES,
  DECODE_LAYOUT_PROVENANCE,
  DECODE_LAYOUT_SOURCES,
  DECODE_SLOTTED_REGIONS,
} from './decodeField.js';

/**
 * Piece types with the vendor-published mass attached, so physics has a real
 * number rather than an estimate.
 *
 * See `ARTIFACT_MASS_LB` for where 0.165 lb comes from and why it is `inferred`
 * rather than `explicit`: the Competition Manual names the part, AndyMark
 * publishes its weight.
 */
export const DECODE_PIECE_TYPES: readonly GamePieceType[] = DECODE_PIECES.map((piece) => ({
  id: piece.id,
  label: piece.label,
  diameterIn: piece.diameterIn,
  massLb: ARTIFACT_MASS_LB,
  count: piece.count,
}));

/**
 * The MOTIF is randomised per match by the OBELISK. A definition cannot know
 * which one a given match drew, so the default is one of the three and a caller
 * running a specific match overrides it.
 */
export const DECODE_DEFAULT_MOTIF = assumed(
  DECODE_MOTIFS.GPP.pattern,
  'The MOTIF is randomised per match (§10.5.2). This is a default for running a ' +
    'match without specifying the draw, not the value of any particular match.',
);

export const DECODE_GAME: GameDefinition = {
  id: 'ftc-decode-2025',
  season: '2025-26',
  name: 'FIRST Tech Challenge DECODE',

  match: DECODE_MATCH,
  pieces: DECODE_PIECE_TYPES,

  regions: DECODE_FIELD_REGIONS,
  zones: DECODE_FIELD_ZONES,
  slottedRegions: DECODE_SLOTTED_REGIONS,
  conveyors: DECODE_CONVEYORS,

  setup: DECODE_SETUP,

  rules: DECODE_RULE_SET,
  objectives: DECODE_OBJECTIVES,
  robotConstraints: DECODE_ROBOT_CONSTRAINTS,

  // Recorded, not scored. Both are outside what a match simulation decides —
  // ranking points need an event tier and a tournament, fouls need a referee —
  // but carrying them here puts them in front of the provenance walker and
  // spares a caller from hard-coding Table 10-3.
  rankingPoints: DECODE_RANKING_POINT_RULES,
  penalties: DECODE_PENALTIES,

  // What the manual says that is not a number. The layout note is the largest
  // remaining gap in this fixture, and putting it here is what makes it show up
  // in `assumptionLedger(DECODE_GAME)` alongside the estimated mass rather than
  // only in a comment someone has to find.
  provenanceNotes: [
    DECODE_LAYOUT_PROVENANCE,
    DECODE_FIELD_ORIENTATION,
    ...DECODE_LAYOUT_SOURCES,
    DECODE_DEFAULT_MOTIF,
    DECODE_HAS_NO_WEIGHT_LIMIT,
    DECODE_RP_THRESHOLD_STABILITY,
    DECODE_FOULS_ASSESSED_BY_REFEREE,
    DECODE_STAGING_MAY_BE_MODIFIED,
  ],

  variables: { motif: DECODE_DEFAULT_MOTIF.value },
};
