/**
 * The simulation core.
 *
 * One fixed-rate, deterministic world. There is exactly one simulation
 * implementation in this project: the UI and the headless test harness both
 * drive *this* class, differing only in what advances the clock
 * (ARCHITECTURE.md §9.2).
 *
 * ── Determinism ────────────────────────────────────────────────────────────
 * The integer tick counter is the only clock. Wall-clock access, `Math.random`
 * and ambient entropy are lint-banned throughout `core/`. Contacts are resolved
 * in id order, never in hash-bucket order. Given the same seed, the same robot
 * configurations and the same controller outputs, `stateHash()` is identical on
 * every run.
 *
 * ── Tick order ─────────────────────────────────────────────────────────────
 * The canonical order is fixed in ARCHITECTURE.md §9. Phase 1 implements the
 * subset whose systems exist; the omitted steps are listed so the sequence is
 * auditable rather than lost:
 *
 *    1  match clock                      — Phase 3, not implemented
 *    2  controller.sample                ✓
 *    3  mechanisms.update                — Phase 2, not implemented
 *    4  drivetrain.solve                 ✓  (uses tick n-1 battery voltage)
 *    5  traction.limit                   ✓  (identity in Phase 1)
 *    6  integrate                        ✓
 *    7  broadphase -> narrowphase -> resolve   ✓
 *    8  events.flush                     — Phase 3, not implemented
 *    9  rulesEngine.evaluate             — Phase 3, not implemented
 *   10  effects.apply                    — Phase 3, not implemented
 *   11  battery.update                   ✓
 *   12  telemetry.sample                 ✓  (pulled by the caller at 10 Hz)
 *   13  tick++                           ✓
 *
 * No no-op stand-ins are created for the missing steps.
 */

import { Battery, type BatteryConfig } from '../motor/battery.js';
import { Pcg32, SubStream, type SubStreamId } from '../math/rng.js';
import { StateHasher } from '../math/hash.js';
import { solveDrivetrain, type DrivetrainSolution } from '../drive/drivetrain.js';
import { IdealTraction, type TractionModel } from '../drive/traction.js';
import type { ChassisVelocity } from '../drive/mecanumKinematics.js';
import { rotate, vec2, type Vec2 } from '../math/vec2.js';
import { deriveRobot, type DerivedRobot } from '../robot/derive.js';
import type { RobotConfig } from '../robot/robotConfig.js';
import {
  bodyAabb,
  createDynamicBody,
  spansOverlap,
  type EntityId,
  type Pose,
  type RigidBody,
} from '../physics/body.js';
import { amps } from '../units/si.js';
import { createCircle, createObb } from '../physics/shapes.js';
import { inchesToMeters, poundsToKilograms } from '../units/convert.js';
import { SpatialHash } from '../physics/broadphase.js';
import { collide } from '../physics/sat.js';
import { resolveContact } from '../physics/resolve.js';
import { integrateBody } from '../physics/integrate.js';
import { isAirborne, launchComponents, stepVertical, type VerticalState } from '../physics/ballistics.js';
import {
  LAUNCH_BUTTON,
  aimShot,
  launchHeightM,
  launcherAccepts,
  launcherOf,
  loadedWithinM,
} from './launcher.js';
import { closestPointOnObb } from '../physics/shapes.js';
import { createStandardField, type FieldTemplate } from '../field/fieldTemplate.js';
import type { Controller } from '../control/controller.js';
import type { Alliance, PieceSnapshot, RobotSnapshot, WorldSnapshot } from './snapshot.js';

/** Reused so the free-body integration allocates nothing per tick. */
const ZERO_WRENCH = Object.freeze({ fx: 0, fy: 0, mz: 0 });

/** Fixed simulation rate. ASSUMPTIONS.md §4.1. */
export const TICK_RATE_HZ = 200;
export const DT_SECONDS = 1 / TICK_RATE_HZ;

/**
 * Passes over the contact set per tick.
 *
 * One pass resolves each contact in isolation, which is enough for a body with
 * a single contact and wrong for a body with two. Repeating the sweep lets
 * neighbouring contacts see each other's corrections. ASSUMPTIONS.md §5.8.
 */
