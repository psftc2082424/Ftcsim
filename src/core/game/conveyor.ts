/**
 * Field mechanisms that take pieces in, queue them, and let them out again.
 *
 * A robot mechanism acts on pieces near the robot (`mechanism/intake.ts`); this
 * is the same idea for a *field* element. A piece that arrives at one place is
 * held in an ordered queue, and pieces leave somewhere else — immediately if the
 * queue was already full, or when something opens the way out.
 *
 * ── Season-agnostic ────────────────────────────────────────────────────────
 *
 * Nothing here names a GOAL, a RAMP, a GATE or a TUNNEL. A conveyor is four
 * places and two rates, declared as data on a `GameDefinition`, and the engine
 * runs whatever a season declares. DECODE's CLASSIFIER is one instance of it; so
 * is a human-player return chute or a ball elevator.
 *
 * ── What it does not do ────────────────────────────────────────────────────
 *
 * It does not score. Pieces move, the region detector notices they moved, and
 * rules score the events that produces — the same one-way channel everything
 * else uses (ARCHITECTURE.md §3.2). A conveyor that scored directly would be the
 * UI-modifies-the-score problem wearing a different hat.
 *
 * ASSUMPTIONS.md §10.16.
 */

import {
  regionContains,
  robotOverlapsZone,
  type FieldRegion,
  type FieldZone,
  type RegionShape,
} from './regions.js';
import { createObb } from '../physics/shapes.js';
import { vec2, type Vec2 } from '../math/vec2.js';
import type { WorldSnapshot } from '../sim/snapshot.js';

export interface PieceConveyorSpec {
  readonly id: string;
  /** Region a piece must be inside to be taken in. */
  readonly entryRegionId: string;
  /** Ordered region the queue occupies. Slot 0 is the way-out end. */
  readonly queueRegionId: string;
  /** How many the queue holds before arrivals bypass it. */
  readonly capacity: number;
  /**
   * Zone a robot must occupy for the queue to drain.
   *
   * Omitted means the queue drains freely. Present means something has to hold
   * it open, and it shuts the moment nothing is.
   */
  readonly releaseZoneId?: string | undefined;
  /** Alliance whose robots may open it. Omitted means any robot. */
  readonly releaseAlliance?: 'red' | 'blue' | undefined;
  /** Zone pieces come out into. */
  readonly exitZoneId: string;
  /** Seconds an arrival that bypassed the queue takes to reach the way out. */
  readonly bypassTransitSec: number;
  /** Seconds between successive pieces leaving a draining queue. */
  readonly drainIntervalSec: number;
}

/** The narrow slice of the world a conveyor writes to. */
export interface ConveyorWorld {
  /** Park a piece at a fixed point, out of the contact solver. */
  holdPiece(pieceId: string, positionM: Vec2): void;
  /** Put a piece back into play at rest. */
  releasePiece(pieceId: string, positionM: Vec2): void;
}

export interface ConveyorPlaces {
  readonly entry: FieldRegion;
  readonly queue: FieldRegion;
  readonly exit: FieldZone;
  readonly release: FieldZone | undefined;
}

interface Transit {
  readonly pieceId: string;
  /** Tick the piece reaches the way out. */
  readonly arrivesAtTick: number;
}

interface ConveyorState {
  /** Piece ids in the queue, way-out end first. */
  readonly queue: string[];
  readonly inTransit: Transit[];
  lastDrainTick: number;
  /** Pieces this conveyor is holding, so an arrival is not counted twice. */
  readonly taken: Set<string>;
  /** How many have been put out, so returns lay along the exit rather than pile. */
  emitted: number;
}

/**
 * Runs every conveyor a game declares.
 *
 * Owned by the match simulation beside the possession tracker: both are stateful
 * readers of the snapshot. This one also writes, through the narrow
 * `ConveyorWorld` interface rather than by reaching into bodies.
 */
export class PieceConveyors {
  private readonly states = new Map<string, ConveyorState>();

  constructor(
    private readonly specs: readonly PieceConveyorSpec[],
    private readonly places: ReadonlyMap<string, ConveyorPlaces>,
    private readonly dtSec: number,
  ) {
    for (const spec of specs) {
      this.states.set(spec.id, {
        queue: [],
        inTransit: [],
        lastDrainTick: Number.NEGATIVE_INFINITY,
        taken: new Set(),
        emitted: 0,
      });
    }
  }

