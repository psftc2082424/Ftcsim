/**
 * DECODE field layout.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EVERY SIZE IS SOURCED. SOME POSITIONS ARE, AND THE REST ARE MARKED.
 *
 *  Extents come from `decodeDimensions.ts`, transcribed with page citations.
 *  Positions divide into three groups, and the difference matters because only
 *  the first two can be trusted:
 *
 *   1. **Derived from the manual.** The two LAUNCH ZONES and the alliance
 *      halves. §9.3 gives each LAUNCH ZONE's side, shape and TILE extent, and
 *      G402 splits the FIELD into three columns per alliance. Six TILES is the
 *      whole field, so those figures fix real coordinates rather than describe
 *      a size to place later.
 *
 *   2. **Inferred, and labelled.** The world frame (`DECODE_FIELD_ORIENTATION`)
 *      and the LAUNCH ZONE vertices (`DECODE_LAUNCH_ZONE_SHAPE`). Each is read
 *      off several quoted statements together; neither is written down as such.
 *
 *   3. **Still invented.** Everything in `LAYOUT`: the GOAL and its RAMP, the
 *      DEPOT, BASE, LOADING ZONE, SECRET TUNNEL and GATE. §9.4 defines TILE
 *      coordinates in Figures 9-4 and 9-5, which are images, and §9.1 names the
 *      3D CAD model as the official representation. Correctly-sized elements at
 *      guessed places.
 *
 *  Consequence of group 3: distances between those elements are wrong, so cycle
 *  times and "did it reach the goal" outcomes are not predictive. Every "is it
 *  inside" judgement is right relative to the geometry given, and becomes right
 *  absolutely once the coordinates are supplied.
 *
 *  To finish: read positions off the field CAD or the Event FIELD Setup Guide
 *  and replace `LAYOUT`. Region ids are the contract with `decode.ts` and must
 *  not change.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { assumed, explicitRule, inferred, type Sourced } from '../sourced.js';
import {
  createPolyZone,
  createRectRegion,
  createRectZone,
  type FieldRegion,
  type FieldZone,
} from '../regions.js';
import { DECODE_REGIONS, DECODE_ZONES, RAMP_SLOT_COUNT, spikeMarkId } from './decode.js';
import { vec2, type Vec2 } from '../../math/vec2.js';
import { ARTIFACT, CLASSIFIER, FIELD, GOAL, LAUNCH_ZONES, ZONES } from './decodeDimensions.js';
import {
  horizontalSeamYIn,
  rowCenterYIn,
  tileBounds,
  tileCenterIn,
  verticalSeamXIn,
  type TileColumn,
  type TileRow,
  type VerticalSeam,
  DECODE_SETUP_GUIDE_COLOUR_CONFLICT,
  DECODE_TILE_ORIENTATION,
} from './decodeTiles.js';

/**
 * Provenance marker for the *positions* in this file.
 *
 * Sizes are cited individually in `decodeDimensions.ts`; this covers the one
 * thing that is not sourced, so a reviewer can see at a glance what remains
 * invented and a future change cannot quietly promote it.
 */
export const DECODE_LAYOUT_PROVENANCE: Sourced<string> = assumed(
  'goal-cluster-positions-inferred',
  'Element SIZES are transcribed from the Competition Manual (see decodeDimensions.ts), ' +
    'and the Event FIELD Setup Guide places the BASE ZONES, SPIKE MARKS, GATE ZONES, ' +
    'LOADING ZONES, SECRET TUNNEL ZONES and both LAUNCH LINES against the TILE grid, so ' +
    'those are transcribed. What remains is the GOAL cluster — GOAL, RAMP and DEPOT — ' +
    'which the guide installs by figure. Their placement is constrained by the elements ' +
    'around them rather than guessed; see GOAL_CLUSTER_PROVENANCE. Distances to the GOAL ' +
    'are therefore approximate, so cycle times are not yet predictive.',
);