export const CONTACT_PASSES = 4;

/** Telemetry is sampled every 20th tick, i.e. 10 Hz. ASSUMPTIONS.md §4.3. */
export const TELEMETRY_TICK_INTERVAL = TICK_RATE_HZ / 10;

/**
 * Entity ids for game pieces start here.
 *
 * Robots take 0 upward and the standard field takes 1000 upward, so pieces sit
 * in the gap between them. Any collision with an existing id is caught in the
 * constructor rather than silently overwriting a body.
 */
export const PIECE_ENTITY_ID_BASE = 100;

export interface RobotSpec {
  readonly config: RobotConfig;
  readonly controller: Controller;
  readonly alliance?: Alliance | undefined;
  readonly startPose?: Pose | undefined;
}

/**
 * A game piece placed on the field.
 *
 * Authored in FTC units like `RobotConfig`, and converted once here. Pieces are
 * modelled as circles: FTC game pieces are usually balls or discs, and a circle
 * needs no orientation to be meaningful.
 */
export interface GamePieceSpec {
  /** String id carried on the game layer's events. */
  readonly pieceId: string;
  /** Piece class, e.g. a colour. Also carried on events. */
  readonly pieceType: string;
  readonly diameterIn: number;
  readonly massLb: number;
  readonly startPositionM?: Vec2 | undefined;
  /** Centre height above the floor. Defaults to resting on its own radius. */
  readonly heightM?: number;
}

export interface SimWorldOptions {
  /**
   * Robots in the world. The core supports several; Phase 1's UI creates one.
   * Nothing here special-cases the count (ARCHITECTURE.md §9).
   */
  readonly robots: readonly RobotSpec[];
  /** Game pieces on the field. Optional: a bare drivetrain world has none. */
  readonly pieces?: readonly GamePieceSpec[] | undefined;
  readonly field?: FieldTemplate | undefined;
  readonly battery?: BatteryConfig | undefined;
  readonly traction?: TractionModel | undefined;
  readonly seed?: number | undefined;
}

interface SimRobot {
  readonly derived: DerivedRobot;
  readonly body: RigidBody;
  readonly alliance: Alliance;
  readonly controller: Controller;
  previousPose: Pose;
  accelerationMps2: number;
  solution: DrivetrainSolution;
}

interface SimPiece {
  readonly spec: GamePieceSpec;
  readonly body: RigidBody;
  readonly radiusM: number;
  previousPose: Pose;
  /**
   * Height and climb rate, integrated separately from the planar body.
   *
   * A robot never leaves the floor and a launched piece does, so a piece
   * carries the one extra degree of freedom rather than the physics gaining a
   * third dimension it would not use (`physics/ballistics.ts`).
   */
  vertical: VerticalState;
  previousHeightM: number;
}

export class SimWorld {
  readonly dt = DT_SECONDS;
  readonly field: FieldTemplate;
  readonly seed: number;

  private tickCount = 0;
  private readonly robots: SimRobot[] = [];
  private readonly pieces: SimPiece[] = [];
  private readonly bodies = new Map<EntityId, RigidBody>();
  private readonly battery: Battery;
  private readonly broadphase = new SpatialHash();
  private readonly traction: TractionModel;
  private readonly subStreams = new Map<SubStreamId, Pcg32>();
  private cachedSnapshot: WorldSnapshot | null = null;

