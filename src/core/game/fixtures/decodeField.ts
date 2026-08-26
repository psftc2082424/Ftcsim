/**
 * DECODE field layout.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  SIZES are sourced. POSITIONS are not.
 *
 *  Every extent below comes from `decodeDimensions.ts`, transcribed from the
 *  Competition Manual with page citations. The BASE ZONE really is 18 in
 *  square; the DEPOT really is 30 in long; the LAUNCH ZONES really are 2×1 and
 *  6×3 TILES.
 *
 *  Where each element *sits* on the field is still invented. §9.4 defines TILE
 *  coordinates in Figures 9-4 and 9-5, but those are images — the manual
 *  publishes no coordinate table, and §9.1 names the 3D CAD model as the
 *  official representation. So the layout below places correctly-sized elements
 *  at guessed locations.
 *
 *  Consequence: distances between elements are wrong, so cycle times and "did
 *  it reach the goal" outcomes are not predictive. Sizes, and therefore every
 *  "is it inside" judgement once positioned, are right.
 *
 *  To finish: read positions off the field CAD or the Event FIELD Setup Guide
 *  and replace `LAYOUT` below. Region ids are the contract with `decode.ts` and
 *  must not change.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { assumed, type Sourced } from '../sourced.js';
import { createRectRegion, createRectZone, type FieldRegion, type FieldZone } from '../regions.js';
import { DECODE_REGIONS, DECODE_ZONES, RAMP_SLOT_COUNT } from './decode.js';
import { CLASSIFIER, FIELD, GOAL, ZONES } from './decodeDimensions.js';

/**
 * Provenance marker for the *positions* in this file.
 *
 * Sizes are cited individually in `decodeDimensions.ts`; this covers the one
 * thing that is not sourced, so a reviewer can see at a glance what remains
 * invented and a future change cannot quietly promote it.
 */
export const DECODE_LAYOUT_PROVENANCE: Sourced<string> = assumed(
  'positions-invented',
  'Element SIZES are transcribed from the Competition Manual (see decodeDimensions.ts). ' +
    'Element POSITIONS are invented: §9.4 defines TILE coordinates only in figures, and ' +
    '§9.1 names the 3D CAD model as the official representation. Distances between ' +
    'elements are therefore wrong, so cycle times and reachability are not predictive.',
);

const HALF_FIELD_IN = FIELD.sideIn.value / 2;

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
  /**
   * LAUNCH LINE, approximated as a rectangle.
   *
   * The real LAUNCH ZONES are triangular and belong to the FIELD rather than to
   * an alliance (§9.3): 2×1 TILES on the audience side, 6×3 on the GOAL side.
   * LEAVE is assessed against being "over any LAUNCH LINE" (§10.5.3), so this
   * stands in for the lines a robot starts on. Recorded as an approximation.
   */
  launchLine: {
    centerXIn: 58,
    centerYIn: 20,
    widthIn: FIELD.tileSideIn.value,
    lengthIn: FIELD.tileSideIn.value * 2,
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
  zone(DECODE_ZONES.redLaunchLine, mirrored(LAYOUT.launchLine, 'red')),
  zone(DECODE_ZONES.blueLaunchLine, mirrored(LAYOUT.launchLine, 'blue')),
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

/** Field bounds check, so a placeholder layout cannot silently sit off-field. */
export function layoutFitsField(): boolean {
  return Object.values(LAYOUT).every((placement) => {
    const halfW = placement.widthIn / 2;
    const halfL = placement.lengthIn / 2;
    return (
      Math.abs(placement.centerXIn) + halfW <= HALF_FIELD_IN &&
      Math.abs(placement.centerYIn) + halfL <= HALF_FIELD_IN
    );
  });
}