const HALF_FIELD_IN = FIELD.sideIn.value / 2;
const TILE_IN = FIELD.tileSideIn.value;

/**
 * The DECODE world frame, and why it is oriented this way.
 *
 * The world origin is the field centre, +X right and +Y up, as
 * `field/fieldTemplate.ts` defines for every season. What DECODE adds is which
 * physical direction each axis points, and the manual settles it in three
 * statements:
 *
 *   - §9.5, p.64: "The FIELD is oriented such that the red ALLIANCE AREA is
 *     located on the left from the primary audience viewing direction."
 *   - §9.6, p.64: the OBELISK sits "centered on the GOAL-side of the FIELD,
 *     just outside of the FIELD perimeter" — so the GOAL side is one edge, and
 *     §9.3 places the other LAUNCH ZONE on "the audience side".
 *   - G402, p.103: "FIELD columns A, B, C constitute the blue side of the
 *     FIELD, and columns D, E, F ... constitute the red side" — six columns
 *     across, three per alliance.
 *
 * Facing the field from the audience you look along +Y, so your left is -X.
 * Red is therefore -X and blue +X, and the audience/GOAL axis is Y with the
 * audience at -Y. That makes the alliance split the line x = 0, matching the
 * three-columns-each division G402 describes.
 *
 * This is `inferred` rather than `explicit`: each statement is quoted, but
 * turning "left from the audience" into a signed axis is a reading of them
 * together rather than something the manual writes down.
 */
export const DECODE_FIELD_ORIENTATION: Sourced<string> = inferred(
  'audience at -Y, GOAL at +Y, red at -X, blue at +X',
  'Composed from §9.5 (red ALLIANCE AREA is on the left from the primary audience ' +
    'viewing direction), §9.6 (the OBELISK is centred on the GOAL side, just outside the ' +
    'perimeter), and G402 (columns A-C are blue, D-F are red). Facing the field from the ' +
    'audience you look along +Y, so left is -X. The manual states each part; the axis ' +
    'assignment is the reading of them together.',
  64,
);

/** Red occupies -X, blue +X. The world origin is the field centre. */
const SIDE = { red: -1, blue: 1 } as const;

interface Placement {
  readonly centerXIn: number;
  readonly centerYIn: number;
  readonly widthIn: number;
  readonly lengthIn: number;
}

/**
 * Where each element sits, from the Event FIELD Setup Guide.
 *
 * The guide places almost everything against the TILE grid in text — "The red
 * BASE ZONE is on TILE B2", "SPIKE MARKS are placed on TILE pairs A4/B4, A3/B3,
 * and A2/B2, each spanning TILE seam V" — so these are transcriptions rather
 * than guesses. `decodeTiles.ts` turns a TILE reference into inches and shows
 * the two checks that validate the mapping.
 *
 * Sides follow the column, not a colour label: A-C are blue and D-F are red
 * (G402), so an element on column A or B is blue's and its mirror is red's. See
 * `DECODE_SETUP_GUIDE_COLOUR_CONFLICT` for why the column wins over the label.
 *
 * The GOAL, RAMP and DEPOT are the exception and are still `inferred` — the
 * guide installs them by figure rather than by TILE. They are constrained
 * rather than invented: see `GOAL_CLUSTER_PROVENANCE`.
 */

/** "16.75 in. (42.55 cm) away from the inside of TILE seam V or Z". */
const SECRET_TUNNEL_OFFSET_IN = explicitRule(
  16.75,
  'Setup Guide Step 7',
  'The tape lines are placed such that they are 16.75 in. (42.55 cm) away from the inside of TILE seam V or Z, respectively',
);

/**
 * Length given to the RAMP, in inches.
 *
 * Nine CLASSIFIED ARTIFACTS in a line need nine diameters, and the RAMP runs
 * from the GATE at TILE seam 3 toward the GOAL. Derived from the capacity the
 * manual states rather than measured, which is why the GOAL cluster as a whole
 * is `inferred`.
 */
