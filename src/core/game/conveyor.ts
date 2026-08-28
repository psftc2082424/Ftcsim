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
  /**
   * Optional fixed centre-to-centre pitch for an ordered holder, in metres.
   *
   * This is useful when a field mechanism physically indexes identical game
   * pieces (for example, balls resting end-to-end in a chute).  It is still
   * data on the field mechanism: the generic engine never knows a ball size.
   * Omit it to retain the existing evenly-distributed generic queue behaviour.
   */
  readonly queuePitchM?: number | undefined;
  /**
   * Semantic collider retracted while the release is latched open.
   *
   * A parked/indexed conveyor can have a live physical gate just as a guided
   * lane can.  Keeping this on the generic spec prevents a season from having
   * to opt into a simulated lane solely to animate its gate correctly.
   */
  readonly gateColliderTag?: string | undefined;
  /** Optional physical lane replacing the legacy parked-slot representation. */
  readonly lane?: GuidedLaneSpec | undefined;
  /**
   * Zone a robot must occupy to latch the queue's way out open.
   *
   * Omitted means the queue drains freely. A declared opener starts a timed
   * release window, renewed by actual normal-lane flow, so a robot does not
   * have to remain parked and an idle gate does not stay open forever.
   */
  readonly releaseZoneId?: string | undefined;
  /** Alliance whose robots may open it. Omitted means any robot. */
  readonly releaseAlliance?: 'red' | 'blue' | undefined;
  /** Zone a released piece travels through under its own, real motion. */
  readonly exitZoneId: string;
  /**
   * Reject loose pieces that try to enter this exit from any public edge.
   *
   * A season uses this for a one-way chute or tunnel: pieces this conveyor
   * released travel out normally, but an unrelated loose piece cannot enter
   * from its end or a long field-facing edge. Omitted leaves an ordinary
   * bidirectional floor zone.
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
  /**
   * Maximum quiet time after a gate touch before gravity closes it.
   *
   * Each genuine normal-lane release renews this window. Overflow is above
   * the gate and deliberately does not hold the gate open.
   */
  readonly releaseOpenWindowSec?: number | undefined;
}

