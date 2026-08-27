/**
 * Field mechanisms that take pieces in, queue them, and let them out again.
 *
 * A robot mechanism acts on pieces near the robot (`mechanism/intake.ts`); this
 * is the same idea for a *field* element. A piece that arrives at one place is
 * held in an ordered queue, and pieces leave somewhere else — immediately if the
 * queue was already full, or after a robot has opened the way out.
 *
 * ── Season-agnostic ────────────────────────────────────────────────────────
 *
 * Nothing here names a GOAL, a RAMP, a GATE or a TUNNEL. A conveyor is four
 * places and two rates, declared as data on a `GameDefinition`, and the engine
 * runs whatever a season declares. DECODE's CLASSIFIER is one instance of it; so
 * is a human-player return chute or a ball elevator.
 *
 * ── A guided lane stays physical ──────────────────────────────────────────
 *
 * A basic conveyor can still use the legacy ordered holder below, but a season
 * can declare a `lane`: pieces remain active rigid bodies, receive a modest
 * downslope/funnel acceleration, collide with one another, and meet a real
 * gate collider. A full lane's extra arrivals are routed on an elevated
 * overflow surface, so capacity is a physical path rather than a second score
 * destination. No lane names any particular season or field element.
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
  /** Optional physical lane replacing the legacy parked-slot representation. */
  readonly lane?: GuidedLaneSpec | undefined;
  /**
   * Zone a robot must occupy to latch the queue's way out open.
   *
   * Omitted means the queue drains freely. A declared opener latches a release
   * until the queue has emptied, which models a gate the robot triggers rather
   * than a driver having to remain parked on its activation zone.
   */
  readonly releaseZoneId?: string | undefined;
  /** Alliance whose robots may open it. Omitted means any robot. */
  readonly releaseAlliance?: 'red' | 'blue' | undefined;
  /** Zone a released piece travels through under its own, real motion. */
  readonly exitZoneId: string;
  /**
   * Reject loose pieces that try to enter this exit from its public end.
   *
   * A season uses this for a one-way chute or tunnel: pieces this conveyor
   * released travel out normally, but an unrelated loose piece cannot roll the
   * reverse path into the mechanism. Omitted leaves an ordinary bidirectional
   * floor zone.
   */
  readonly blocksInboundExit?: boolean | undefined;
  /**
   * The push a piece leaves with, world-frame metres per second.
   *
   * A real velocity, not a travel time: the piece becomes an ordinary loose
   * body the instant it is released and gets wherever this — and then whatever
   * it collides with — actually carries it. A season derives the number from
   * its own geometry (e.g. how fast a ball rolls down a known slope over a
   * known drop) rather than picking one to make a timer come out even.
   */
  readonly exitVelocityMps: Vec2;
  /** Seconds between successive pieces leaving a draining queue. */
  readonly drainIntervalSec: number;
}

/** A generic ramp/channel that guides, but never parks, active game pieces. */
export interface GuidedLaneSpec {
  /** Unit-ish world-frame direction from the entry toward the release gate. */
  readonly travelDirection: Vec2;
  /** Down-lane acceleration, m/s². */
  readonly driveAccelerationMps2: number;
  /**
   * Cruise speed the down-lane acceleration governs toward, m/s.
   *
   * The lane models a slope, not a rocket: a real ramp's downhill pull is
   * balanced by rolling resistance once a ball reaches some roughly steady
   * speed, and a lone ball with nothing ahead of it to pack against never
   * meets a collision that would otherwise cap it. Without this, an
   * unblocked piece accelerates every tick it remains queued, with no
   * opposing force, until it hits the gate collider (or another piece) fast
   * enough to tunnel through on a single tick's discrete step. The drive
   * acceleration is applied only while the piece's own speed along
   * `travelDirection` is below this, so it behaves like a governed belt
   * rather than a bottomless drop.
   */
  readonly maxDriveSpeedMps: number;
  /** Maximum lateral centring acceleration toward the queue region centreline. */
  readonly lateralCenteringAccelerationMps2: number;
  /** Semantic field collider tag retracted while the gate is latched open. */
  readonly gateColliderTag: string;
  /** Centre height of an overflow piece riding above the packed lane. */
  readonly overflowHeightM: number;
  /** Vertical approach rate to that overflow surface, m/s. */
  readonly overflowHeightRateMps: number;
  /** Fraction of incoming horizontal speed the lane's basin retains on entry. */
  readonly entryVelocityRetention: number;
}