  /** Pieces queued in one conveyor, way-out end first. */
  queued(conveyorId: string): readonly string[] {
    return [...(this.states.get(conveyorId)?.queue ?? [])];
  }

  /** Pieces on their way to a conveyor's exit but not out yet. */
  inTransit(conveyorId: string): readonly string[] {
    return (this.states.get(conveyorId)?.inTransit ?? []).map((transit) => transit.pieceId);
  }

  /** Is this conveyor's way out being held open right now? */
  isOpen(conveyorId: string, snapshot: WorldSnapshot): boolean {
    const spec = this.specs.find((candidate) => candidate.id === conveyorId);
    return spec !== undefined && this.releaseHeld(spec, snapshot);
  }

  /**
   * Advance every conveyor one tick.
   *
   * Order within a conveyor matters: arrivals are taken first, so a piece that
   * lands on a full queue this tick bypasses it rather than waiting for the next
   * one. Conveyors run in declaration order and pieces in snapshot order, so
   * nothing here depends on map iteration.
   */
  update(snapshot: WorldSnapshot, tick: number, world: ConveyorWorld): void {
    for (const spec of this.specs) {
      const state = this.states.get(spec.id);
      const places = this.places.get(spec.id);
      if (state === undefined || places === undefined) continue;

      this.takeArrivals(spec, state, places, snapshot, tick, world);
      this.deliverTransits(state, places, snapshot, tick, world);
      this.drain(spec, state, places, snapshot, tick, world);
      this.holdQueue(state, places, world);
    }
  }

  private takeArrivals(
    spec: PieceConveyorSpec,
    state: ConveyorState,
    places: ConveyorPlaces,
    snapshot: WorldSnapshot,
    tick: number,
    world: ConveyorWorld,
  ): void {
    for (const piece of snapshot.pieces) {
      if (state.taken.has(piece.pieceId)) continue;
      // A piece a robot is carrying is not arriving anywhere on its own.
      if (piece.heldByRobotId !== null) continue;
      if (!regionContains(places.entry, piece.pose.p, piece.heightM)) continue;

      state.taken.add(piece.pieceId);

      if (state.queue.length < spec.capacity) {
        state.queue.push(piece.pieceId);
        continue;
      }

      // The queue was full when this one arrived, so it rides over and comes out
      // at the far end after however long the trip takes.
      state.inTransit.push({
        pieceId: piece.pieceId,
        arrivesAtTick: tick + Math.round(spec.bypassTransitSec / this.dtSec),
      });
      world.holdPiece(piece.pieceId, slotPoint(places.queue, spec.capacity, spec.capacity - 1));
    }
  }

  private deliverTransits(
    state: ConveyorState,
    places: ConveyorPlaces,
    snapshot: WorldSnapshot,
    tick: number,
    world: ConveyorWorld,
  ): void {
    for (let i = state.inTransit.length - 1; i >= 0; i--) {
      const transit = state.inTransit[i];
      if (transit === undefined || tick < transit.arrivesAtTick) continue;

      state.inTransit.splice(i, 1);
      this.emit(state, places, transit.pieceId, snapshot, world);
    }
  }

  private drain(
    spec: PieceConveyorSpec,
    state: ConveyorState,
    places: ConveyorPlaces,
    snapshot: WorldSnapshot,
    tick: number,
    world: ConveyorWorld,
  ): void {
    if (state.queue.length === 0) return;
    if (!this.releaseHeld(spec, snapshot)) return;

    const intervalTicks = Math.round(spec.drainIntervalSec / this.dtSec);
    if (tick - state.lastDrainTick < intervalTicks) return;

    const pieceId = state.queue.shift();
    if (pieceId === undefined) return;

    state.lastDrainTick = tick;
    this.emit(state, places, pieceId, snapshot, world);
  }

  /**
   * Put a piece out at the exit.
   *
   * Successive returns lay out along the exit rather than stacking on one point:
   * the exit holds as many as its length divided by a piece diameter, and the
   * count wraps round it. Nothing depends on where they land — a robot collects
   * them from wherever they are — so this is about them being reachable rather
   * than about a position the manual states.
   */
  private emit(
    state: ConveyorState,
    places: ConveyorPlaces,
    pieceId: string,
    snapshot: WorldSnapshot,
    world: ConveyorWorld,
  ): void {
    const diameterM = pieceDiameterM(snapshot, pieceId);
    const slots = Math.max(1, Math.floor(extentOf(places.exit).length / diameterM));

    world.releasePiece(pieceId, slotPoint(places.exit, slots, state.emitted % slots));
    state.emitted++;
    state.taken.delete(pieceId);
  }

