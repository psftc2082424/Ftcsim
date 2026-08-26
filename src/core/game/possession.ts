/**
 * Which robot is holding which game piece, decided from simulation state.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Scoring rules routinely need to know *who* did something: "the alliance that
 * scored it", "no more than N at a time", "do not disturb the opponent's
 * pieces". `PieceEnteredRegion` has carried `byRobotId` / `byAlliance` since the
 * event model was written, and nothing has ever filled them in — attribution was
 * a hook waiting for a possession model. This is that model.
 *
 * ── What counts as possession ──────────────────────────────────────────────
 *
 * Deliberately generic: the engine has no opinion about what a season calls
 * this. It decides possession the way any game would recognise it, from contact
 * plus intent-to-move:
 *
 *   1. The piece is touching the robot, within `contactToleranceM`.
 *   2. The robot is moving, and moving *into* the piece — its velocity has a
 *      positive component along the contact normal.
 *
 * DECODE's glossary happens to define CONTROL as "the SCORING ELEMENT is fully
 * supported by ... the ROBOT or it intentionally pushes a SCORING ELEMENT to a
 * desired location or in a preferred direction (i.e., herding)", with case B
 * spelled out as "the ROBOT is moving the SCORING ELEMENT in a preferred
 * direction with a flat or concave face". Condition 2 is that case, and it is
 * the only one a Phase 2 robot can satisfy — nothing in the simulator can yet
 * carry a piece, so "fully supported by the ROBOT" cannot arise.
 *
 * ── What this cannot decide ────────────────────────────────────────────────
 *
 * The same glossary excludes "bulldozing", inadvertent contact with a piece in
 * the robot's path. Bulldozing and herding are geometrically identical; what
 * separates them is intent, which a referee judges and a simulation cannot see.
 * This model therefore reports both as possession and over-reports where a real
 * referee would not. Recorded in ASSUMPTIONS.md §10.14 rather than papered over
 * with a heuristic that would be wrong in a different way.
 */

import { closestPointOnObb, createObb } from '../physics/shapes.js';
import { vec2 } from '../math/vec2.js';
import type { WorldSnapshot } from '../sim/snapshot.js';
import type { Alliance, SimEvent } from './events.js';

/**
 * How close a piece must come to a robot's footprint to count as touching, in
 * metres.
 *
 * Not zero, and not arbitrary: the contact resolver tolerates
 * `PENETRATION_SLOP_M` (1 mm) of overlap and corrects the rest over several
 * ticks, so a piece genuinely resting against a robot sits a millimetre or two
 * away rather than exactly on the surface. 5 mm covers that with margin while
 * staying far below the 124 mm diameter of the smallest piece any FTC season has
 * used, so it cannot bridge a gap a person would call a gap.
 */
export const DEFAULT_CONTACT_TOLERANCE_M = 0.005;

/**
 * How fast a robot must be moving into a piece before it is pushing rather than
 * merely resting against it, in metres per second.
 *
 * A robot parked against a piece is not controlling it, and neither is one that
 * a piece has rolled up against. 0.05 m/s is about 2 in/s — below anything a
 * driver would call moving, above the residual creep a stopped robot shows while
 * its brake asymptotes to zero (ASSUMPTIONS.md §2.4).
 */
export const DEFAULT_MIN_PUSH_SPEED_MPS = 0.05;

/**
 * Ticks of lost contact tolerated before possession is reported as released.
 *
 * A pushed piece bounces: contact breaks and remakes over a few ticks as the
 * resolver separates them and the robot drives back in. Without a grace period
 * a single push would emit a burst of possession and release events, and any
 * rule counting them would be counting numerical noise. Ten ticks is 50 ms at
 * the fixed rate — far shorter than the ~3 s the shortest human-meaningful
 * duration takes, so no rule about duration can notice it.
 */
export const DEFAULT_RELEASE_GRACE_TICKS = 10;

/**
 * How long a robot must hold a count before it is reported as sustained, in
 * seconds.
 *
 * Momentary possession and bulldozing are the same thing seen from different
 * sides, so a rule about how many pieces a robot may hold needs possession that
 * *persisted*. DECODE's glossary puts MOMENTARY at "fewer than approximately 3
 * seconds" (p.185) and G408 itself talks about "greater-than-MOMENTARY CONTROL
 * of 4 or more ARTIFACTS", which is where the default comes from — but the value
 * belongs to the season, so a definition supplies its own.
 */
export const DEFAULT_SUSTAINED_AFTER_SEC = 3;

export interface PossessionOptions {
  readonly contactToleranceM?: number | undefined;
  readonly minPushSpeedMps?: number | undefined;
  readonly releaseGraceTicks?: number | undefined;
  readonly sustainedAfterSec?: number | undefined;
}

/** Who is credited with a piece, for `observation.ts`'s attribution hook. */
export interface PieceCredit {
  readonly robotId: string;
  readonly alliance: Alliance;
}

