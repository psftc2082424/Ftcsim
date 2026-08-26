/**
 * Region-membership transition detector.
 *
 * The second half of the gap ASSUMPTIONS.md §10.5 names. `regions.ts` gave
 * region ids placed geometry; this turns *changes* in that geometry's membership
 * into the events the rules engine already consumes.
 *
 * ── What it is not ─────────────────────────────────────────────────────────
 *
 * It introduces no event model of its own: every event it produces is one of the
 * kinds already declared in `events.ts`, and the rules engine cannot tell whether
 * a fact came from here or from a hand-written test. It reads no bodies, runs no
 * collision detection and knows nothing about physics — it is handed positions
 * and hands back facts. That keeps the physics→rules channel exactly where
 * ARCHITECTURE.md §3.2 puts it.
 *
 * ── Transitions only ───────────────────────────────────────────────────────
 *
 * A piece sitting in a goal for a hundred ticks produces one event, not a
 * hundred. Rules such as DECODE's CLASSIFIED award per artifact, so re-emitting
 * membership every tick would multiply every score by the dwell time. Only
 * changes are reported.
 *
 * ── Zone occupancy is bucketed, and that is deliberate ─────────────────────
 *
 * `MatchRunner.setZoneOccupancy` sorts a robot into *fully* inside
 * (support ≥ 1), *partially* inside (support > 0) or neither. Those three
 * buckets are the entire zone state the rules can observe, so they are what this
 * detector diffs. A robot easing from half-supported to fully-supported without
 * crossing the boundary changes what `robotFullyInZone` returns, so it is a real
 * transition and is reported — as `RobotOverlapsZone`, which the runner handles
 * by re-setting occupancy, exactly as required.
 */

import { compareEvents, type Alliance, type SimEvent } from './events.js';
import { regionsContaining, robotSupportFraction, validateRegions } from './regions.js';
import type { FieldRegion, FieldZone } from './regions.js';
import type { Vec2 } from '../math/vec2.js';
import type { Obb } from '../physics/shapes.js';

/** Where a game piece is this tick. */
export interface PieceObservation {
  readonly pieceId: string;
  readonly pieceType: string;
  readonly positionM: Vec2;
  /** Height above the floor. Defaults to the floor, where pieces usually are. */
  readonly heightM?: number | undefined;
  /** Robot responsible, when the caller can attribute it. */
  readonly byRobotId?: string | undefined;
  readonly byAlliance?: Alliance | undefined;
}

/** Where a robot is this tick. Its footprint decides zone support. */
export interface RobotObservation {
  readonly robotId: string;
  readonly alliance: Alliance;
  readonly shape: Obb;
  readonly positionM: Vec2;
  readonly headingRad: number;
}

/**
 * A complete snapshot for one tick.
 *
 * Complete is load-bearing: anything previously seen and now absent is treated
 * as having left the field, and its exits are emitted. A caller reporting only
 * the objects that moved would get spurious exits for the ones that did not.
 */
export interface Observation {
  readonly pieces?: readonly PieceObservation[] | undefined;
  readonly robots?: readonly RobotObservation[] | undefined;
}

/** The three zone states the rules can distinguish. */
export type ZoneOccupancy = 'outside' | 'partial' | 'full';

/**
 * Bucket a support fraction.
 *
 * Thresholds mirror `MatchRunner.setZoneOccupancy` exactly. If those ever
 * diverge, a robot could be reported as entering a zone the runner does not
 * record it in.
 */
export function occupancyFor(supportFraction: number): ZoneOccupancy {
  if (supportFraction >= 1) return 'full';
  if (supportFraction > 0) return 'partial';
  return 'outside';
}

export interface DetectorOptions {
  readonly regions: readonly FieldRegion[];
  readonly zones: readonly FieldZone[];
  /** Seconds per tick, so events carry the same derived time the clock uses. */
  readonly dtSec: number;
}

interface PieceState {
  readonly pieceType: string;
  readonly regionIds: readonly string[];
}

/**
 * Both the bucket and the fraction it came from.
 *
 * The *diff* is on the bucket, so easing from 0.25 to 0.5 support emits nothing.
 * The *reported* fraction is the real measurement, so a consumer that wants more
 * resolution than the runner's three buckets gets the truth rather than a
 * representative value invented to fit.
 */
interface ZonePresence {
  readonly bucket: Exclude<ZoneOccupancy, 'outside'>;
  readonly fraction: number;
}

interface RobotState {
  readonly alliance: Alliance;
  /** Presence per zone id. Zones the robot is outside are omitted. */
  readonly occupancy: ReadonlyMap<string, ZonePresence>;
}

export class RegionMembershipDetector {
  private readonly regions: readonly FieldRegion[];
  private readonly zones: readonly FieldZone[];
  private readonly dtSec: number;

