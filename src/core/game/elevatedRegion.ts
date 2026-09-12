/**
 * Regions that hold any resting piece at a declared height above the floor.
 *
 * ── Season-agnostic ────────────────────────────────────────────────────────
 *
 * Nothing here names a FLOWER. A region this simple engine's 2D contact
 * solver cannot give real vertical support — a narrow scoring tube whose
 * criterion is "between two rings" partway up a post, say — is declared as
 * data (a region id plus a height) and this class supplies the same kind of
 * bounded per-tick height guidance the tipper (`tipper.ts`) already gives a
 * HIVE CELL, without any of its bistable/threshold/dump behaviour: pieces
 * here never leave on their own.
 *
 * ── What it does not do ────────────────────────────────────────────────────
 *
 * It does not score, does not gate entry, and does not model true 3D
 * stacking — a piece that arrives is held at one fixed height, not stacked on
 * top of whatever else the region already holds. That is a real, named
 * simplification (see `biobuzzField.ts`'s FLOWER region), not a hidden one.
 */

import { regionContains, type FieldRegion } from './regions.js';
import { vec2, type Vec2 } from '../math/vec2.js';
import type { WorldSnapshot } from '../sim/snapshot.js';

export interface ElevatedRegionSpec {
  readonly id: string;
  readonly regionId: string;
  /** Height above the floor a resting piece is held at. */
  readonly restHeightM: number;
  /** Vertical approach rate toward `restHeightM`, m/s. */
  readonly heightRateMps: number;
}

/** The narrow slice of the world an elevated region writes to. */
export interface ElevatedRegionWorld {
  guidePiece(pieceId: string, accelerationMps2: Vec2, targetHeightM?: number, heightRateMps?: number): void;
}

/** Runs every elevated region a game declares. */
export class ElevatedRegions {
  constructor(private readonly specs: readonly ElevatedRegionSpec[]) {}

  /**
   * Hold whatever is currently resting in each declared region at its height.
   *
   * A piece already above the region's own floor-level entry (still rising
   * through it, or already launched past it) is left alone below the rest
   * height's own tolerance, so this only ever pulls a piece *up* into its
   * held height rather than catching one mid-flight.
   */
  update(regions: ReadonlyMap<string, FieldRegion>, snapshot: WorldSnapshot, world: ElevatedRegionWorld): void {
    for (const spec of this.specs) {
      const region = regions.get(spec.regionId);
      if (region === undefined) continue;

      for (const piece of snapshot.pieces) {
        if (piece.heldByRobotId !== null) continue;
        if (!regionContains(region, piece.pose.p, piece.heightM)) continue;
        world.guidePiece(piece.pieceId, vec2(0, 0), spec.restHeightM, spec.heightRateMps);
      }
    }
  }
}

/** Resolve every declared spec's region against a game's regions. */
export function resolveElevatedRegions(
  specs: readonly ElevatedRegionSpec[],
  regions: readonly FieldRegion[],
): ReadonlyMap<string, FieldRegion> {
  const byId = new Map<string, FieldRegion>();
  for (const region of regions) byId.set(region.id, region);

  const resolved = new Map<string, FieldRegion>();
  for (const spec of specs) {
    const region = byId.get(spec.regionId);
    if (region === undefined) {
      throw new Error(`Elevated region "${spec.id}" needs region "${spec.regionId}".`);
    }
    resolved.set(spec.regionId, region);
  }
  return resolved;
}