const RAMP_LENGTH_IN =
  CLASSIFIER.rampCapacity.value * ARTIFACT.specifiedDiameterIn.value;

/**
 * Depth given to a SPIKE MARK, in inches.
 *
 * The mark is a tape line with no width worth modelling, but a region needs
 * area for an ARTIFACT to be "on" it. One ARTIFACT diameter is the smallest
 * value that means "an artifact placed here is on the mark" without reaching
 * further than a referee would.
 */
const SPIKE_MARK_DEPTH_IN = ARTIFACT.specifiedDiameterIn.value;

/** An 18 in BASE ZONE square, tucked into the corner of its TILE. */
function baseZoneOn(column: TileColumn, insideSeam: VerticalSeam): Placement {
  const side = ZONES.baseZoneSideIn.value;
  const seamX = verticalSeamXIn(insideSeam);
  const tile = tileBounds(column, 2);

  // "[2] tape edges are adjacent to the TILE seams": the square hugs the
  // vertical seam named for it and horizontal seam 1, the audience-side edge of
  // the TILE it stands on.
  const towardTile = Math.sign(tileCenterIn(column, 2).xIn - seamX);
  return {
    centerXIn: seamX + (towardTile * side) / 2,
    centerYIn: tile.minYIn + side / 2,
    widthIn: side,
    lengthIn: side,
  };
}

/**
 * A 10 in SPIKE MARK, centred on a TILE seam and on a row's centreline.
 *
 * "Each SPIKE MARK is placed along the centerline of a TILE and evenly spans the
 * TILE seam. SPIKE MARKS are orthogonal to the TILE grid." Given a shallow depth
 * so an ARTIFACT can rest *on* one, the way the DEPOT is treated.
 */
function spikeMarkOn(seam: VerticalSeam, row: TileRow): Placement {
  return {
    centerXIn: verticalSeamXIn(seam),
    centerYIn: rowCenterYIn(row),
    widthIn: ZONES.spikeMarkLengthIn.value,
    lengthIn: SPIKE_MARK_DEPTH_IN,
  };
}