  private pieces = new Map<string, PieceState>();
  private robots = new Map<string, RobotState>();

  constructor(options: DetectorOptions) {
    if (!(options.dtSec > 0)) {
      throw new Error(`Detector needs a positive timestep, got ${options.dtSec}.`);
    }

    // Duplicate ids would make membership contradictory — the same id both
    // entered and not — so the same "fail at load" rule the rest of the game
    // layer follows applies here.
    const problems = [
      ...validateRegions(options.regions),
      ...validateRegions(options.zones.map((zone) => ({ ...zone }))),
    ];
    if (problems.length > 0) {
      const detail = problems.map((p) => `${p.regionId}: ${p.message}`).join('; ');
      throw new Error(`Detector was given invalid geometry — ${detail}`);
    }

    this.regions = options.regions;
    this.zones = options.zones;
    this.dtSec = options.dtSec;
  }

  /**
   * Establish a baseline without emitting anything.
   *
   * Pieces pre-placed on the field at match start are already in their regions;
   * treating that as a scoring transition would award points for the setup crew.
   * Prime first, then `update` reports only what actually changes afterwards.
   */
  prime(observation: Observation): void {
    for (const piece of observation.pieces ?? []) {
      this.pieces.set(piece.pieceId, {
        pieceType: piece.pieceType,
        regionIds: this.regionsFor(piece),
      });
    }
    for (const robot of observation.robots ?? []) {
      this.robots.set(robot.robotId, {
        alliance: robot.alliance,
        occupancy: this.occupancyOf(robot),
      });
    }
  }

  /**
   * Diff this tick's snapshot against the last and report what changed.
   *
   * Events come back sorted by `compareEvents`, so the same snapshot sequence
   * always produces the same event sequence regardless of the order objects were
   * listed in — which is what makes a replay reproducible.
   */
  update(observation: Observation, tick: number): readonly SimEvent[] {
    if (!Number.isInteger(tick) || tick < 0) {
      throw new Error(`Tick must be a non-negative integer, got ${tick}.`);
    }

    const timeSec = tick * this.dtSec;
    const events: SimEvent[] = [];

    this.diffPieces(observation.pieces ?? [], tick, timeSec, events);
    this.diffRobots(observation.robots ?? [], tick, timeSec, events);

    return [...events].sort(compareEvents);
  }

  /**
   * Restate current occupancy as events, without diffing.
   *
   * Games routinely assess a position *at the end of a period* — DECODE awards
   * BASE on where robots finished, not on the moment they arrived. A transition
   * detector cannot express that on its own: the arrival may have happened
   * ninety seconds earlier, and by the boundary there is nothing left to
   * transition.
   *
   * So the caller asks for the current state to be restated as facts on the tick
   * a period ends, and an end-of-period rule triggers on those. This stays
   * season-agnostic: it says "here is where everything is", and the
   * GameDefinition decides whether that matters.
   *
   * `RobotOverlapsZone` is used rather than `RobotEnteredZone` because nothing is
   * entering — the robot is already there, which is precisely the fact being
   * reported.
   */
  restateOccupancy(tick: number): readonly SimEvent[] {
    const timeSec = tick * this.dtSec;
    const events: SimEvent[] = [];

    for (const [robotId, state] of this.robots) {
      for (const [zoneId, presence] of state.occupancy) {
        events.push({
          kind: 'RobotOverlapsZone',
          tick,
          timeSec,
          robotId,
          alliance: state.alliance,
          zoneId,
          supportFraction: presence.fraction,
        });
      }
    }

    return [...events].sort(compareEvents);
  }

  /**
   * Report every piece currently at rest in a region as `PieceCameToRest`.
   *
   * Several games assess scoring only once pieces settle, and ordered-slot
   * scoring needs a slot index that no position alone provides. The caller
   * supplies the slot assignment because which slot a piece occupies is a
   * property of the game's region, not of the geometry.
   */
  restateRestingPieces(
    tick: number,
    slotOf?: (pieceId: string, regionId: string) => number | undefined,
  ): readonly SimEvent[] {
    const timeSec = tick * this.dtSec;
    const events: SimEvent[] = [];

    for (const [pieceId, state] of this.pieces) {
      if (state.regionIds.length === 0) continue;

      const primary = state.regionIds[0] as string;
      const slotIndex = slotOf?.(pieceId, primary);

      events.push({
        kind: 'PieceCameToRest',
        tick,
        timeSec,
        pieceId,
        pieceType: state.pieceType,
        regionIds: state.regionIds,
        slotIndex,
      });
    }

    return [...events].sort(compareEvents);
  }

  /** Forget everything. The next `update` treats every object as newly arrived. */
  reset(): void {
    this.pieces = new Map();
    this.robots = new Map();
  }