interface Held {
  readonly robotId: string;
  readonly alliance: Alliance;
  /** Tick possession began, for duration questions. */
  readonly sinceTick: number;
  /** Most recent tick contact was actually observed. */
  lastContactTick: number;
}

/**
 * Tracks possession across ticks and turns the changes into events.
 *
 * Stateful, and owned by the match simulation rather than by the detector: the
 * detector answers "where is everything", this answers "who is holding what",
 * and they are different questions over the same snapshot.
 */
export class PossessionTracker {
  private readonly contactToleranceM: number;
  private readonly minPushSpeedMps: number;
  private readonly releaseGraceTicks: number;
  private readonly sustainedAfterSec: number;

  private readonly held = new Map<string, Held>();
  /** Per robot: the count it currently holds and the tick it reached it. */
  private readonly countLevel = new Map<string, { count: number; sinceTick: number }>();
  /** Per robot: counts already reported as sustained in this episode. */
  private readonly reported = new Map<string, Set<number>>();
  /** Survives release, so a piece that scores after being pushed is credited. */
  private readonly lastCredit = new Map<string, PieceCredit>();

  constructor(options: PossessionOptions = {}) {
    this.contactToleranceM = options.contactToleranceM ?? DEFAULT_CONTACT_TOLERANCE_M;
    this.minPushSpeedMps = options.minPushSpeedMps ?? DEFAULT_MIN_PUSH_SPEED_MPS;
    this.releaseGraceTicks = options.releaseGraceTicks ?? DEFAULT_RELEASE_GRACE_TICKS;
    this.sustainedAfterSec = options.sustainedAfterSec ?? DEFAULT_SUSTAINED_AFTER_SEC;
  }

  /**
   * Who should be credited for a piece.
   *
   * The current holder if there is one, otherwise the last robot to have held
   * it. A piece pushed into a goal is credited to whoever pushed it, which is
   * the whole point of tracking this — and a piece nobody has ever touched has
   * no credit rather than a guessed one.
   */
  creditFor(pieceId: string): PieceCredit | undefined {
    const holder = this.held.get(pieceId);
    if (holder !== undefined) return { robotId: holder.robotId, alliance: holder.alliance };
    return this.lastCredit.get(pieceId);
  }

  /** Pieces a robot is holding right now, in piece order. */
  heldBy(robotId: string): readonly string[] {
    const pieces: string[] = [];
    for (const [pieceId, holder] of this.held) {
      if (holder.robotId === robotId) pieces.push(pieceId);
    }
    return pieces.sort();
  }

  /** How long a robot has held a piece, in seconds. Zero when not held. */
  heldForSec(pieceId: string, tick: number, dtSec: number): number {
    const holder = this.held.get(pieceId);
    return holder === undefined ? 0 : (tick - holder.sinceTick) * dtSec;
  }

  /**
   * Advance one tick and return the possession changes as events.
   *
   * Pieces are visited in snapshot order and robots in snapshot order, and a
   * contested piece goes to the nearest robot with the lower entity id, so the
   * result never depends on iteration order.
   */
  update(snapshot: WorldSnapshot, tick: number): readonly SimEvent[] {
    const events: SimEvent[] = [];
    const claimed = new Map<string, PieceCredit>();

    for (const piece of snapshot.pieces) {
      const holder = this.nearestPusher(snapshot, piece);
      if (holder !== undefined) claimed.set(piece.pieceId, holder);
    }

    // Releases first, so a piece handed from one robot to another reports the
    // release before the new possession and the counts never overlap.
    for (const [pieceId, holder] of [...this.held].sort(byPieceId)) {
      const claim = claimed.get(pieceId);
      if (claim !== undefined && claim.robotId === holder.robotId) {
        holder.lastContactTick = tick;
        continue;
      }
      if (claim === undefined && tick - holder.lastContactTick <= this.releaseGraceTicks) continue;

      this.held.delete(pieceId);
      this.lastCredit.set(pieceId, { robotId: holder.robotId, alliance: holder.alliance });
      events.push(this.releaseEvent(snapshot, pieceId, holder, tick));
    }

    for (const piece of snapshot.pieces) {
      const claim = claimed.get(piece.pieceId);
      if (claim === undefined || this.held.has(piece.pieceId)) continue;

      this.held.set(piece.pieceId, {
        robotId: claim.robotId,
        alliance: claim.alliance,
        sinceTick: tick,
        lastContactTick: tick,
      });
      this.lastCredit.set(piece.pieceId, claim);

      events.push({
        kind: 'PiecePossessed',
        tick,
        timeSec: tickToSec(tick, snapshot),
        pieceId: piece.pieceId,
        pieceType: piece.pieceType,
        robotId: claim.robotId,
        alliance: claim.alliance,
        possessedCount: this.heldBy(claim.robotId).length,
      });
    }

    events.push(...this.sustainedEvents(snapshot, tick));
    return events;
  }