  constructor(options: SimWorldOptions) {
    if (options.robots.length === 0) {
      throw new Error('SimWorld needs at least one robot.');
    }

    this.field = options.field ?? createStandardField();
    this.traction = options.traction ?? IdealTraction;
    this.seed = options.seed ?? 0;
    this.battery = new Battery(options.battery);

    for (const wall of this.field.bodies) this.bodies.set(wall.id, wall);

    options.robots.forEach((spec, index) => {
      const derived = deriveRobot(spec.config);
      const body = createDynamicBody({
        id: index,
        kind: 'robot',
        shape: createObb(derived.lengthM, derived.widthM),
        mass: derived.massKg,
        inertiaZ: derived.inertiaZ,
        span: { bottom: 0, top: derived.heightM },
        pose: spec.startPose ?? { p: vec2(0, 0), theta: 0 },
      });

      this.bodies.set(body.id, body);
      this.robots.push({
        derived,
        body,
        alliance: spec.alliance ?? 'red',
        controller: spec.controller,
        previousPose: body.pose,
        accelerationMps2: 0,
        solution: this.solveFor(derived, { vx: 0, vy: 0, omega: 0 }, { x: 0, y: 0, turn: 0 }),
      });
    });

    (options.pieces ?? []).forEach((spec, index) => this.addPiece(spec, index));
  }

  private addPiece(spec: GamePieceSpec, index: number): void {
    if (spec.pieceId === '') throw new Error('Game piece needs a non-empty pieceId.');
    if (!(spec.diameterIn > 0)) {
      throw new Error(`Piece "${spec.pieceId}" needs a positive diameter, got ${spec.diameterIn}.`);
    }
    if (!(spec.massLb > 0)) {
      throw new Error(`Piece "${spec.pieceId}" needs a positive mass, got ${spec.massLb}.`);
    }
    if (this.pieces.some((existing) => existing.spec.pieceId === spec.pieceId)) {
      throw new Error(`Duplicate game piece id "${spec.pieceId}".`);
    }

    const id = PIECE_ENTITY_ID_BASE + index;
    if (this.bodies.has(id)) {
      throw new Error(
        `Entity id ${id} for piece "${spec.pieceId}" is already taken. ` +
          'Piece ids start at PIECE_ENTITY_ID_BASE; the field or robots have overrun it.',
      );
    }

    const radiusM = inchesToMeters(spec.diameterIn) / 2;
    const massKg = poundsToKilograms(spec.massLb);
    // Solid disc about its centre: I = ½ m r².
    const inertiaZ = 0.5 * massKg * radiusM * radiusM;
    // A piece rests on the floor, so its centre sits one radius up unless the
    // caller says otherwise.
    const heightM = spec.heightM ?? radiusM;

    const body = createDynamicBody({
      id,
      kind: 'piece',
      shape: createCircle(radiusM),
      mass: massKg,
      inertiaZ,
      span: { bottom: Math.max(0, heightM - radiusM), top: heightM + radiusM },
      pose: { p: spec.startPositionM ?? vec2(0, 0), theta: 0 },
    });

    this.bodies.set(id, body);
    this.pieces.push({
      spec,
      body,
      radiusM,
      previousPose: body.pose,
      vertical: { heightM, velocityMps: 0 },
      previousHeightM: heightM,
    });
  }

  get tick(): number {
    return this.tickCount;
  }

  /** Simulated time, derived from the tick counter. Never a wall clock. */
  get timeSec(): number {
    return this.tickCount * DT_SECONDS;
  }

  get batteryVolts(): number {
    return this.battery.voltage;
  }

  /**
   * Seeded generator for one subsystem.
   *
   * Phase 1 draws no random numbers — nothing in the drivetrain, collision or
   * integration is stochastic. The generator is owned here from the start so
   * that when shooter spread or piece scatter arrives it draws from a seeded,
   * replayable sub-stream rather than from ambient entropy.
   */
  rng(stream: SubStreamId): Pcg32 {
    const existing = this.subStreams.get(stream);
    if (existing !== undefined) return existing;
    const created = new Pcg32(this.seed, stream);
    this.subStreams.set(stream, created);
    return created;
  }