  /** Keep queued pieces parked at their slots, which shift as the queue drains. */
  private holdQueue(state: ConveyorState, places: ConveyorPlaces, world: ConveyorWorld): void {
    state.queue.forEach((pieceId, index) => {
      world.holdPiece(pieceId, slotPoint(places.queue, state.queue.length, index));
    });
  }

  private releaseHeld(spec: PieceConveyorSpec, snapshot: WorldSnapshot): boolean {
    if (spec.releaseZoneId === undefined) return true;

    const release = this.places.get(spec.id)?.release;
    if (release === undefined) return false;

    for (const robot of snapshot.robots) {
      if (spec.releaseAlliance !== undefined && robot.alliance !== spec.releaseAlliance) continue;
      const footprint = createObb(robot.lengthM, robot.widthM);
      if (robotOverlapsZone(release, footprint, robot.pose.p, robot.pose.theta)) return true;
    }
    return false;
  }
}

interface Shaped {
  readonly centerM: Vec2;
  readonly shape: RegionShape;
}

/**
 * Where slot `index` of `count` sits inside a shaped place.
 *
 * Slots run along the longer axis of the shape's bounding box, evenly spaced,
 * with slot 0 at the low end. A queue's *direction* is therefore a property of
 * how the game laid the region out, rather than something declared twice.
 */
export function slotPoint(place: Shaped, count: number, index: number): Vec2 {
  const extent = extentOf(place);
  const slots = Math.max(1, count);
  // Centres of `slots` equal cells: the k-th sits at (k + ½)/slots along.
  const fraction = (Math.min(Math.max(index, 0), slots - 1) + 0.5) / slots - 0.5;

  return extent.alongX
    ? vec2(place.centerM.x + fraction * extent.length, place.centerM.y)
    : vec2(place.centerM.x, place.centerM.y + fraction * extent.length);
}

function pieceDiameterM(snapshot: WorldSnapshot, pieceId: string): number {
  const piece = snapshot.pieces.find((candidate) => candidate.pieceId === pieceId);
  return (piece?.radiusM ?? 0.05) * 2;
}

function extentOf(place: Shaped): { readonly alongX: boolean; readonly length: number } {
  if (place.shape.kind === 'circle') return { alongX: true, length: place.shape.radius * 2 };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const vertex of place.shape.vertices) {
    minX = Math.min(minX, vertex.x);
    maxX = Math.max(maxX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxY = Math.max(maxY, vertex.y);
  }

  const width = maxX - minX;
  const height = maxY - minY;
  return width >= height ? { alongX: true, length: width } : { alongX: false, length: height };
}

/**
 * Resolve each conveyor's places against a game's regions and zones.
 *
 * Throws on a missing id rather than silently doing nothing: a conveyor pointing
 * at a region that does not exist is a definition error, and would otherwise
 * present as pieces mysteriously never arriving.
 */
export function resolveConveyorPlaces(
  specs: readonly PieceConveyorSpec[],
  regions: readonly FieldRegion[],
  zones: readonly FieldZone[],
): ReadonlyMap<string, ConveyorPlaces> {
  const places = new Map<string, ConveyorPlaces>();

  for (const spec of specs) {
    const entry = regions.find((region) => region.id === spec.entryRegionId);
    const queue = regions.find((region) => region.id === spec.queueRegionId);
    const exit = zones.find((zone) => zone.id === spec.exitZoneId);

    if (entry === undefined) {
      throw new Error(`Conveyor "${spec.id}" needs region "${spec.entryRegionId}".`);
    }
    if (queue === undefined) {
      throw new Error(`Conveyor "${spec.id}" needs region "${spec.queueRegionId}".`);
    }
    if (exit === undefined) {
      throw new Error(`Conveyor "${spec.id}" needs zone "${spec.exitZoneId}".`);
    }

    let release: FieldZone | undefined;
    if (spec.releaseZoneId !== undefined) {
      release = zones.find((zone) => zone.id === spec.releaseZoneId);
      if (release === undefined) {
        throw new Error(`Conveyor "${spec.id}" needs zone "${spec.releaseZoneId}".`);
      }
    }

    places.set(spec.id, { entry, queue, exit, release });
  }

  return places;
}