/** A generic ramp/channel that guides, but never parks, active game pieces. */
export interface GuidedLaneSpec {
  /**
   * Optional physical lane intake for a piece that has completed a declared
   * elevated entry.  This is a one-time placement at the *start* of the lane,
   * never a parked slot or an exit shortcut: from there the piece remains an
   * active body and rolls/collides through the entire channel.
   */
  readonly entryPointM?: Vec2 | undefined;
  /** Initial world-frame velocity at `entryPointM`, in m/s. */
  readonly entryVelocityMps?: Vec2 | undefined;
  /**
   * Whether accepted pieces first settle in a receiving basin before the lane.
   * A GOAL-plus-ramp assembly uses this; a bare chute can feed its lane directly.
   */
  readonly receivingBasin?: boolean | undefined;
  /** Physical throat where a declared receiving basin hands into this lane. */
  readonly receivingBasinTargetM?: Vec2 | undefined;
  /** Centre height of the receiving surface, when its basin is elevated. */
  readonly receivingBasinHeightM?: number | undefined;
  /** Distance from the throat at which the shared guide surface takes over. */
  readonly receivingBasinHandoffDistanceM?: number | undefined;
  /** Bounded funnel acceleration used only inside a declared receiving basin. */
  readonly receivingBasinAccelerationMps2?: number | undefined;
  /** Linear damping on a receiving basin's surface, in s⁻¹. */
  readonly receivingBasinVelocityDampingPerSec?: number | undefined;
  /** Extra clearance required before the next physical ball boards the lane. */
  readonly receivingBasinEntryClearanceM?: number | undefined;
  /**
   * Reject a loose body from the physical footprint of this elevated lane.
   *
   * The generic guard returns an unauthorised body immediately beyond the
   * closest channel edge. It is not a fixed season-specific parking point, so
   * a ball pushed against a classifier cannot accumulate at its intake.
   */
  readonly blocksInboundLane?: boolean | undefined;
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
  /** Linear damping on the lane surface, in s⁻¹. */
  readonly laneVelocityDampingPerSec?: number | undefined;
  /** Centre height of the normal lane surface, when it is raised above the field. */
  readonly surfaceHeightM?: number | undefined;
  /** Vertical approach rate to a declared normal lane surface, m/s. */
  readonly surfaceHeightRateMps?: number | undefined;
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
  /** Apply a field mechanism's outflow velocity without changing its position. */
  setPieceVelocity(pieceId: string, velocityM: Vec2): void;
  /** Put an invalid inbound piece just outside a one-way exit, at rest. */
  blockPiece(pieceId: string, positionM: Vec2): void;
  /** Apply a physical lane acceleration; the piece remains active and collidable. */
  guidePiece(
    pieceId: string,
    accelerationMps2: Vec2,
    targetHeightM?: number,
    heightRateMps?: number,
    velocityDampingPerSec?: number,
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
  /** Accepted pieces retained by the receiving basin before they board the lane. */
  readonly basin: Set<string>;
  /** A gate activation keeps the path open only while its drain window lives. */
  releaseLatched: boolean;
  /** Latest tick by which normal lane flow must continue to keep it open. */
  releaseDeadlineTick: number;
  /** True after this activation has released a normal lane piece. */
  releaseFlowed: boolean;
  /** Previous raw gate-contact state, for one activation per touch. */
  releaseHeldLastTick: boolean;
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
        basin: new Set(),
        releaseLatched: false,
        releaseDeadlineTick: Number.NEGATIVE_INFINITY,
        releaseFlowed: false,
        releaseHeldLastTick: false,
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

  /** Accepted pieces still settling in a receiving basin, before the lane. */
  inBasin(conveyorId: string): readonly string[] {
    return [...(this.states.get(conveyorId)?.basin ?? [])];
  }

  /**
   * Has this piece already completed this conveyor's declared entry?
   *
   * A retained physical body can brush the elevated entry volume again while
   * it settles in the receiving basin. That is not a second field arrival:
   * its first transition has already been observed, scored, and admitted.
   */
  hasAcceptedEntry(pieceId: string, regionId: string): boolean {
    return this.specs.some((spec) =>
      spec.entryRegionId === regionId && this.states.get(spec.id)?.taken.has(pieceId) === true,
    );
  }

  /**
   * A new declared launch starts a fresh visit to a field mechanism.
   *
   * This does not move a body or grant an entry. It merely clears stale
   * bookkeeping after an ARTIFACT has returned to the field and is later
   * collected and legitimately shot again.
   */
  rearmPiece(pieceId: string): void {
    for (const state of this.states.values()) {
      state.taken.delete(pieceId);
      state.basin.delete(pieceId);
      state.overflow.delete(pieceId);
      state.released.delete(pieceId);
      const index = state.queue.indexOf(pieceId);
      if (index >= 0) state.queue.splice(index, 1);
    }
  }

  /** Is this conveyor's way out currently open, including a latched release? */
  isOpen(conveyorId: string, snapshot: WorldSnapshot): boolean {
    const spec = this.specs.find((candidate) => candidate.id === conveyorId);
    const state = this.states.get(conveyorId);
    if (spec === undefined || state === undefined) return false;
    const hasPieces = state.queue.length > 0 || state.basin.size > 0;
    return state.releaseLatched ||
      (hasPieces && !state.releaseHeldLastTick && this.releaseHeld(spec, snapshot));
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

      this.refreshReleased(spec, state, places, snapshot, tick, world);
      this.blockInboundExit(spec, state, places, snapshot, world);
      const releaseHeldNow = this.releaseHeld(spec, snapshot);
      // A GOAL/basin entry may overlap the physical lane footprint. Admit a
      // legitimate declared entry first, then reject only pieces which still
      // have no authorization. Doing this in the reverse order projects a
      // valid shot to the public-side reject point during the one tick before
      // it is recorded as taken.
      this.takeArrivals(spec, state, places, snapshot, world);
      this.blockUnauthorisedLanePieces(spec, state, places, snapshot, world);
      // A contact is one gate activation, not a continuously-held override.
      // If it closes before a distant ball arrives, a ball physically pressing
      // against the closed arm may re-open that same held GATE. This prevents
      // an arm from trapping its leading ball, yet an idle held gate remains
      // closed after its short quiet window.
      const normalBallAtGate = this.normalLaneBallAtGate(state, places, snapshot);
      if (releaseHeldNow && (!state.releaseHeldLastTick || (!state.releaseLatched && normalBallAtGate))) {
        state.releaseLatched = true;
        state.releaseFlowed = false;
        state.releaseDeadlineTick = tick + this.releaseWindowTicks(spec);
      }
      state.releaseHeldLastTick = releaseHeldNow;
      if (spec.lane === undefined) {
        this.drain(spec, state, places, tick, world);
        this.holdQueue(spec, state, places, world);
      } else {
        this.guideLane(spec, state, places, snapshot, world);
      }
      const hasQueuedPieces = state.queue.length > 0 || state.basin.size > 0;
      // A completed drain gravity-closes immediately. A touch that never
      // produces normal lane flow closes after a short quiet window instead of
      // staying open while a robot cycles unrelated shots nearby.
      if (state.releaseLatched && (
        (state.releaseFlowed && !hasQueuedPieces) ||
        tick >= state.releaseDeadlineTick
      )) {
        state.releaseLatched = false;
        state.releaseFlowed = false;
        state.releaseDeadlineTick = Number.NEGATIVE_INFINITY;
      }
      const gateColliderTag = spec.gateColliderTag ?? spec.lane?.gateColliderTag;
      if (gateColliderTag !== undefined) world.setColliderTagActive(gateColliderTag, !state.releaseLatched);
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

      if (spec.lane !== undefined) {
        world.dampPieceVelocity(piece.pieceId, spec.lane.entryVelocityRetention);
        // A raised GOAL may not project cleanly onto its narrow 2D outlet.
        // A season may therefore hand an already-authorised arrival to the
        // *physical start* of its channel.  This is deliberately before the
        // lane, not into a queue slot or exit: ordinary integration, contacts,
        // the live gate and the return corridor still determine everything
        // afterwards.
        if (spec.lane.entryPointM !== undefined) {
          world.releasePieceMoving(
            piece.pieceId,
            spec.lane.entryPointM,
            spec.lane.entryVelocityMps ?? vec2(0, 0),
          );
        }
      }

      if (state.queue.length + state.basin.size < spec.capacity) {
        // An arriving body is captured by its physical receiving basin first.
        // The basin shell retains it; a bounded guide subsequently feeds the
        // lane without parking, teleporting, or suspending contact physics.
        if (spec.lane?.receivingBasin === true) state.basin.add(piece.pieceId);
        else state.queue.push(piece.pieceId);
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
    spec: PieceConveyorSpec,
    state: ConveyorState,
    places: ConveyorPlaces,
    snapshot: WorldSnapshot,
    tick: number,
    world: ConveyorWorld,
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
      this.noteNormalLaneFlow(spec, state, tick);
      // A physical lane reaches the real GATE under its own motion.  The gate
      // then supplies its declared outflow speed at that exact position; it
      // does not reposition the piece into the return corridor.
      world.setPieceVelocity(pieceId, spec.exitVelocityMps);
      if (state.overflow.has(pieceId)) state.overflow.delete(pieceId);
    }
    for (const pieceId of state.overflow) {
      const piece = snapshot.pieces.find((candidate) => candidate.pieceId === pieceId);
      if (piece === undefined || !regionContains(places.exit, piece.pose.p, piece.heightM)) continue;
      state.overflow.delete(pieceId);
      state.taken.delete(pieceId);
      state.released.add(pieceId);
      world.setPieceVelocity(pieceId, spec.exitVelocityMps);
    }
  }

  /**
   * Enforce a data-declared one-way exit without creating a season-specific
   * collision hack. The ordinary release path is authorised by piece id; an
   * unrelated loose piece cannot occupy the passage from any public edge.
   * This is a gameplay constraint, not a force model, and is the same for any
   * season's chute, return lane, or tunnel.
   */
  private blockInboundExit(
    spec: PieceConveyorSpec,
    state: ConveyorState,
    places: ConveyorPlaces,
    snapshot: WorldSnapshot,
    world: ConveyorWorld,
  ): void {
    if (spec.blocksInboundExit !== true) return;
    for (const piece of snapshot.pieces) {
      if (piece.heldByRobotId !== null || state.released.has(piece.pieceId)) continue;
      if (!regionContains(places.exit, piece.pose.p, piece.heightM)) continue;
      world.blockPiece(piece.pieceId, outsideNearestBoundary(places.exit, piece.pose.p, piece.radiusM));
    }
  }

  /**
   * A receiving lane can be physically open to its basin but closed to loose
   * field pieces.  This is the same boundary correction a static wall performs:
   * only a piece that never completed the declared entry is projected back to
   * the public side.  Accepted pieces are never kinematic and retain ordinary
   * ball contacts before, during, and after this check.
   */
  private blockUnauthorisedLanePieces(
    spec: PieceConveyorSpec,
    state: ConveyorState,
    places: ConveyorPlaces,
    snapshot: WorldSnapshot,
    world: ConveyorWorld,
  ): void {
    if (spec.lane?.blocksInboundLane !== true) return;
    for (const piece of snapshot.pieces) {
      // The top-down lane footprint can overlap the incoming path of a
      // legitimate high shot. Its `transferring` state ends at the normal GOAL
      // membership boundary; only after that point can it be admitted or
      // rejected as an ordinary physical ball.
      if (piece.heldByRobotId !== null || piece.transferring === true || state.taken.has(piece.pieceId)) continue;
      if (!regionContains(places.queue, piece.pose.p, piece.heightM)) continue;
      world.blockPiece(piece.pieceId, outsideNearestBoundary(places.queue, piece.pose.p, piece.radiusM));
    }
  }

  private drain(
    spec: PieceConveyorSpec,
    state: ConveyorState,
    places: ConveyorPlaces,
    tick: number,
    world: ConveyorWorld,
  ): void {
    if (state.queue.length === 0) return;
    if (!state.releaseLatched) return;

    const intervalTicks = Math.round(spec.drainIntervalSec / this.dtSec);
    if (tick - state.lastDrainTick < intervalTicks) return;

    const pieceId = state.queue.shift();
    if (pieceId === undefined) return;

    state.lastDrainTick = tick;
    this.noteNormalLaneFlow(spec, state, tick);
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

  /** Keep queued pieces parked at their declared positions, which shift as the queue drains. */
  private holdQueue(
    spec: PieceConveyorSpec,
    state: ConveyorState,
    places: ConveyorPlaces,
    world: ConveyorWorld,
  ): void {
    state.queue.forEach((pieceId, index) => {
      world.holdPiece(pieceId, queuePoint(places.queue, state.queue.length, index, spec.queuePitchM));
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

    // The receiving basin meets the queue at the end farthest from the public
    // exit.  This is a bounded environmental pull only: the pieces remain
    // ordinary rigid bodies and continue to collide with the basin shell and
    // one another while they move toward it.
    const basinTarget = lane.receivingBasinTargetM ?? farEndOf(places.queue, places.exit.centerM);
    for (const pieceId of [...state.basin]) {
      const piece = snapshot.pieces.find((candidate) => candidate.pieceId === pieceId);
      if (piece === undefined || piece.heldByRobotId !== null) continue;
      const dx = basinTarget.x - piece.pose.p.x;
      const dy = basinTarget.y - piece.pose.p.y;
      const distance = Math.hypot(dx, dy);
      // The physical GOAL backstop keeps a ball centre one radius inboard of
      // the geometric channel endpoint.  Two radii therefore means “at the
      // throat” rather than asking a real disc to overlap the wall just to
      // board the lane.
      const handoffDistance = lane.receivingBasinHandoffDistanceM ?? piece.radiusM * 2;
      const laneEntryClear = state.queue.every((queuedId) => {
        const queued = snapshot.pieces.find((candidate) => candidate.pieceId === queuedId);
        if (queued === undefined) return true;
        const separation = Math.hypot(
          queued.pose.p.x - piece.pose.p.x,
          queued.pose.p.y - piece.pose.p.y,
        );
        const required = queued.radiusM + piece.radiusM + (lane.receivingBasinEntryClearanceM ?? 0);
        return separation >= required;
      });
      // Board one physical ball only when the top of the rail is clear. This
      // is the same occupancy constraint a narrow chute imposes: it does not
      // pick a slot or move a body, it simply prevents two discs entering the
      // single-file opening on top of one another.
      if (distance <= handoffDistance && laneEntryClear) {
        state.basin.delete(pieceId);
        state.queue.push(pieceId);
        continue;
      }
      // A full single-file throat can legitimately make a basin ball wait at
      // its target until the preceding ball has rolled away. Do not normalize
      // a zero-length target vector in that state: NaN velocity would turn a
      // physical queue into a permanent invisible stall.
      if (distance <= 1e-9) {
        world.guidePiece(
          pieceId,
          vec2(0, 0),
          lane.receivingBasinHeightM,
          lane.surfaceHeightRateMps,
          lane.receivingBasinVelocityDampingPerSec,
        );
        continue;
      }
      const alongSpeed = piece.vel.v.x * (dx / distance) + piece.vel.v.y * (dy / distance);
      const basinAcceleration = lane.receivingBasinAccelerationMps2 ?? lane.driveAccelerationMps2;
      const acceleration = alongSpeed < lane.maxDriveSpeedMps ? basinAcceleration : 0;
      world.guidePiece(
        pieceId,
        vec2((dx / distance) * acceleration, (dy / distance) * acceleration),
        lane.receivingBasinHeightM,
        lane.surfaceHeightRateMps,
        lane.receivingBasinVelocityDampingPerSec,
      );
    }

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
        overflow ? lane.overflowHeightM : lane.surfaceHeightM,
        overflow ? lane.overflowHeightRateMps : lane.surfaceHeightRateMps,
        lane.laneVelocityDampingPerSec,
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

  /**
   * Whether the leading ordinary lane body has reached the physical GATE arm.
   *
   * This uses the body's own radius rather than a DECODE coordinate: once its
   * centre is within two radii of the exit-side lane end, reopening the arm
   * gives the still-physical body enough clearance to continue its normal
   * downslope motion. Overflow deliberately remains excluded because it rides
   * over the gate rather than pressing on it.
   */
  private normalLaneBallAtGate(
    state: ConveyorState,
    places: ConveyorPlaces,
    snapshot: WorldSnapshot,
  ): boolean {
    const gateM = nearEndOf(places.exit, places.queue.centerM);
    return state.queue.some((pieceId) => {
      const piece = snapshot.pieces.find((candidate) => candidate.pieceId === pieceId);
      if (piece === undefined || piece.heldByRobotId !== null) return false;
      return Math.hypot(piece.pose.p.x - gateM.x, piece.pose.p.y - gateM.y) <= piece.radiusM * 2;
    });
  }

  /** dSim's observed two-second stop window is the generic default. */
  private releaseWindowTicks(spec: PieceConveyorSpec): number {
    const seconds = spec.releaseOpenWindowSec ?? 2;
    return Math.max(1, Math.round(seconds / this.dtSec));
  }

  /** Only a real normal-lane release renews the gate's draining window. */
  private noteNormalLaneFlow(spec: PieceConveyorSpec, state: ConveyorState, tick: number): void {
    state.releaseFlowed = true;
    state.releaseDeadlineTick = tick + this.releaseWindowTicks(spec);
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
 * Position an ordered holder either at its ordinary equal-cell slot or at a
 * declared physical pitch.  A fixed pitch makes like-sized pieces touch
 * end-to-end from the way-out end without encoding season geometry in the
 * engine; the field fixture owns both the pitch and the queue's extent.
 */
export function queuePoint(
  place: Shaped,
  count: number,
  index: number,
  pitchM: number | undefined,
): Vec2 {
  if (pitchM === undefined || pitchM <= 0) return slotPoint(place, count, index);

  const extent = extentOf(place);
  const clampedIndex = Math.min(Math.max(index, 0), Math.max(0, count - 1));
  // The first centre is half a pitch inboard of the low (way-out) end.
  // Clamp defensively so a malformed fixture cannot park beyond its region.
  const offset = Math.min(
    extent.length / 2 - pitchM / 2,
    -extent.length / 2 + pitchM * (clampedIndex + 0.5),
  );
  return extent.alongX
    ? vec2(place.centerM.x + offset, place.centerM.y)
    : vec2(place.centerM.x, place.centerM.y + offset);
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

/**
 * Put an unauthorised body immediately outside the closest public edge of a
 * declared one-way exit. Unlike a velocity-only test, this also blocks a ball
 * pushed through a tunnel's long field-facing side while its gate is open.
 */
function outsideNearestBoundary(place: Shaped, positionM: Vec2, radiusM: number): Vec2 {
  const clearanceM = Math.max(0, radiusM) + 1e-6;
  if (place.shape.kind === 'circle') {
    const dx = positionM.x - place.centerM.x;
    const dy = positionM.y - place.centerM.y;
    const distance = Math.hypot(dx, dy);
    const direction = distance > 1e-9 ? vec2(dx / distance, dy / distance) : vec2(1, 0);
    return vec2(
      place.centerM.x + direction.x * (place.shape.radius + clearanceM),
      place.centerM.y + direction.y * (place.shape.radius + clearanceM),
    );
  }

  const vertices = place.shape.vertices;
  const minX = Math.min(...vertices.map((vertex) => vertex.x));
  const maxX = Math.max(...vertices.map((vertex) => vertex.x));
  const minY = Math.min(...vertices.map((vertex) => vertex.y));
  const maxY = Math.max(...vertices.map((vertex) => vertex.y));
  const nearest = [
    { distance: Math.abs(positionM.x - minX), point: vec2(minX - clearanceM, positionM.y) },
    { distance: Math.abs(maxX - positionM.x), point: vec2(maxX + clearanceM, positionM.y) },
    { distance: Math.abs(positionM.y - minY), point: vec2(positionM.x, minY - clearanceM) },
    { distance: Math.abs(maxY - positionM.y), point: vec2(positionM.x, maxY + clearanceM) },
  ].reduce((best, candidate) => candidate.distance < best.distance ? candidate : best);
  return nearest.point;
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
