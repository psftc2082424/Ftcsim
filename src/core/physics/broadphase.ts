/**
 * Uniform spatial hash broadphase.
 *
 * The FTC field is a fixed 3.66 m square with a handful of bodies, so a uniform
 * grid is the right structure: constant-time insertion, no rebalancing, no
 * allocation churn, and completely predictable behaviour. A tree would be
 * strictly more machinery for strictly less determinism confidence.
 *
 * **Determinism.** Candidate pairs are collected into a set keyed by ordered id
 * and then sorted by `(idA, idB)` before being returned. Nothing downstream may
 * depend on bucket iteration order — that is exactly the sort of hidden ordering
 * dependency that makes a golden hash test flap (ARCHITECTURE.md §9.1).
 */

import type { Aabb } from './shapes.js';
import type { EntityId } from './body.js';

/** 0.3048 m = 12 in, one FTC floor tile. ASSUMPTIONS.md §5.2. */
export const DEFAULT_CELL_SIZE_M = 0.3048;

export type CandidatePair = readonly [EntityId, EntityId];

interface Entry {
  readonly id: EntityId;
  readonly aabb: Aabb;
}

export class SpatialHash {
  private readonly cells = new Map<string, Entry[]>();
  private readonly entries: Entry[] = [];

  constructor(private readonly cellSize: number = DEFAULT_CELL_SIZE_M) {
    if (!(cellSize > 0)) throw new Error(`Cell size must be positive, got ${cellSize}.`);
  }

  clear(): void {
    this.cells.clear();
    this.entries.length = 0;
  }

  insert(id: EntityId, aabb: Aabb): void {
    const entry: Entry = { id, aabb };
    this.entries.push(entry);

    const minCx = Math.floor(aabb.minX / this.cellSize);
    const maxCx = Math.floor(aabb.maxX / this.cellSize);
    const minCy = Math.floor(aabb.minY / this.cellSize);
    const maxCy = Math.floor(aabb.maxY / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = `${cx},${cy}`;
        const bucket = this.cells.get(key);
        if (bucket === undefined) this.cells.set(key, [entry]);
        else bucket.push(entry);
      }
    }
  }

  /**
   * Candidate pairs whose AABBs overlap, deduplicated and sorted by id.
   *
   * A pair sharing several cells would otherwise be reported once per shared
   * cell, so dedup happens here rather than being left to the caller.
   */
  queryPairs(): CandidatePair[] {
    const seen = new Set<string>();
    const pairs: Array<[EntityId, EntityId]> = [];

    for (const bucket of this.cells.values()) {
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i] as Entry;
          const b = bucket[j] as Entry;

          const lo = a.id < b.id ? a : b;
          const hi = a.id < b.id ? b : a;
          const key = `${lo.id}:${hi.id}`;
          if (seen.has(key)) continue;
          seen.add(key);

          if (aabbsOverlap(lo.aabb, hi.aabb)) pairs.push([lo.id, hi.id]);
        }
      }
    }

    pairs.sort((p, q) => (p[0] !== q[0] ? p[0] - q[0] : p[1] - q[1]));
    return pairs;
  }

  get size(): number {
    return this.entries.length;
  }

  /** Number of occupied cells. Exposed for tests and diagnostics. */
  get occupiedCells(): number {
    return this.cells.size;
  }
}

function aabbsOverlap(a: Aabb, b: Aabb): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