  /**
   * Report counts a robot has now held long enough to be deliberate.
   *
   * Robots are visited in snapshot order, and levels within a robot in ascending
   * order, so the event stream is a function of the world rather than of map
   * iteration.
   */
  private sustainedEvents(snapshot: WorldSnapshot, tick: number): readonly SimEvent[] {
    const events: SimEvent[] = [];
    const dtSec = snapshot.tick === 0 ? 0 : snapshot.timeSec / snapshot.tick;

    for (const robot of snapshot.robots) {
      const robotId = String(robot.id);
      const count = this.heldBy(robotId).length;

      if (count === 0) {
        // Episode over: the next one starts its reporting from scratch.
        this.countLevel.delete(robotId);
        this.reported.delete(robotId);
        continue;
      }

      const level = this.countLevel.get(robotId);
      if (level === undefined || level.count !== count) {
        this.countLevel.set(robotId, { count, sinceTick: tick });
        continue;
      }

      const heldSec = (tick - level.sinceTick) * dtSec;
      if (heldSec < this.sustainedAfterSec) continue;

      let reported = this.reported.get(robotId);
      if (reported === undefined) {
        reported = new Set<number>();
        this.reported.set(robotId, reported);
      }

      // Cumulative: reaching four sustained reports one through four, so a rule
      // charging "per piece over the limit" fires once per excess piece without
      // the engine knowing the limit.
      for (let reachedCount = 1; reachedCount <= count; reachedCount++) {
        if (reported.has(reachedCount)) continue;
        reported.add(reachedCount);

        events.push({
          kind: 'PossessionSustained',
          tick,
          timeSec: tickToSec(tick, snapshot),
          robotId,
          alliance: robot.alliance,
          possessedCount: reachedCount,
          heldSec,
        });
      }
    }

    return events;
  }

  /** Forget everything. Used when a world is rebuilt under the same tracker. */
  reset(): void {
    this.held.clear();
    this.lastCredit.clear();
    this.countLevel.clear();
    this.reported.clear();
  }

  /**
   * The nearest robot that is both touching this piece and driving into it.
   *
   * Ties break on the lower entity id, which the snapshot already orders by, so
   * two robots exactly equidistant produce a stable answer.
   */
  private nearestPusher(
    snapshot: WorldSnapshot,
    piece: WorldSnapshot['pieces'][number],
  ): PieceCredit | undefined {
    let best: PieceCredit | undefined;
    let bestDistance = Infinity;

    for (const robot of snapshot.robots) {
      const footprint = createObb(robot.lengthM, robot.widthM);
      const nearest = closestPointOnObb(footprint, robot.pose.p, robot.pose.theta, piece.pose.p);

      const gap = nearest.distance - piece.radiusM;
      if (gap > this.contactToleranceM) continue;

      const speed = Math.hypot(robot.vel.v.x, robot.vel.v.y);
      if (speed < this.minPushSpeedMps) continue;

      // Direction from the robot's surface out toward the piece. A piece whose
      // centre is inside the footprint has no such direction, so fall back to
      // the line between the two centres.
      const outward =
        nearest.distance > 0
          ? vec2(
              (piece.pose.p.x - nearest.point.x) / nearest.distance,
              (piece.pose.p.y - nearest.point.y) / nearest.distance,
            )
          : normaliseOrZero(piece.pose.p.x - robot.pose.p.x, piece.pose.p.y - robot.pose.p.y);

      // Driving into the piece, not away from it or merely alongside it.
      if (robot.vel.v.x * outward.x + robot.vel.v.y * outward.y <= 0) continue;

      if (nearest.distance < bestDistance) {
        bestDistance = nearest.distance;
        best = { robotId: String(robot.id), alliance: robot.alliance };
      }
    }

    return best;
  }

  private releaseEvent(
    snapshot: WorldSnapshot,
    pieceId: string,
    holder: Held,
    tick: number,
  ): SimEvent {
    const piece = snapshot.pieces.find((candidate) => candidate.pieceId === pieceId);

    return {
      kind: 'PieceReleasedBy',
      tick,
      timeSec: tickToSec(tick, snapshot),
      pieceId,
      pieceType: piece?.pieceType ?? '',
      robotId: holder.robotId,
      alliance: holder.alliance,
      possessedCount: this.heldBy(holder.robotId).length,
    };
  }
}

/** Snapshot time is derived from its own tick, never from a wall clock. */
function tickToSec(tick: number, snapshot: WorldSnapshot): number {
  return snapshot.tick === 0 ? 0 : (snapshot.timeSec / snapshot.tick) * tick;
}

function normaliseOrZero(x: number, y: number): { x: number; y: number } {
  const length = Math.hypot(x, y);
  return length === 0 ? vec2(0, 0) : vec2(x / length, y / length);
}

function byPieceId(a: readonly [string, Held], b: readonly [string, Held]): number {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

/**
 * Attribution function for `observation.ts`, backed by a tracker.
 *
 * Exists so the wiring reads as one line at the call site and the tracker does
 * not have to know the bridge's function shape.
 */
export function attributionFrom(tracker: PossessionTracker) {
  return (pieceId: string): PieceCredit | undefined => tracker.creditFor(pieceId);
}
