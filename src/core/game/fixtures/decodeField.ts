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

import { assumed, inferred, type Sourced } from '../sourced.js';
import {
  createPolyZone,
  createRectRegion,
  createRectZone,
  type FieldRegion,
  type FieldZone,
} from '../regions.js';
import { DECODE_REGIONS, DECODE_ZONES, RAMP_SLOT_COUNT } from './decode.js';
import { vec2, type Vec2 } from '../../math/vec2.js';
import { CLASSIFIER, FIELD, GOAL, LAUNCH_ZONES, ZONES } from './decodeDimensions.js';

/**
 * Provenance marker for the *positions* in this file.
 *
 * Sizes are cited individually in `decodeDimensions.ts`; this covers the one
 * thing that is not sourced, so a reviewer can see at a glance what remains
 * invented and a future change cannot quietly promote it.
 */
export const DECODE_LAYOUT_PROVENANCE: Sourced<string> = assumed(
  'goal-cluster-positions-invented',
  'Element SIZES are transcribed from the Competition Manual (see decodeDimensions.ts), ' +
    'and the LAUNCH ZONES and alliance halves are now built from §9.3 and G402 rather ' +
    'than guessed. What remains invented is where the GOAL cluster sits: the RAMP, ' +
    'OVERFLOW, DEPOT, BASE, LOADING ZONE, SECRET TUNNEL and GATE. §9.4 defines TILE ' +
    'coordinates only in figures, and §9.1 names the 3D CAD model as the official ' +
    'representation. Distances among those elements are therefore wrong, so cycle times ' +
    'and reachability are not predictive.',
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
 * Placeholder positions with sourced extents.
 *
 * Read each entry as: the size is from the manual, the centre is a guess.
 */
const LAYOUT = {
  /**
   * The RAMP holds up to 9 CLASSIFIED artifacts (§9.8.2). Modelled long in Y so
   * its nine indices read along its length; the real ramp's footprint is in the
   * CAD.
   */
  ramp: {
    centerXIn: 52,
    centerYIn: 0,
    widthIn: GOAL.footprintIn.value,
    lengthIn: 54,
  },
  /**
   * OVERFLOW has no geometry of its own in the manual — it is a *state*, not a
   * place: an artifact overflows when it passes the SQUARE without transitioning
   * directly to the RAMP (§10.5.1). Modelled as a region only because the
   * current detector decides scoring by position. See the note below.
   */
  overflow: {
    centerXIn: 52,
    centerYIn: 40,
    widthIn: GOAL.footprintIn.value,
    lengthIn: 20,
  },
  /**
   * The DEPOT is 30 in of tape spanning the GOAL's front face (§9.3). Given a
   * shallow depth so "over the DEPOT" (§10.5.1) is an area an artifact can rest
   * on rather than a line.
   */
  depot: {
    centerXIn: 40,
    centerYIn: -40,
    widthIn: 12,
    lengthIn: ZONES.depotLengthIn.value,
  },
  /** 18 in square, the one DECODE zone with a tolerance tighter than ±1 in. */
  base: {
    centerXIn: 60,
    centerYIn: -60,
    widthIn: ZONES.baseZoneSideIn.value,
    lengthIn: ZONES.baseZoneSideIn.value,
  },
  /** 23 in square (§9.3), adjacent to the ALLIANCE AREA. */
  loading: {
    centerXIn: 58,
    centerYIn: -20,
    widthIn: ZONES.loadingZoneSideIn.value,
    lengthIn: ZONES.loadingZoneSideIn.value,
  },
  /** 46.5 × 6.125 in (§9.3); where OVERFLOW artifacts exit over the GATE. */
  secretTunnel: {
    centerXIn: 30,
    centerYIn: 30,
    widthIn: ZONES.secretTunnelWidthIn.value,
    lengthIn: ZONES.secretTunnelLengthIn.value,
  },
  /** 2.75 × 10 in (§9.3), adjacent to each GATE. */
  gate: {
    centerXIn: 40,
    centerYIn: 26,
    widthIn: ZONES.gateZoneWidthIn.value,
    lengthIn: ZONES.gateZoneLengthIn.value,
  },
} as const satisfies Record<string, Placement>;

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
export const DECODE_LAUNCH_ZONE_SHAPE: Sourced<string> = inferred(
  'isosceles, base on the perimeter, apex toward the field centre',
  '§9.3 states the count, the triangular shape, the side and the TILE extent of both ' +
    'LAUNCH ZONES, but gives vertices only in Figure 9-2. Isosceles-with-apex-inward is ' +
    'read from "bounded by LAUNCH LINES and the FIELD perimeter" plus the 2:1 ' +
    'base-to-depth ratio both zones share; the audience zone is centred because the ' +
    'LAUNCH ZONES belong to the FIELD rather than to an alliance.',
  62,
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

export const DECODE_FIELD_REGIONS: readonly FieldRegion[] = [
  region(DECODE_REGIONS.redRamp, mirrored(LAYOUT.ramp, 'red'), RAMP_SLOT_COUNT.value),
  region(DECODE_REGIONS.blueRamp, mirrored(LAYOUT.ramp, 'blue'), RAMP_SLOT_COUNT.value),
  region(DECODE_REGIONS.redOverflow, mirrored(LAYOUT.overflow, 'red')),
  region(DECODE_REGIONS.blueOverflow, mirrored(LAYOUT.overflow, 'blue')),
  region(DECODE_REGIONS.redDepot, mirrored(LAYOUT.depot, 'red')),
  region(DECODE_REGIONS.blueDepot, mirrored(LAYOUT.depot, 'blue')),
];

export const DECODE_FIELD_ZONES: readonly FieldZone[] = [
  zone(DECODE_ZONES.redBase, mirrored(LAYOUT.base, 'red')),
  zone(DECODE_ZONES.blueBase, mirrored(LAYOUT.base, 'blue')),
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

/** The LAUNCH ZONE outlines, in inches, for tests and for the renderer. */
export const DECODE_LAUNCH_ZONE_OUTLINES = {
  audience: AUDIENCE_LAUNCH_ZONE,
  goalSide: GOAL_LAUNCH_ZONE,
} as const;