const LAYOUT = {
  /**
   * "The blue GATE ZONE is taped on TILES A3 and A4 ... their ends start at
   * TILE seams V and Z and run toward the nearest perimeter wall and parallel
   * and adjacent to nearby TILE seam 3."
   */
  gate: {
    centerXIn: verticalSeamXIn('V') + ZONES.gateZoneLengthIn.value / 2,
    centerYIn: horizontalSeamYIn(3),
    widthIn: ZONES.gateZoneLengthIn.value,
    lengthIn: ZONES.gateZoneWidthIn.value,
  },

  /**
   * "LOADING ZONES are in TILES A1 and F1, in the corners on the audience side
   * of the FIELD", with edges adjacent to seams 1 and V. A 23 in square in the
   * corner, so it is anchored to the perimeter rather than to the seam.
   */
  loading: {
    centerXIn: HALF_FIELD_IN - ZONES.loadingZoneSideIn.value / 2,
    centerYIn: -HALF_FIELD_IN + ZONES.loadingZoneSideIn.value / 2,
    widthIn: ZONES.loadingZoneSideIn.value,
    lengthIn: ZONES.loadingZoneSideIn.value,
  },

  /**
   * "on TILES A2 and A3 spanning from TILE seam 1 to 3 ... 16.75 in. away from
   * the inside of TILE seam V". The tape is the zone's inboard edge; the zone
   * runs from there out to the perimeter.
   */
  secretTunnel: {
    centerXIn:
      verticalSeamXIn('V') + SECRET_TUNNEL_OFFSET_IN.value + ZONES.secretTunnelWidthIn.value / 2,
    centerYIn: (horizontalSeamYIn(1) + horizontalSeamYIn(3)) / 2,
    widthIn: ZONES.secretTunnelWidthIn.value,
    lengthIn: ZONES.secretTunnelLengthIn.value,
  },

  /**
   * The RAMP, running from the GATE at seam 3 toward the GOAL in the back
   * corner. Its nine indices read along its length. `inferred`, not
   * transcribed — see `GOAL_CLUSTER_PROVENANCE`.
   */
  ramp: {
    centerXIn: HALF_FIELD_IN - GOAL.footprintIn.value / 2,
    centerYIn: horizontalSeamYIn(3) + RAMP_LENGTH_IN / 2,
    widthIn: GOAL.footprintIn.value,
    lengthIn: RAMP_LENGTH_IN,
  },

  /** The GOAL, in the back corner the RAMP climbs toward. `inferred`. */
  goal: {
    centerXIn: HALF_FIELD_IN - GOAL.footprintIn.value / 2,
    centerYIn: HALF_FIELD_IN - GOAL.footprintIn.value / 2,
    widthIn: GOAL.footprintIn.value,
    lengthIn: GOAL.footprintIn.value,
  },

  /**
   * The DEPOT: 30 in of tape "which spans the entire length of the GOAL front
   * face and is located at the base of the GOAL". Placed against the GOAL's
   * field-facing edge, with an ARTIFACT's depth so a piece can rest over it.
   */
  /**
   * The DEPOT: tape "which spans the entire length of the GOAL front face and
   * is located at the base of the GOAL" (§9.3).
   *
   * Laid along the GOAL's field-facing side rather than its RAMP side — the
   * RAMP is the structure artifacts climb, and tape at its foot would be under
   * it rather than in front of the GOAL. Given an ARTIFACT's depth so a piece
   * can rest *over* the line, which is what §10.5.1 asks.
   *
   * The tape is "approximately 30 in." across a 27 in face and the setup guide
   * has its ends "cut ... to end cleanly at the side plastic panels", so what a
   * piece can rest over is the face.
   */
  depot: {
    centerXIn:
      HALF_FIELD_IN - GOAL.footprintIn.value - ARTIFACT.specifiedDiameterIn.value / 2,
    centerYIn: HALF_FIELD_IN - GOAL.footprintIn.value / 2,
    widthIn: ARTIFACT.specifiedDiameterIn.value,
    lengthIn: GOAL.footprintIn.value,
  },
} as const satisfies Record<string, Placement>;

/**
 * The GOAL, RAMP and DEPOT are constrained, not transcribed.
 *
 * The setup guide installs them by figure — "Place each GOAL Assembly onto the
 * FIELD, making sure the GOAL Border Brackets slip over the FIELD perimeter" —
 * and gives no TILE reference. What it does give are the things around them,
 * and those box the cluster in:
 *
 *   - The GATE ZONE is on TILES A3/A4 at seam 3, running to the perimeter, so
 *     the GATE — the low end of the CLASSIFIER — is at the side wall on the
 *     centre line.
 *   - The SECRET TUNNEL runs along that same wall from seam 1 to seam 3 and is
 *     "bounded by ... the GOAL assembly" at its far end, so the GOAL is beyond
 *     seam 3, on the GOAL side.
 *   - The GOAL brackets slip over the perimeter, so it stands against a wall.
 *
 * That puts the GOAL in the back corner with the RAMP climbing to it from the
 * GATE, which is what is built here. The remaining freedom is how far along
 * that wall, and the full-field CAD would settle it.
 */
export const GOAL_CLUSTER_PROVENANCE: Sourced<string> = inferred(
  'goal in the back corner, ramp climbing from the gate at seam 3',
  'The Event FIELD Setup Guide places the GATE ZONE, SECRET TUNNEL and LOADING ZONE by ' +
    'TILE but installs the GOAL and RAMP by figure. Their position is boxed in by those ' +
    'three: the GATE sits at the side wall on seam 3, the tunnel runs from seam 1 to ' +
    'seam 3 bounded by the GOAL assembly, and the GOAL brackets slip over the perimeter. ' +
    'How far along the back wall the GOAL sits is the remaining freedom, and the ' +
    'full-field CAD (am-5700) would settle it.',
);