  /** Advance the world by exactly one fixed timestep. */
  step(): void {
    const snapshot = this.snapshot();

    for (const robot of this.robots) {
      robot.previousPose = robot.body.pose;

      // 2. Sample the controller. Any source, one struct.
      const input = robot.controller.sample(this.tickCount, snapshot);

      // 4-5. Drivetrain: torque -> wheel force -> body wrench, ideal traction.
      const chassis = chassisVelocityOf(robot.body);
      robot.solution = this.solveFor(robot.derived, chassis, {
        x: input.drive.x,
        y: input.drive.y,
        turn: input.drive.turn,
      });

      // 5b. Launch, if the driver asked and the robot can. Before integration
      //     so a piece leaves from where the robot was when the button was
      //     read, not from where the tick moved it to.
      if (input.buttons[LAUNCH_BUTTON] === true) this.fireLauncher(robot);

      // 6. Integrate.
      const speedBefore = Math.hypot(robot.body.vel.v.x, robot.body.vel.v.y);
      integrateBody(robot.body, robot.solution.wrench, DT_SECONDS);
      const speedAfter = Math.hypot(robot.body.vel.v.x, robot.body.vel.v.y);
      robot.accelerationMps2 = (speedAfter - speedBefore) / DT_SECONDS;
    }

    // 6b. Pieces integrate freely: nothing drives them, so they carry whatever
    // velocity a collision last gave them. Note there is no damping — see
    // ASSUMPTIONS.md §5.5.
    for (const piece of this.pieces) {
      piece.previousPose = piece.body.pose;
      piece.previousHeightM = piece.vertical.heightM;
      integrateBody(piece.body, ZERO_WRENCH, DT_SECONDS);

      // 6c. Height, under gravity. A piece in flight keeps its horizontal
      //     velocity — with no drag the two are independent — and its span
      //     rises with it, which is what lets it pass over a robot rather
      //     than through one.
      piece.vertical = stepVertical(
        piece.vertical,
        piece.radiusM,
        DT_SECONDS,
        piece.body.restitution,
      ).state;
      piece.body.span = {
        bottom: Math.max(0, piece.vertical.heightM - piece.radiusM),
        top: piece.vertical.heightM + piece.radiusM,
      };
    }

    // 7. Collision.
    this.resolveCollisions();

    // 11. Battery voltage for the *next* tick (ARCHITECTURE.md §5.2).
    let packCurrent = 0;
    for (const robot of this.robots) packCurrent += robot.solution.totalCurrent;
    this.battery.update(amps(packCurrent));

    // 13.
    this.tickCount++;
    this.cachedSnapshot = null;
  }