  /** Regions a piece is currently recorded in, for tests and diagnostics. */
  regionsOf(pieceId: string): readonly string[] {
    return this.pieces.get(pieceId)?.regionIds ?? [];
  }

  /** A robot's current occupancy bucket for one zone. */
  occupancyOfRobot(robotId: string, zoneId: string): ZoneOccupancy {
    return this.robots.get(robotId)?.occupancy.get(zoneId)?.bucket ?? 'outside';
  }

  /** The support fraction behind that bucket, or 0 when outside. */
  supportOfRobot(robotId: string, zoneId: string): number {
    return this.robots.get(robotId)?.occupancy.get(zoneId)?.fraction ?? 0;
  }

  // ------------------------------------------------------------- pieces ---

  private regionsFor(piece: PieceObservation): readonly string[] {
    return regionsContaining(this.regions, piece.positionM, piece.heightM ?? 0);
  }

  private diffPieces(
    observed: readonly PieceObservation[],
    tick: number,
    timeSec: number,
    events: SimEvent[],
  ): void {
    const seen = new Set<string>();

    for (const piece of observed) {
      seen.add(piece.pieceId);

      const previous = this.pieces.get(piece.pieceId);
      const before = new Set(previous?.regionIds ?? []);
      const after = this.regionsFor(piece);

      for (const regionId of after) {
        if (before.has(regionId)) continue;
        events.push({
          kind: 'PieceEnteredRegion',
          tick,
          timeSec,
          pieceId: piece.pieceId,
          pieceType: piece.pieceType,
          regionId,
          byRobotId: piece.byRobotId,
          byAlliance: piece.byAlliance,
        });
      }

      const nowIn = new Set(after);
      for (const regionId of before) {
        if (nowIn.has(regionId)) continue;
        events.push({
          kind: 'PieceExitedRegion',
          tick,
          timeSec,
          pieceId: piece.pieceId,
          pieceType: piece.pieceType,
          regionId,
        });
      }

      this.pieces.set(piece.pieceId, { pieceType: piece.pieceType, regionIds: after });
    }

    // A piece that has left the field exits everything it was in.
    for (const [pieceId, state] of [...this.pieces]) {
      if (seen.has(pieceId)) continue;
      for (const regionId of state.regionIds) {
        events.push({
          kind: 'PieceExitedRegion',
          tick,
          timeSec,
          pieceId,
          pieceType: state.pieceType,
          regionId,
        });
      }
      this.pieces.delete(pieceId);
    }
  }

  // ------------------------------------------------------------- robots ---

  private occupancyOf(robot: RobotObservation): ReadonlyMap<string, ZonePresence> {
    const occupancy = new Map<string, ZonePresence>();

    for (const zone of this.zones) {
      const fraction = robotSupportFraction(zone, robot.shape, robot.positionM, robot.headingRad);
      const bucket = occupancyFor(fraction);
      if (bucket !== 'outside') occupancy.set(zone.id, { bucket, fraction });
    }
    return occupancy;
  }

  private diffRobots(
    observed: readonly RobotObservation[],
    tick: number,
    timeSec: number,
    events: SimEvent[],
  ): void {
    const seen = new Set<string>();

    for (const robot of observed) {
      seen.add(robot.robotId);

      const previous: ReadonlyMap<string, ZonePresence> =
        this.robots.get(robot.robotId)?.occupancy ?? new Map();
      const current = this.occupancyOf(robot);

      for (const [zoneId, presence] of current) {
        const before = previous.get(zoneId);
        // Diff on the bucket: drifting from 0.25 to 0.5 support is not a change
        // the rules can observe, so it is not an event.
        if (before?.bucket === presence.bucket) continue;

        events.push({
          // Absent before means it has arrived; present with a different bucket
          // means it is still inside with materially different support.
          kind: before === undefined ? 'RobotEnteredZone' : 'RobotOverlapsZone',
          tick,
          timeSec,
          robotId: robot.robotId,
          alliance: robot.alliance,
          zoneId,
          supportFraction: presence.fraction,
        });
      }

      for (const [zoneId] of previous) {
        if (current.has(zoneId)) continue;
        events.push({
          kind: 'RobotExitedZone',
          tick,
          timeSec,
          robotId: robot.robotId,
          alliance: robot.alliance,
          zoneId,
        });
      }

      this.robots.set(robot.robotId, { alliance: robot.alliance, occupancy: current });
    }

    for (const [robotId, state] of [...this.robots]) {
      if (seen.has(robotId)) continue;
      for (const [zoneId] of state.occupancy) {
        events.push({
          kind: 'RobotExitedZone',
          tick,
          timeSec,
          robotId,
          alliance: state.alliance,
          zoneId,
        });
      }
      this.robots.delete(robotId);
    }
  }
}
