/**
 * DECODE field geometry — **PLACEHOLDER LAYOUT, NOT FROM THE MANUAL**.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  Read this before trusting any coordinate in this file.
 *
 *  Every *position* here is invented. The DECODE Competition Manual does not
 *  publish field element coordinates: it names the CAD model as authoritative
 *  and states that dimensions in its illustrations are nominal (ASSUMPTIONS.md
 *  §10.5). Nothing in this file was read off a manual page, and none of it is
 *  cited, because there is nothing to cite.
 *
 *  What this layout IS for: making the scoring pipeline runnable end to end, so
 *  that rules, events and effects can be exercised against real simulated
 *  positions. The *scores* the engine computes from these regions are correct
 *  for this layout. They are not predictions of a real DECODE match.
 *
 *  What must change before this is trustworthy: replace every position below
 *  with values taken from the official field CAD or drawings. The region *ids*
 *  are the contract with `decode.ts` and must not change; only coordinates need
 *  to be corrected.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two dimensions here are genuinely sourced and are marked as such in
 * `decode.ts`: the BASE ZONE is an 18 in square (§9.3) and the RAMP has nine
 * ordered slots (§10.5.2). The layout honours both.
 */

import { assumed, type Sourced } from '../sourced.js';
import { createRectRegion, createRectZone, type FieldRegion, type FieldZone } from '../regions.js';
import { BASE_ZONE_SIDE_IN, DECODE_REGIONS, DECODE_ZONES, RAMP_SLOT_COUNT } from './decode.js';

/**
 * Every position in this module carries the same provenance: none.
 *
 * Rather than repeat the disclaimer per constant, one marker is exported and
 * asserted by test, so a reviewer can see at a glance that this file is
 * unsourced and a future change cannot quietly promote it.
 */
export const DECODE_LAYOUT_PROVENANCE: Sourced<string> = assumed(
  'placeholder',
  'Field element positions are invented. The DECODE manual defers to the field CAD ' +
    'and marks illustration dimensions as nominal, so no coordinate here is sourced. ' +
    'Replace with CAD-derived values before using these scores as predictions.',
);

/** The FTC field is 12 ft square, so coordinates run to ±72 in from centre. */
const HALF_FIELD_IN = 72;

/**
 * Alliance sides. Red occupies -X, blue +X.
 *
 * Mirroring on a sign is the reason the world origin sits at the field centre
 * (ARCHITECTURE.md `field/fieldTemplate.ts`), and it is why this layout is
 * symmetric: an asymmetry here would be an invention on top of an invention.
 */
const SIDE = { red: -1, blue: 1 } as const;

interface Placement {
  readonly centerXIn: number;
  readonly centerYIn: number;
  readonly widthIn: number;
  readonly lengthIn: number;
}

/** Placeholder placements, mirrored per alliance. */
const LAYOUT = {
  /** Ordered queue of nine slots. Long in Y so slots read along the ramp. */
  ramp: { centerXIn: 52, centerYIn: 0, widthIn: 16, lengthIn: 54 },
  /** Catches artifacts beyond the ramp's capacity. */
  overflow: { centerXIn: 52, centerYIn: 40, widthIn: 16, lengthIn: 20 },
  /** Human-player return area. */
  depot: { centerXIn: 52, centerYIn: -40, widthIn: 16, lengthIn: 20 },
  /** Where robots are assessed at the end of the match. 18 in square (§9.3). */
  base: {
    centerXIn: 60,
    centerYIn: -60,
    widthIn: BASE_ZONE_SIDE_IN.value,
    lengthIn: BASE_ZONE_SIDE_IN.value,
  },
  /**
   * The strip a robot must leave for LEAVE to score. Modelled as a zone the
   * robot starts inside, so departing it is an exit event.
   */
  launchLine: { centerXIn: 64, centerYIn: 20, widthIn: 16, lengthIn: 48 },
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
 * Where a piece sits in a ramp's queue.
 *
 * DECODE's RAMP is a sequence, and pattern scoring reads position within it. A
 * real implementation would derive the index from distance along the ramp; this
 * placeholder assigns arrival order, which is behaviourally the same for a
 * queue that fills from one end and is honest about being a stand-in.
 *
 * Arrival order is tracked by the caller, so the assignment stays a pure
 * function of what it is given.
 */
export function createRampSlotAssignment(): {
  assign: (pieceId: string, regionId: string) => number | undefined;
  reset: () => void;
} {
  const arrivals = new Map<string, string[]>();

  return {
    assign(pieceId, regionId) {
      if (DECODE_SLOTTED_REGIONS[regionId] === undefined) return undefined;

      let queue = arrivals.get(regionId);
      if (queue === undefined) {
        queue = [];
        arrivals.set(regionId, queue);
      }

      const existing = queue.indexOf(pieceId);
      if (existing >= 0) return existing;

      if (queue.length >= (DECODE_SLOTTED_REGIONS[regionId] ?? 0)) return undefined;
      queue.push(pieceId);
      return queue.length - 1;
    },
    reset() {
      arrivals.clear();
    },
  };
}

/** Field bounds check, so a placeholder layout cannot silently sit off-field. */
export function layoutFitsField(): boolean {
  const placements = Object.values(LAYOUT);
  return placements.every((placement) => {
    const halfW = placement.widthIn / 2;
    const halfL = placement.lengthIn / 2;
    return (
      Math.abs(placement.centerXIn) + halfW <= HALF_FIELD_IN &&
      Math.abs(placement.centerYIn) + halfL <= HALF_FIELD_IN
    );
  });
}
