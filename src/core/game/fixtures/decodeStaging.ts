/**
 * Where DECODE's ARTIFACTS start a match.
 *
 * `DECODE_SETUP` has carried the *composition* since the staging was
 * transcribed — how many pieces sit at each kind of place and in what order —
 * because §10.3.1 states that and leaves the coordinates to the CAD. Nothing
 * could place them, so every test built its own piece list and a match started
 * on an empty field.
 *
 * The Event FIELD Setup Guide gives the coordinates, so this turns the one into
 * the other: composition from the manual, positions from the guide.
 *
 * ── What is on the field and what is not ───────────────────────────────────
 *
 * 24 ARTIFACTS start in play: three on each of the six SPIKE MARKS and three in
 * each LOADING ZONE. The other 12 start in the ALLIANCE AREAS, which are
 * outside the FIELD perimeter — "a 96 in. wide by 54 in. deep ... volume formed
 * by placing ALLIANCE colored tape onto the flooring surface **outside of the
 * FIELD**" (§9.3). They enter play when a human puts them there, which is not
 * something this simulator models, so they are not bodies.
 *
 * That is why `stageDecodePieces` returns 24 and `DECODE_SETUP` totals 36: the
 * difference is the human player, and `validateGameDefinition` still checks the
 * full 36 against the declared piece counts.
 */

import { inchesToMeters } from '../../units/convert.js';
import { vec2 } from '../../math/vec2.js';
import type { GamePieceSpec } from '../../sim/simWorld.js';
import { ARTIFACT, ARTIFACT_MASS_LB } from './decodeDimensions.js';
import { DECODE_FIELD_REGIONS, DECODE_FIELD_ZONES } from './decodeField.js';
import { DECODE_ZONES, spikeMarkIds } from './decode.js';

const DIAMETER_IN = ARTIFACT.specifiedDiameterIn.value;

/**
 * Colour order on each SPIKE MARK, audience side inward.
 *
 * §10.3.1: "Near (audience side): GPP, Middle: PGP, Far (GOAL side): PPG", with
 * "the MOTIFS starting from the middle of the FIELD and continuing toward the
 * FIELD perimeter" — so each triple reads inboard first.
 */
const SPIKE_MARK_ARRANGEMENTS = ['GPP', 'PGP', 'PPG'] as const;

/** "3 ARTIFACTS (2P, 1G) in each LOADING ZONE ... arranged PGP" (§10.3.1). */
const LOADING_ZONE_ARRANGEMENT = 'PGP';

function centreIn(id: string): { xIn: number; yIn: number } {
  const shaped =
    DECODE_FIELD_REGIONS.find((r) => r.id === id) ?? DECODE_FIELD_ZONES.find((z) => z.id === id);
  if (shaped === undefined) throw new Error(`DECODE staging needs region or zone "${id}".`);

  const perInch = inchesToMeters(1);
  return { xIn: shaped.centerM.x / perInch, yIn: shaped.centerM.y / perInch };
}

function artifact(pieceId: string, pieceType: string, xIn: number, yIn: number): GamePieceSpec {
  return {
    pieceId,
    pieceType,
    diameterIn: DIAMETER_IN,
    massLb: ARTIFACT_MASS_LB.value,
    startPositionM: vec2(inchesToMeters(xIn), inchesToMeters(yIn)),
  };
}

/**
 * The 24 ARTIFACTS that start on the FIELD.
 *
 * Ids are stable and readable — `spike-red-1-2`, `loading-blue-0` — because a
 * piece id turns up in every event and score delta, and a match log is easier
 * to follow when they say where the piece began.
 */
export function stageDecodePieces(): readonly GamePieceSpec[] {
  const staged: GamePieceSpec[] = [];

  for (const alliance of ['red', 'blue'] as const) {
    // The marks straddle a seam and the triples run across it, so the outward
    // direction is away from the centre line.
    const marks = spikeMarkIds(alliance);

    marks.forEach((markId, markIndex) => {
      const { xIn, yIn } = centreIn(markId);
      const outward = Math.sign(xIn);
      const arrangement = SPIKE_MARK_ARRANGEMENTS[markIndex] ?? SPIKE_MARK_ARRANGEMENTS[0];

      // "the middle ARTIFACT is placed ... directly on top of the center of the
      // SPIKE MARK ... with the outside ARTIFACTS placed in contact with the
      // middle ARTIFACT", so they sit one diameter apart, reading inboard out.
      [...(arrangement as string)].forEach((pieceType, slot) => {
        staged.push(
          artifact(
            `spike-${alliance}-${markIndex}-${slot}`,
            pieceType,
            xIn + outward * (slot - 1) * DIAMETER_IN,
            yIn,
          ),
        );
      });
    });

    const loadingId =
      alliance === 'red' ? DECODE_ZONES.redLoadingZone : DECODE_ZONES.blueLoadingZone;
    const loading = centreIn(loadingId);
    const inward = -Math.sign(loading.xIn);

    // "placed contacting the FIELD perimeter wall adjacent to each ALLIANCE
    // AREA and directly or transitively contacting the front FIELD perimeter
    // wall" — a line along the audience wall, out of the corner.
    [...LOADING_ZONE_ARRANGEMENT].forEach((pieceType, slot) => {
      staged.push(
        artifact(
          `loading-${alliance}-${slot}`,
          pieceType,
          loading.xIn + inward * slot * DIAMETER_IN,
          loading.yIn,
        ),
      );
    });
  }

  return staged;
}

/**
 * ARTIFACTS that start outside the FIELD, in the ALLIANCE AREAS.
 *
 * Counted, not placed. §10.3.1 stages "6 ARTIFACTS (4P, 2G) in each ALLIANCE
 * AREA ... with no set order", and a robot "may be pre-loaded with up to 3" of
 * them. Both are human actions outside the perimeter, so the number is here for
 * anyone reconciling the 24 on the field against the 36 in the game.
 */
export const DECODE_PIECES_OFF_FIELD = 12;