/** The narrow slice of the world a conveyor writes to. */
export interface ConveyorWorld {
  /** Park a piece at a fixed point, out of the contact solver. */
  holdPiece(pieceId: string, positionM: Vec2): void;
  /** Release a piece into ordinary physics, moving at a given velocity. */
  releasePieceMoving(pieceId: string, positionM: Vec2, velocityM: Vec2): void;
  /** Put an invalid inbound piece just outside a one-way exit, at rest. */
  blockPiece(pieceId: string, positionM: Vec2): void;
  /** Apply a physical lane acceleration; the piece remains active and collidable. */
  guidePiece(
    pieceId: string,
    accelerationMps2: Vec2,
    targetHeightM?: number,
    heightRateMps?: number,
  ): void;
  /** Enable/disable a semantic static-collider group, e.g. a gate arm. */
  setColliderTagActive(tag: string, active: boolean): void;
  /** Inelastic field-basin capture; keeps a piece active at its current pose. */
  dampPieceVelocity(pieceId: string, retention: number): void;
}

export interface ConveyorPlaces {
  readonly entry: FieldRegion;
  readonly queue: FieldRegion;
  readonly exit: FieldZone;
  readonly release: FieldZone | undefined;
}

interface ConveyorState {
  /** Piece ids in the queue, way-out end first. */
  readonly queue: string[];
  lastDrainTick: number;
  /** Pieces this conveyor is holding, so an arrival is not counted twice. */
  readonly taken: Set<string>;
  /** Pieces this conveyor released and may therefore travel through its exit. */
  readonly released: Set<string>;
  /** Full-lane arrivals that ride the declared elevated overflow surface. */
  readonly overflow: Set<string>;
  /** A gate activation keeps the path open until this ordered queue is empty. */
  releaseLatched: boolean;
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
        lastDrainTick: Number.NEGATIVE_INFINITY,
        taken: new Set(),
        released: new Set(),
        overflow: new Set(),
        releaseLatched: false,
      });
    }
  }

  /** Every conveyor id this game declared, for a caller enumerating them all. */
  get conveyorIds(): readonly string[] {
    return this.specs.map((spec) => spec.id);
  }

  /** Pieces queued in one conveyor, way-out end first. */
  queued(conveyorId: string): readonly string[] {
    return [...(this.states.get(conveyorId)?.queue ?? [])];
  }

  /** Pieces a full physical lane is riding on its elevated overflow surface. */
  overflowed(conveyorId: string): readonly string[] {
    return [...(this.states.get(conveyorId)?.overflow ?? [])];
  }

  /** Is this conveyor's way out currently open, including a latched release? */
  isOpen(conveyorId: string, snapshot: WorldSnapshot): boolean {
    const spec = this.specs.find((candidate) => candidate.id === conveyorId);
    const state = this.states.get(conveyorId);
    return spec !== undefined && (state?.releaseLatched === true || this.releaseHeld(spec, snapshot));
  }

  /**
   * Advance every conveyor one tick.
   *
   * Order within a conveyor matters: arrivals are taken first, so a piece that
   * lands on a full queue this tick bypasses it immediately rather than waiting
   * for the next one. Conveyors run in declaration order and pieces in
   * snapshot order, so nothing here depends on map iteration.
   */
  update(snapshot: WorldSnapshot, tick: number, world: ConveyorWorld): void {
    for (const spec of this.specs) {
      const state = this.states.get(spec.id);
      const places = this.places.get(spec.id);
      if (state === undefined || places === undefined) continue;

      this.refreshReleased(state, places, snapshot);
      this.blockInboundExit(spec, state, places, snapshot, world);
      if (this.releaseHeld(spec, snapshot)) state.releaseLatched = true;
      this.takeArrivals(spec, state, places, snapshot, world);
      if (spec.lane === undefined) {
        this.drain(spec, state, places, snapshot, tick, world);
        this.holdQueue(state, places, world);
      } else {
        this.guideLane(spec, state, places, snapshot, world);
        world.setColliderTagActive(spec.lane.gateColliderTag, !state.releaseLatched);
      }
      if (state.queue.length === 0) state.releaseLatched = false;
    }
  }

  private takeArrivals(
    spec: PieceConveyorSpec,
    state: ConveyorState,
    places: ConveyorPlaces,
    snapshot: WorldSnapshot,
    world: ConveyorWorld,
  ): void {
    for (const piece of snapshot.pieces) {
      if (state.taken.has(piece.pieceId)) continue;
      // A piece a robot is carrying is not arriving anywhere on its own.
      if (piece.heldByRobotId !== null) continue;
      if (!regionContains(places.entry, piece.pose.p, piece.heightM)) continue;

      state.taken.add(piece.pieceId);

      if (spec.lane !== undefined) world.dampPieceVelocity(piece.pieceId, spec.lane.entryVelocityRetention);

      if (state.queue.length < spec.capacity) {
        state.queue.push(piece.pieceId);
        continue;
      }

      if (spec.lane !== undefined) {
        // A full physical lane does not make an arriving ball vanish or occupy a
        // fake tenth slot. It continues over the packed column on the lane's
        // declared elevated overflow surface and becomes authorised once it
        // reaches the return zone.
        state.overflow.add(piece.pieceId);
        continue;
      }

      // The queue was full when this one arrived, so it rides straight over —
      // a real push out through the exit, the same as a piece that drained
      // from the front of the queue.
      this.release(spec, state, places, piece.pieceId, world);
    }
  }

  /** Forget authorization once a released piece has completed the exit path. */
  private refreshReleased(
    state: ConveyorState,
    places: ConveyorPlaces,
    snapshot: WorldSnapshot,
  ): void {
    for (const pieceId of state.released) {
      const piece = snapshot.pieces.find((candidate) => candidate.pieceId === pieceId);
      if (piece === undefined || !regionContains(places.exit, piece.pose.p, piece.heightM)) {
        state.released.delete(pieceId);
      }
    }

    // Guided-lane pieces remain physically active while they travel. Once one
    // reaches the declared exit zone it no longer consumes classifier capacity,
    // but remains authorised to continue through the one-way return.
    for (let index = state.queue.length - 1; index >= 0; index--) {
      const pieceId = state.queue[index] as string;
      const piece = snapshot.pieces.find((candidate) => candidate.pieceId === pieceId);
      if (piece === undefined || !regionContains(places.exit, piece.pose.p, piece.heightM)) continue;
      state.queue.splice(index, 1);
      state.taken.delete(pieceId);
      state.released.add(pieceId);
    }
    for (const pieceId of state.overflow) {
      const piece = snapshot.pieces.find((candidate) => candidate.pieceId === pieceId);
      if (piece === undefined || !regionContains(places.exit, piece.pose.p, piece.heightM)) continue;
      state.overflow.delete(pieceId);
      state.taken.delete(pieceId);
      state.released.add(pieceId);
    }
  }

  /**
   * Enforce a data-declared one-way exit without creating a season-specific
   * collision hack. The ordinary release path is authorised by piece id; an
   * unrelated loose piece crossing the public mouth against the exit velocity
   * is returned just outside it. This is a gameplay constraint, not a force
   * model, and is the same for any season's chute, return lane, or tunnel.
   */
  private blockInboundExit(
    spec: PieceConveyorSpec,
    state: ConveyorState,
    places: ConveyorPlaces,
    snapshot: WorldSnapshot,
    world: ConveyorWorld,
  ): void {
    if (spec.blocksInboundExit !== true) return;
    const speed = Math.hypot(spec.exitVelocityMps.x, spec.exitVelocityMps.y);
    if (speed < 1e-9) return;

    const direction = vec2(spec.exitVelocityMps.x / speed, spec.exitVelocityMps.y / speed);
    const publicMouth = farEndOf(places.exit, places.queue.centerM);
    for (const piece of snapshot.pieces) {
      if (piece.heldByRobotId !== null || state.released.has(piece.pieceId)) continue;
      if (!regionContains(places.exit, piece.pose.p, piece.heightM)) continue;
      const alongExit = piece.vel.v.x * direction.x + piece.vel.v.y * direction.y;
      // Only stop motion into the tunnel. A loose piece already rolling out
      // with the allowed direction remains an ordinary physical piece.
      if (alongExit >= 0) continue;
      world.blockPiece(
        piece.pieceId,
        vec2(
          publicMouth.x + direction.x * piece.radiusM,
          publicMouth.y + direction.y * piece.radiusM,
        ),
      );
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
    if (!state.releaseLatched && !this.releaseHeld(spec, snapshot)) return;

    const intervalTicks = Math.round(spec.drainIntervalSec / this.dtSec);
    if (tick - state.lastDrainTick < intervalTicks) return;

    const pieceId = state.queue.shift();
    if (pieceId === undefined) return;

    state.lastDrainTick = tick;
    this.release(spec, state, places, pieceId, world);
  }

  /**
   * Release a piece into the exit zone under its own real motion.
   *
   * It starts at the exit corridor's end nearest the queue — the end an
   * ARTIFACT would physically reach first — so a robot standing at the far
   * (field) end can never reach in and grab it from the wrong side; the piece
   * has to actually travel the corridor's length under `exitVelocityMps`
   * first, the same as it would in the real game.
   */
  private release(
    spec: PieceConveyorSpec,
    state: ConveyorState,
    places: ConveyorPlaces,
    pieceId: string,
    world: ConveyorWorld,
  ): void {
    const origin = nearEndOf(places.exit, places.queue.centerM);
    world.releasePieceMoving(pieceId, origin, spec.exitVelocityMps);
    state.released.add(pieceId);
    state.taken.delete(pieceId);
  }

  /** Keep queued pieces parked at their slots, which shift as the queue drains. */
  private holdQueue(state: ConveyorState, places: ConveyorPlaces, world: ConveyorWorld): void {
    state.queue.forEach((pieceId, index) => {
      world.holdPiece(pieceId, slotPoint(places.queue, state.queue.length, index));
    });
  }

  /**
   * Give every active lane piece the same physical guide. Their separation and
   * release ordering are consequences of the ordinary collision solver and the
   * live gate collider, never positions assigned by this class.
   */
  private guideLane(
    spec: PieceConveyorSpec,
    state: ConveyorState,
    places: ConveyorPlaces,
    snapshot: WorldSnapshot,
    world: ConveyorWorld,
  ): void {
    const lane = spec.lane;
    if (lane === undefined) return;
    const length = Math.hypot(lane.travelDirection.x, lane.travelDirection.y);
    if (length < 1e-9) return;
    const direction = vec2(lane.travelDirection.x / length, lane.travelDirection.y / length);
    const lateral = vec2(-direction.y, direction.x);

    const guide = (pieceId: string, overflow: boolean): void => {
      const piece = snapshot.pieces.find((candidate) => candidate.pieceId === pieceId);
      if (piece === undefined || piece.heldByRobotId !== null) return;
      const offsetX = places.queue.centerM.x - piece.pose.p.x;
      const offsetY = places.queue.centerM.y - piece.pose.p.y;
      const lateralDistance = offsetX * lateral.x + offsetY * lateral.y;
      const lateralAcceleration = Math.max(
        -lane.lateralCenteringAccelerationMps2,
        Math.min(lane.lateralCenteringAccelerationMps2, lateralDistance * lane.lateralCenteringAccelerationMps2 * 4),
      );
      // Governed like a real slope's terminal speed: keep driving only while
      // still below cruise. A piece packed against one ahead of it, or one
      // that has already reached cruise speed with an open lane ahead, gets
      // no further push — this is what keeps an unblocked ball from
      // accelerating without limit into the gate collider.
      const alongSpeed = piece.vel.v.x * direction.x + piece.vel.v.y * direction.y;
      const driveAcceleration = alongSpeed < lane.maxDriveSpeedMps ? lane.driveAccelerationMps2 : 0;
      world.guidePiece(
        pieceId,
        vec2(
          direction.x * driveAcceleration + lateral.x * lateralAcceleration,
          direction.y * driveAcceleration + lateral.y * lateralAcceleration,
        ),
        overflow ? lane.overflowHeightM : undefined,
        overflow ? lane.overflowHeightRateMps : undefined,
      );
    };

    for (const pieceId of state.queue) guide(pieceId, false);
    for (const pieceId of state.overflow) guide(pieceId, true);
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

/**
 * The end of a shaped place's long axis nearest a reference point.
 *
 * Used to start a released piece's real travel at the physically correct end
 * of a corridor — the end next to whatever fed it — rather than at its centre
 * or spread across it the way a queue's slots are.
 */
export function nearEndOf(place: Shaped, referenceM: Vec2): Vec2 {
  const a = slotPointAtEdge(place, -1);
  const b = slotPointAtEdge(place, 1);
  const distanceTo = (p: Vec2): number => Math.hypot(p.x - referenceM.x, p.y - referenceM.y);
  return distanceTo(a) <= distanceTo(b) ? a : b;
}

/** The end of a shaped place farthest from a reference point. */
export function farEndOf(place: Shaped, referenceM: Vec2): Vec2 {
  const a = slotPointAtEdge(place, -1);
  const b = slotPointAtEdge(place, 1);
  const distanceTo = (p: Vec2): number => Math.hypot(p.x - referenceM.x, p.y - referenceM.y);
  return distanceTo(a) >= distanceTo(b) ? a : b;
}

function slotPointAtEdge(place: Shaped, sign: -1 | 1): Vec2 {
  const extent = extentOf(place);
  const half = extent.length / 2;
  return extent.alongX
    ? vec2(place.centerM.x + sign * half, place.centerM.y)
    : vec2(place.centerM.x, place.centerM.y + sign * half);
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
