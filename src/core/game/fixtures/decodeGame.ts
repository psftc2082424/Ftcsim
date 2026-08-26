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
import {
  DECODE_MATCH,
  DECODE_MOTIFS,
  DECODE_OBJECTIVES,
  DECODE_PIECES,
  DECODE_ROBOT_CONSTRAINTS,
  DECODE_SCORING_RULES,
} from './decode.js';
import {
  DECODE_FIELD_REGIONS,
  DECODE_FIELD_ZONES,
  DECODE_SLOTTED_REGIONS,
} from './decodeField.js';

/**
 * ARTIFACT mass.
 *
 * **Not in the manual.** DECODE specifies ARTIFACT diameter (4.9 in ± 0.25) and
 * material (Gopher ResisDent polypropylene) but gives no weight, and physics
 * needs one. 0.3 lb is an estimate for a hollow 5 in polypropylene ball of the
 * kind described; it is not measured and not cited.
 *
 * It matters: piece mass sets how far an artifact travels when a robot strikes
 * it, so every "did it reach the goal" outcome depends on this number. Replacing
 * it with a weighed value is the single highest-value correction to this
 * fixture.
 */
export const ARTIFACT_ESTIMATED_MASS_LB = assumed(
  0.3,
  'The DECODE manual gives ARTIFACT diameter and material but no mass. This is an ' +
    'estimate for a hollow 5 in polypropylene ball, not a measurement. Piece mass ' +
    'determines how far a struck artifact travels, so scoring outcomes depend on it.',
);

/** Piece types with the estimated mass attached, so physics has something to use. */
export const DECODE_PIECE_TYPES: readonly GamePieceType[] = DECODE_PIECES.map((piece) => ({
  id: piece.id,
  label: piece.label,
  diameterIn: piece.diameterIn,
  massLb: ARTIFACT_ESTIMATED_MASS_LB,
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

  rules: DECODE_SCORING_RULES,
  objectives: DECODE_OBJECTIVES,
  robotConstraints: DECODE_ROBOT_CONSTRAINTS,

  variables: { motif: DECODE_DEFAULT_MOTIF.value },
};