// ------------------------------------------------------------ LAUNCH ZONES ---

/**
 * The two LAUNCH ZONES, which the manual does place well enough to build.
 *
 * §9.3, p.62 — quoted in `decodeDimensions.ts` — says there are exactly two,
 * that they are triangular, that they are bounded by LAUNCH LINES and the FIELD
 * perimeter, and how large each is in TILES:
 *
 *   "There are 2 LAUNCH ZONES: the LAUNCH ZONE on the audience side of the
 *    FIELD spans a section 2 TILES wide and 1 TILE deep and the LAUNCH ZONE on
 *    the GOAL side of the FIELD spans a section 6 TILES wide by 3 TILES deep."
 *
 * That is a great deal more than the rest of this file gets. The count, the
 * ownership (they belong to the FIELD, not to an alliance), the shape, the side
 * each sits on and both extents are all stated outright. Six tiles is the whole
 * field width, so the GOAL-side zone's base *is* the GOAL-side wall.
 *
 * ── What is still a reading ────────────────────────────────────────────────
 *
 * The manual gives the bounding section, not the three vertices. Two things are
 * therefore inferred, and marked as such:
 *
 *   - Each triangle is isosceles with its base on the perimeter and its apex
 *     pointing into the field. "Bounded by LAUNCH LINES and the FIELD
 *     perimeter" makes the perimeter one side, and both zones share the same
 *     2:1 base-to-depth ratio (144×72 and 48×24), which a pair of independently
 *     shaped triangles would not.
 *   - The audience-side zone is centred on its wall. It belongs to the FIELD
 *     rather than to an alliance, so an off-centre placement would favour one.
 *
 * Figure 9-2 shows the true outline, but a figure is an image and this file
 * transcribes text.
 */
export const DECODE_LAUNCH_ZONE_SHAPE: Sourced<string> = explicitRule(
  'isosceles, base on the perimeter, apex toward the field centre',
  'Setup Guide Steps 1-2',
  'The back LAUNCH LINE is in the shape of a "V" which runs from the back corners of the FIELD to the center point of the FIELD on TILES A6, B5, C4, D4, E5, and F6.',
);

/** Triangle with `baseWidthIn` on the wall at `wallY`, apex `depthIn` inward. */
function launchTriangle(wallY: number, baseWidthIn: number, depthIn: number): readonly Vec2[] {
  const halfBase = baseWidthIn / 2;
  const inward = wallY > 0 ? -1 : 1;
  const apex = vec2(0, wallY + inward * depthIn);

  // Counter-clockwise, as `createPoly` requires.
  return inward > 0
    ? [vec2(-halfBase, wallY), vec2(halfBase, wallY), apex]
    : [vec2(-halfBase, wallY), apex, vec2(halfBase, wallY)];
}

const AUDIENCE_LAUNCH_ZONE = launchTriangle(
  -HALF_FIELD_IN,
  LAUNCH_ZONES.audienceWidthTiles.value * TILE_IN,
  LAUNCH_ZONES.audienceDepthTiles.value * TILE_IN,
);

const GOAL_LAUNCH_ZONE = launchTriangle(
  HALF_FIELD_IN,
  LAUNCH_ZONES.goalSideWidthTiles.value * TILE_IN,
  LAUNCH_ZONES.goalSideDepthTiles.value * TILE_IN,
);

// ----------------------------------------------------------- alliance sides ---

/**
 * Each alliance's half of the field, which G402 defines outright.
 *
 * "During AUTO, FIELD columns A, B, C constitute the blue side of the FIELD,
 *  and columns D, E, F (Figure 9-5) constitute the red side of the FIELD."
 *  (G402, p.103)
 *
 * Six columns across a 144 in field is three TILES each, so the boundary is the
 * centre line. The column *letters* map to sides via the orientation reading
 * above; the three-and-three split itself is stated.
 *
 * Present as zones because G402 and G304.C both ask whether a robot is
 * *completely* within a side, and support fraction is exactly that question.
 */