  /** Advance several ticks. */
  stepMany(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  /**
   * Immutable view of the world.
   *
   * Built at most once per tick and shared by the controllers, the renderer and
   * the telemetry sampler, so the per-tick allocation stays bounded by robot
   * count rather than by how many consumers ask for it.
   */
  snapshot(): WorldSnapshot {
    const cached = this.cachedSnapshot;
    if (cached !== null) return cached;

    const robots: RobotSnapshot[] = this.robots.map((robot) => ({
      id: robot.body.id,
      name: robot.derived.config.name,
      alliance: robot.alliance,
      pose: robot.body.pose,
      previousPose: robot.previousPose,
      vel: robot.body.vel,
      chassis: chassisVelocityOf(robot.body),
      accelerationMps2: robot.accelerationMps2,
      lengthM: robot.derived.lengthM,
      widthM: robot.derived.widthM,
      heightM: robot.derived.heightM,
      gearRatio: robot.derived.drivetrain.gearRatio,
      wheelRadiusM: robot.derived.wheelRadius,
      drive: {
        duties: robot.solution.wheelDuties,
        motorSpeeds: robot.solution.motorSpeeds,
        motorTorques: robot.solution.motorTorques,
        motorCurrents: robot.solution.motorCurrents,
        wheelForces: robot.solution.wheelForces,
      },
    }));

    const pieces: PieceSnapshot[] = this.pieces.map((piece) => ({
      id: piece.body.id,
      pieceId: piece.spec.pieceId,
      pieceType: piece.spec.pieceType,
      pose: piece.body.pose,
      previousPose: piece.previousPose,
      vel: piece.body.vel,
      radiusM: piece.radiusM,
      heightM: piece.vertical.heightM,
      previousHeightM: piece.previousHeightM,
      verticalVelocityMps: piece.vertical.velocityMps,
      airborne: isAirborne(piece.vertical, piece.radiusM),
    }));

    const snapshot: WorldSnapshot = {
      tick: this.tickCount,
      timeSec: this.timeSec,
      robots,
      pieces,
      batteryVolts: this.battery.voltage,
      batteryCurrentA: this.battery.current,
    };
    this.cachedSnapshot = snapshot;
    return snapshot;
  }

  /**
   * Throw a piece: give it a horizontal velocity and a climb rate.
   *
   * The physics of a shot, with none of the policy. Who may launch, from what
   * height, how accurately and whether they possessed the piece first are all
   * questions for the layer above — this only puts a piece in the air.
   *
   * `elevationRad` is measured up from the floor and `headingRad` is a world
   * bearing, so a caller launching from a robot passes the robot's heading
   * plus whatever its mechanism adds.
   */
  launchPiece(
    pieceId: string,
    options: {
      readonly speedMps: number;
      readonly elevationRad: number;
      readonly headingRad: number;
      readonly fromHeightM?: number | undefined;
    },
  ): void {
    const piece = this.pieces.find((candidate) => candidate.spec.pieceId === pieceId);
    if (piece === undefined) throw new Error(`No game piece "${pieceId}" to launch.`);
    if (!(options.speedMps >= 0)) {
      throw new Error(`Launch speed must be non-negative, got ${options.speedMps}.`);
    }

    const { horizontalMps, verticalMps } = launchComponents(
      options.speedMps,
      options.elevationRad,
    );

    piece.body.vel = {
      v: vec2(
        horizontalMps * Math.cos(options.headingRad),
        horizontalMps * Math.sin(options.headingRad),
      ),
      omega: piece.body.vel.omega,
    };

    // Released at the mechanism's height, or from where it already is.
    const fromHeightM = options.fromHeightM ?? piece.vertical.heightM;
    piece.vertical = {
      heightM: Math.max(piece.radiusM, fromHeightM),
      velocityMps: verticalMps,
    };
  }

  /** Height of a piece's centre above the floor, metres. */
  pieceHeightM(pieceId: string): number {
    const piece = this.pieces.find((candidate) => candidate.spec.pieceId === pieceId);
    if (piece === undefined) throw new Error(`No game piece "${pieceId}".`);
    return piece.vertical.heightM;
  }

  /** Derived robot data, for callers that need the analytic reference values. */
  derivedRobot(index: number): DerivedRobot {
    const robot = this.robots[index];
    if (robot === undefined) throw new Error(`No robot at index ${index}.`);
    return robot.derived;
  }

  /**
   * Order-sensitive digest of the full simulation state.
   *
   * Any accidental nondeterminism — unordered iteration, a leaked wall clock,
   * an unseeded draw — changes this value immediately.
   */
  stateHash(): string {
    const hasher = new StateHasher();
    hasher.pushInt32(this.tickCount);
    hasher.pushFloat(this.battery.voltage);
    hasher.pushFloat(this.battery.current);

    for (const robot of this.robots) {
      const { pose, vel } = robot.body;
      hasher.pushInt32(robot.body.id);
      hasher.pushFloat(pose.p.x).pushFloat(pose.p.y).pushFloat(pose.theta);
      hasher.pushFloat(vel.v.x).pushFloat(vel.v.y).pushFloat(vel.omega);
    }

    // Pieces contribute in creation order. A world with none hashes exactly as
    // it did before pieces existed, so the Phase 1 golden digest still holds.
    for (const piece of this.pieces) {
      const { pose, vel } = piece.body;
      hasher.pushInt32(piece.body.id);
      hasher.pushFloat(pose.p.x).pushFloat(pose.p.y).pushFloat(pose.theta);
      hasher.pushFloat(vel.v.x).pushFloat(vel.v.y).pushFloat(vel.omega);
      // Height is state like any other; leaving it out would let a shot
      // diverge without the determinism canary noticing.
      hasher.pushFloat(piece.vertical.heightM).pushFloat(piece.vertical.velocityMps);
    }

    return hasher.digestHex();
  }

  /** Game pieces in creation order, for callers that need more than a snapshot. */
  get pieceCount(): number {
    return this.pieces.length;
  }

  /**
   * Throw the piece this robot is holding, if it is holding one.
   *
   * "Holding" is decided by geometry: the nearest piece within a diameter of
   * the robot's footprint that the launcher accepts. A robot with no launch
   * capability, or nothing loaded, simply does nothing — pressing the button
   * with an empty shooter is not an error.
   */
  private fireLauncher(robot: SimRobot): void {
    const capability = launcherOf(robot.derived.mechanisms);
    if (capability === undefined) return;

    const footprint = createObb(robot.derived.lengthM, robot.derived.widthM);

    let loaded: SimPiece | undefined;
    let bestGap = Infinity;
    for (const piece of this.pieces) {
      if (!launcherAccepts(capability, piece.spec.pieceType)) continue;

      const nearest = closestPointOnObb(
        footprint,
        robot.body.pose.p,
        robot.body.pose.theta,
        piece.body.pose.p,
      );
      const gap = nearest.distance - piece.radiusM;
      if (gap > loadedWithinM(piece.radiusM) || gap >= bestGap) continue;

      bestGap = gap;
      loaded = piece;
    }

    if (loaded === undefined) return;

    const shot = aimShot(
      capability,
      robot.body.pose.theta,
      launchHeightM(robot.derived.heightM),
      // Its own sub-stream, so adding a shooter cannot shift the numbers any
      // other system draws (ARCHITECTURE.md §9.1).
      this.rng(SubStream.Launch),
    );
    this.launchPiece(loaded.spec.pieceId, shot);
  }

  private solveFor(
    derived: DerivedRobot,
    chassis: ChassisVelocity,
    command: { x: number; y: number; turn: number },
  ): DrivetrainSolution {
    return solveDrivetrain(
      derived.drivetrain,
      chassis,
      command,
      this.battery.voltage,
      this.traction,
      derived.massKg,
    );
  }

  private resolveCollisions(): void {
    this.broadphase.clear();
    for (const body of this.bodies.values()) {
      this.broadphase.insert(body.id, bodyAabb(body));
    }

    // Pairs arrive sorted by id, so resolution order is fixed regardless of how
    // the spatial hash happened to bucket them.
    const pairs = this.broadphase.queryPairs();

    // Several passes over the whole set, not one. A body with two contacts —
    // a game piece pinned between a robot and a wall — cannot be satisfied by
    // resolving each contact once: the correction for one undoes the other, and
    // single-pass resolution walked the piece through the perimeter
    // (ASSUMPTIONS.md §5.8). Narrowphase re-runs each pass because the previous
    // one moved things; the broadphase does not, because a positional
    // correction is bounded by the penetration it is removing and cannot carry
    // a body into a cell it was not already overlapping.
    for (let pass = 0; pass < CONTACT_PASSES; pass++) {
      let resolvedAny = false;

      for (const [idA, idB] of pairs) {
        const a = this.bodies.get(idA);
        const b = this.bodies.get(idB);
        if (a === undefined || b === undefined) continue;
        if (a.invMass === 0 && b.invMass === 0) continue;

        // Bodies only interact if they occupy overlapping heights. In Phase 1
        // everything is floor-mounted, so this always passes; it is what will
        // let a low robot pass under a raised element later.
        if (!spansOverlap(a.span, b.span)) continue;

        const contact = collide(a.shape, a.pose, b.shape, b.pose);
        if (contact === null) continue;

        resolveContact(a, b, contact);
        resolvedAny = true;
      }

      // Nothing was touching, so further passes would find nothing either.
      if (!resolvedAny) break;
    }
  }
}

/** Body-frame velocity of a robot, from its world-frame velocity and heading. */
export function chassisVelocityOf(body: RigidBody): ChassisVelocity {
  const local = rotate(vec2(body.vel.v.x, body.vel.v.y), -body.pose.theta);
  return { vx: local.x, vy: local.y, omega: body.vel.omega };
}