const ALLIANCE_SIDE_WIDTH_IN = HALF_FIELD_IN;

function allianceSide(alliance: 'red' | 'blue'): Placement {
  return {
    centerXIn: (SIDE[alliance] * ALLIANCE_SIDE_WIDTH_IN) / 2,
    centerYIn: 0,
    widthIn: ALLIANCE_SIDE_WIDTH_IN,
    lengthIn: FIELD.sideIn.value,
  };
}

function mirrored(placement: Placement, alliance: 'red' | 'blue'): Placement {
  return { ...placement, centerXIn: placement.centerXIn * SIDE[alliance] };
}

function region(id: string, placement: Placement, slotCount?: number): FieldRegion {
  return createRectRegion({
    id,
    ...placement,
    ...(slotCount === undefined ? {} : { slotCount }),
  });
}

function zone(id: string, placement: Placement): FieldZone {
  return createRectZone({ id, ...placement });
}

/**
 * SPIKE MARK rows, audience side inward.
 *
 * §10.3.1 reads the staging "starting from the middle of the FIELD and
 * continuing toward the FIELD perimeter", and names the three marks Near
 * (audience side), Middle and Far (GOAL side) — which are rows 2, 3 and 4.
 */
const SPIKE_MARK_ROWS: readonly TileRow[] = [2, 3, 4];

/** Seam each alliance's SPIKE MARKS straddle: V on the blue side, Z on red's. */
const SPIKE_MARK_SEAM: Readonly<Record<'red' | 'blue', VerticalSeam>> = {
  blue: 'V',
  red: 'Z',
};

export const DECODE_FIELD_REGIONS: readonly FieldRegion[] = [
  region(DECODE_REGIONS.redRamp, mirrored(LAYOUT.ramp, 'red'), RAMP_SLOT_COUNT.value),
  region(DECODE_REGIONS.blueRamp, mirrored(LAYOUT.ramp, 'blue'), RAMP_SLOT_COUNT.value),
  region(DECODE_REGIONS.redDepot, mirrored(LAYOUT.depot, 'red')),
  region(DECODE_REGIONS.blueDepot, mirrored(LAYOUT.depot, 'blue')),

  // Six SPIKE MARKS, three per alliance. They hold no score of their own; they
  // exist so the staging §10.3.1 describes has somewhere to put its artifacts.
  ...(['red', 'blue'] as const).flatMap((alliance) =>
    SPIKE_MARK_ROWS.map((row, index) =>
      region(
        spikeMarkId(alliance, index),
        spikeMarkOn(SPIKE_MARK_SEAM[alliance], row),
      ),
    ),
  ),
];

export const DECODE_FIELD_ZONES: readonly FieldZone[] = [
  // Tile B2 for one alliance and E2 for the other; the column decides which.
  zone(DECODE_ZONES.blueBase, baseZoneOn('B', 'W')),
  zone(DECODE_ZONES.redBase, baseZoneOn('E', 'Y')),
  zone(DECODE_ZONES.blueLoadingZone, LAYOUT.loading),
  zone(DECODE_ZONES.redLoadingZone, mirrored(LAYOUT.loading, 'red')),
  zone(DECODE_ZONES.blueGateZone, LAYOUT.gate),
  zone(DECODE_ZONES.redGateZone, mirrored(LAYOUT.gate, 'red')),
  zone(DECODE_ZONES.blueSecretTunnel, LAYOUT.secretTunnel),
  zone(DECODE_ZONES.redSecretTunnel, mirrored(LAYOUT.secretTunnel, 'red')),
  // Two zones, not two per alliance: LAUNCH ZONES belong to the FIELD (§9.3).
  createPolyZone(DECODE_ZONES.audienceLaunchZone, AUDIENCE_LAUNCH_ZONE),
  createPolyZone(DECODE_ZONES.goalLaunchZone, GOAL_LAUNCH_ZONE),
  zone(DECODE_ZONES.redSide, allianceSide('red')),
  zone(DECODE_ZONES.blueSide, allianceSide('blue')),
];

/** Ordered regions and their slot counts, for pre-declaring slots at match start. */
export const DECODE_SLOTTED_REGIONS: Readonly<Record<string, number>> = {
  [DECODE_REGIONS.redRamp]: RAMP_SLOT_COUNT.value,
  [DECODE_REGIONS.blueRamp]: RAMP_SLOT_COUNT.value,
};

/**
 * Where an artifact sits in a RAMP's nine indices.
 *
 * ── Direction matters, and the manual settles it ───────────────────────────
 *
 * Figure 10-4 (p.86) lays the indices out as `GATE | 1 2 3 4 5 6 7 8 9 | SQUARE`.
 * Artifacts enter at the SQUARE end (§10.5.1) and are retained by the GATE, so
 * the RAMP fills from index 9 downward: the first artifact in ends at index 9,
 * the ninth at index 1.
 *
 * An earlier version filled 1-upward, which silently mismatched every PATTERN
 * against a repeating motif. Returns a 0-based index for the engine, so
 * arrival *n* maps to index `capacity - 1 - n`.
 *
 * Beyond capacity the artifact OVERFLOWS and occupies no index (§9.8.2).
 */
export function createRampSlotAssignment(): {
  assign: (pieceId: string, regionId: string) => number | undefined;
  reset: () => void;
} {
  const arrivals = new Map<string, string[]>();
  const capacity = CLASSIFIER.rampCapacity.value;

  const indexFor = (arrivalOrder: number): number | undefined =>
    arrivalOrder < capacity ? capacity - 1 - arrivalOrder : undefined;

  return {
    assign(pieceId, regionId) {
      if (DECODE_SLOTTED_REGIONS[regionId] === undefined) return undefined;

      let queue = arrivals.get(regionId);
      if (queue === undefined) {
        queue = [];
        arrivals.set(regionId, queue);
      }

      const existing = queue.indexOf(pieceId);
      if (existing >= 0) return indexFor(existing);

      queue.push(pieceId);
      return indexFor(queue.length - 1);
    },
    reset() {
      arrivals.clear();
    },
  };
}

/**
 * Field bounds check, so a placeholder layout cannot silently sit off-field.
 *
 * Covers the derived geometry as well as the guessed rectangles: the LAUNCH
 * ZONE triangles are built from FIELD extents, so an arithmetic slip there
 * would put a vertex outside the perimeter rather than merely in the wrong
 * place.
 */
export function layoutFitsField(): boolean {
  const rectanglesFit = Object.values(LAYOUT).every((placement) => {
    const halfW = placement.widthIn / 2;
    const halfL = placement.lengthIn / 2;
    return (
      Math.abs(placement.centerXIn) + halfW <= HALF_FIELD_IN &&
      Math.abs(placement.centerYIn) + halfL <= HALF_FIELD_IN
    );
  });

  const trianglesFit = [...AUDIENCE_LAUNCH_ZONE, ...GOAL_LAUNCH_ZONE].every(
    (v) => Math.abs(v.x) <= HALF_FIELD_IN && Math.abs(v.y) <= HALF_FIELD_IN,
  );

  return rectanglesFit && trianglesFit;
}

/** Everything about the layout the setup guide settles, for the ledger. */
export const DECODE_LAYOUT_SOURCES: readonly Sourced<unknown>[] = [
  DECODE_TILE_ORIENTATION,
  DECODE_SETUP_GUIDE_COLOUR_CONFLICT,
  DECODE_LAUNCH_ZONE_SHAPE,
  GOAL_CLUSTER_PROVENANCE,
  SECRET_TUNNEL_OFFSET_IN,
];

/** The LAUNCH ZONE outlines, in inches, for tests and for the renderer. */
export const DECODE_LAUNCH_ZONE_OUTLINES = {
  audience: AUDIENCE_LAUNCH_ZONE,
  goalSide: GOAL_LAUNCH_ZONE,
} as const;
