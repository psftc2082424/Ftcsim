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
import { Pcg32, type SubStreamId } from '../math/rng.js';
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
import { launcherAccepts, pointVelocity } from './shooter.js';
import {
  deriveMechanismSpecs,
  feedAllows,
  initialMechanismState,
  readMechanismCommands,
  trimmedTarget,
  type MechanismSpecs,
  type MechanismState,
} from './robotMechanisms.js';
import { exitSpeedMps } from '../mechanism/flywheel.js';
import {
  ejectionPointM,
  hopperSlotM,
  intakeAccepts,
  mouthContains,
  type IntakeSpec,
} from '../mechanism/intake.js';
import { createStandardField, type FieldTemplate } from '../field/fieldTemplate.js';
import type { Controller } from '../control/controller.js';
import type { ControlInput } from '../control/controlInput.js';
import type {
  Alliance,
  MechanismSnapshot,
  PieceSnapshot,
  RobotSnapshot,
  WorldSnapshot,
} from './snapshot.js';

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

/** A mechanism action awaiting the game-definition route that resolves it. */
export interface PendingPieceAction {
  readonly kind: 'launch';
  readonly pieceId: string;
  readonly robotId: EntityId;
  readonly alliance: Alliance;
  /** Where an unrouted action returns its piece to the field. */
  readonly originM: Vec2;
}

interface SimRobot {
  readonly derived: DerivedRobot;
  readonly body: RigidBody;
  readonly alliance: Alliance;
  readonly controller: Controller;
  readonly specs: MechanismSpecs;
  previousPose: Pose;
  accelerationMps2: number;
  solution: DrivetrainSolution;
  mechanisms: MechanismState;
  /** Current the shooter drew this tick, added to the pack draw. */
  shooterCurrentA: number;
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
  /**
   * Robot holding this piece, or `null` when it is loose.
   *
   * A carried piece is a real body moved with its carrier rather than removed
   * from the world, so it is still drawn, still counted and still there when the
   * robot lets go. It is skipped by collision resolution because it is inside
   * the robot that holds it.
   */
  carriedBy: EntityId | null;
  /**
   * Held by a *field* mechanism rather than a robot (`game/conveyor.ts`).
   *
   * Parked pieces are placed where the mechanism says and are skipped by
   * integration, contact and robot intakes — a ball inside a chute is not
   * resting on the floor and is not something a robot can reach.
   */
  parked: boolean;
  /** Force accumulated by mechanisms this tick, world frame, newtons. */
  forceX: number;
  forceY: number;
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
  /** Actions produced by mechanisms this tick, consumed by MatchSimulation. */
  private pendingPieceActions: PendingPieceAction[] = [];
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
        specs: deriveMechanismSpecs(derived),
        previousPose: body.pose,
        accelerationMps2: 0,
        solution: this.solveFor(derived, { vx: 0, vy: 0, omega: 0 }, { x: 0, y: 0, turn: 0 }),
        mechanisms: initialMechanismState(),
        shooterCurrentA: 0,
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
      carriedBy: null,
      parked: false,
      forceX: 0,
      forceY: 0,
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

      // 3. Mechanisms. After the command is read and before anything moves, so
      //    a piece leaves from where the robot was when the button was pressed
      //    rather than from where this tick carried it.
      this.updateMechanisms(robot, input);

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

      // A carried piece is driven by its robot rather than by its own dynamics,
      // so it is placed after the robot has moved (`carryHeldPieces`) instead of
      // being integrated here. A parked one is held by a field mechanism.
      if (piece.carriedBy !== null || piece.parked) continue;

      // Mechanism forces are the only external ones a piece ever sees: an
      // intake roller dragging it in. They are cleared after use so a force is
      // never applied twice.
      const wrench = { fx: piece.forceX, fy: piece.forceY, mz: 0 };
      piece.forceX = 0;
      piece.forceY = 0;
      integrateBody(piece.body, wrench, DT_SECONDS);

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

    // 6d. Held pieces ride with their robot, which has now moved.
    for (const robot of this.robots) this.carryHeldPieces(robot);

    // 7. Collision.
    this.resolveCollisions();

    // 11. Battery voltage for the *next* tick (ARCHITECTURE.md §5.2). The
    //     shooter draws from the same pack as the drivetrain, so spinning up
    //     while accelerating really does sag the voltage both of them see.
    let packCurrent = 0;
    for (const robot of this.robots) packCurrent += robot.solution.totalCurrent + robot.shooterCurrentA;
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
      mechanisms: mechanismSnapshotOf(robot),
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
      heldByRobotId: piece.carriedBy,
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
    this.cachedSnapshot = null;
  }

  /**
   * Park a piece at a point, held by a field mechanism.
   *
   * The field's equivalent of a robot carrying a piece in its hopper
   * (ASSUMPTIONS.md §9.8): the piece stays a body, keeps its id and is still
   * drawn and counted, but stops being integrated and stops colliding. It is
   * what a chute, a queue or a holder does to a piece it has taken.
   */
  holdPiece(pieceId: string, positionM: Vec2): void {
    const piece = this.pieceNamed(pieceId);
    piece.parked = true;
    piece.carriedBy = null;
    this.settlePiece(piece, positionM);
    this.cachedSnapshot = null;
  }

  /** Put a parked piece back into play at rest. */
  releasePiece(pieceId: string, positionM: Vec2): void {
    const piece = this.pieceNamed(pieceId);
    piece.parked = false;
    piece.carriedBy = null;
    this.settlePiece(piece, positionM);
  }

  /**
   * Move a piece to a game-defined destination without simulating a trajectory.
   *
   * The caller supplies a region's height band where it has one. A scoring
   * action can therefore enter an elevated goal as a deterministic state
   * transition; it does not need an invented launch speed or target collision.
   */
  deliverPiece(pieceId: string, positionM: Vec2, heightM?: number): void {
    const piece = this.pieceNamed(pieceId);
    piece.parked = false;
    piece.carriedBy = null;
    this.settlePiece(piece, positionM);
    this.cachedSnapshot = null;
    if (heightM !== undefined) {
      piece.vertical = { heightM: Math.max(piece.radiusM, heightM), velocityMps: 0 };
      piece.body.span = {
        bottom: piece.vertical.heightM - piece.radiusM,
        top: piece.vertical.heightM + piece.radiusM,
      };
      piece.previousHeightM = piece.vertical.heightM;
    }
    this.cachedSnapshot = null;
  }

  /** Take the mechanism actions produced since the previous read. */
  drainPieceActions(): readonly PendingPieceAction[] {
    const actions = this.pendingPieceActions;
    this.pendingPieceActions = [];
    return actions;
  }

  private settlePiece(piece: SimPiece, positionM: Vec2): void {
    piece.body.pose = { p: positionM, theta: piece.body.pose.theta };
    piece.body.vel = { v: vec2(0, 0), omega: 0 };
    piece.vertical = { heightM: piece.radiusM, velocityMps: 0 };
    piece.body.span = { bottom: 0, top: piece.radiusM * 2 };
    piece.forceX = 0;
    piece.forceY = 0;
    piece.previousPose = piece.body.pose;
    piece.previousHeightM = piece.vertical.heightM;
  }

  private pieceNamed(pieceId: string): SimPiece {
    const piece = this.pieces.find((candidate) => candidate.spec.pieceId === pieceId);
    if (piece === undefined) throw new Error(`No game piece "${pieceId}".`);
    return piece;
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
      // Mechanism state is state, and divergence in it has to be caught. Only
      // hashed for a robot that has a mechanism, so a bare drivetrain robot
      // digests exactly as it did before mechanisms existed and the Phase 1
      // golden value still holds.
      if (robot.specs.launcher !== null || robot.specs.intake !== null) {
        hasher.pushFloat(robot.mechanisms.flywheel.radPerSec);
        hasher.pushInt32(robot.mechanisms.held.length);
      }
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

  /** Pieces a robot's hopper holds right now, oldest first. */
  heldPieces(robotIndex: number): readonly string[] {
    return [...this.robotAt(robotIndex).mechanisms.held];
  }

  /** Live mechanism state for a robot, for callers that need more than a snapshot. */
  mechanismState(robotIndex: number): MechanismState {
    return this.robotAt(robotIndex).mechanisms;
  }

  /** Derived mechanism specs for a robot, for the analytic reference values. */
  mechanismSpecs(robotIndex: number): MechanismSpecs {
    return this.robotAt(robotIndex).specs;
  }

  private robotAt(index: number): SimRobot {
    const robot = this.robots[index];
    if (robot === undefined) throw new Error(`No robot at index ${index}.`);
    return robot;
  }

  // ------------------------------------------------------------ mechanisms ---

  /**
   * Step 3 of the tick: run this robot's mechanisms against the driver's input.
   *
   * Order inside the step matters. Readiness changes first, then an intake may
   * collect a loose piece, and firing comes last so one input can collect and
   * score through the normal game pipeline on the same tick.
   */
  private updateMechanisms(robot: SimRobot, input: ControlInput): void {
    const commands = readMechanismCommands(input);
    const state = robot.mechanisms;
    state.intake = commands.intake;
    state.speedScale = commands.speedScale;
    robot.shooterCurrentA = 0;

    const launcher = robot.specs.launcher;
    if (launcher !== null) {
      const spec = trimmedTarget(launcher.flywheel, commands.speedScale);
      // A functional shooter is ready when it is enabled. Its target setting is
      // retained for builder telemetry, but firing is not derived from torque,
      // wheel inertia, random spread or a projectile trajectory.
      state.flywheel = {
        radPerSec: commands.shooterRunning ? spec.targetRadPerSec : 0,
        running: commands.shooterRunning,
      };
    }

    const intake = robot.specs.intake;
    if (intake !== null) {
      this.runIntake(robot, intake, commands.intake);
      if (commands.intake === 'outtake') this.ejectPiece(robot, intake);
    }

    if (feedAllows(state, commands)) {
      this.firePiece(robot);
    }
    state.firePressed = commands.firing;
  }

  /**
   * Collect loose pieces whose centres are in the enabled intake mouth.
   *
   * The mouth, accepted piece types and capacity are functional constraints a
   * driver can observe. Roller force, ball mass and contact transients are not:
   * acquisition is therefore the deterministic `FIELD -> HELD` transition.
   */
  private runIntake(
    robot: SimRobot,
    spec: IntakeSpec,
    command: 'off' | 'intake' | 'outtake',
  ): void {
    const state = robot.mechanisms;
    const pose = robot.body.pose;
    for (const piece of this.pieces) {
      if (piece.carriedBy !== null || piece.parked) continue;
      if (!intakeAccepts(spec, piece.spec.pieceType)) continue;
      // A piece in flight passes over the intake rather than through it.
      if (isAirborne(piece.vertical, piece.radiusM)) continue;

      const bodyP = rotate(
        vec2(piece.body.pose.p.x - pose.p.x, piece.body.pose.p.y - pose.p.y),
        -pose.theta,
      );
      if (!mouthContains(spec, bodyP)) continue;

      if (command === 'intake' && state.held.length < spec.capacity) {
        state.held.push(piece.spec.pieceId);
        piece.carriedBy = robot.body.id;
        piece.forceX = 0;
        piece.forceY = 0;
      }
    }
  }

  /** Return the oldest held piece to the field just outside the intake mouth. */
  private ejectPiece(robot: SimRobot, spec: IntakeSpec): void {
    const state = robot.mechanisms;
    if (state.held.length === 0) return;
    if (this.tickCount - state.lastEjectTick < this.feedIntervalTicks(robot)) return;

    const pieceId = state.held[0];
    if (pieceId === undefined) return;
    const piece = this.pieces.find((candidate) => candidate.spec.pieceId === pieceId);
    if (piece === undefined) return;

    state.held.shift();
    state.lastEjectTick = this.tickCount;
    piece.carriedBy = null;

    const pose = robot.body.pose;
    const offsetWorld = rotate(ejectionPointM(spec, piece.radiusM), pose.theta);
    piece.body.pose = {
      p: vec2(pose.p.x + offsetWorld.x, pose.p.y + offsetWorld.y),
      theta: piece.body.pose.theta,
    };
    piece.body.vel = {
      v: vec2(robot.body.vel.v.x, robot.body.vel.v.y),
      omega: piece.body.vel.omega,
    };
    piece.vertical = { heightM: piece.radiusM, velocityMps: 0 };
    piece.body.span = { bottom: 0, top: piece.radiusM * 2 };
    piece.previousPose = piece.body.pose;
    piece.previousHeightM = piece.vertical.heightM;
  }

  /**
   * Fire the oldest held piece.
   *
   * A launch is a deterministic `HELD -> TRANSFERRING` transition. The match
   * layer resolves it through the season's action route, then the ordinary
   * membership detector and rules engine score its destination. No projectile
   * or score mutation lives here.
   */
  private firePiece(robot: SimRobot): void {
    const launcher = robot.specs.launcher;
    if (launcher === null) return;

    const state = robot.mechanisms;
    const pieceId = state.held[0];
    if (pieceId === undefined) return;

    const piece = this.pieces.find((candidate) => candidate.spec.pieceId === pieceId);
    if (piece === undefined) return;
    if (!launcherAccepts(launcher.capability, piece.spec.pieceType)) return;

    state.held.shift();
    state.lastFireTick = this.tickCount;
    piece.carriedBy = null;
    piece.parked = true;
    this.settlePiece(piece, robot.body.pose.p);
    this.pendingPieceActions.push({
      kind: 'launch',
      pieceId,
      robotId: robot.body.id,
      alliance: robot.alliance,
      originM: robot.body.pose.p,
    });
  }

  /** Ticks between successive pieces leaving the feeder. */
  private feedIntervalTicks(robot: SimRobot): number {
    const feedPerSec = robot.specs.feedPerSec;
    if (feedPerSec === null || feedPerSec <= 0) return Infinity;
    return 1 / (feedPerSec * DT_SECONDS);
  }

  /**
   * Move held pieces to their hopper slots, after the robot has integrated.
   *
   * A kinematic constraint rather than a contact: the piece is inside the robot
   * and there is nothing meaningful for the contact solver to resolve. It takes
   * the robot's velocity at its own slot, so a piece released by a spinning
   * robot leaves with the velocity it really had. ASSUMPTIONS.md §9.8.
   */
  private carryHeldPieces(robot: SimRobot): void {
    const spec = robot.specs.intake;
    if (spec === null) return;

    const pose = robot.body.pose;
    robot.mechanisms.held.forEach((pieceId, index) => {
      const piece = this.pieces.find((candidate) => candidate.spec.pieceId === pieceId);
      if (piece === undefined) return;

      const offsetWorld = rotate(hopperSlotM(spec, index, piece.radiusM * 2), pose.theta);

      piece.body.pose = {
        p: vec2(pose.p.x + offsetWorld.x, pose.p.y + offsetWorld.y),
        theta: pose.theta,
      };
      piece.body.vel = {
        v: pointVelocity(robot.body.vel.v, robot.body.vel.omega, offsetWorld),
        omega: robot.body.vel.omega,
      };
      piece.vertical = { heightM: piece.radiusM, velocityMps: 0 };
      piece.body.span = { bottom: 0, top: piece.radiusM * 2 };
    });
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
    // A piece inside the robot holding it has no contact worth resolving: it is
    // held by a mechanism, not resting against a surface, and letting the solver
    // see it would push it straight back out of the hopper.
    const carried = new Set<EntityId>();
    for (const piece of this.pieces) {
      if (piece.carriedBy !== null || piece.parked) carried.add(piece.body.id);
    }

    this.broadphase.clear();
    for (const body of this.bodies.values()) {
      if (carried.has(body.id)) continue;
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

/**
 * What a robot's mechanisms are doing, for the read model.
 *
 * Every robot reports one of these, including a robot with no mechanisms — it
 * reports a shooter that is not running and an empty hopper, so nothing
 * downstream has to test whether the fields are there.
 */
function mechanismSnapshotOf(robot: SimRobot): MechanismSnapshot {
  const launcher = robot.specs.launcher;
  const spec = launcher === null ? null : trimmedTarget(launcher.flywheel, robot.mechanisms.speedScale);

  return {
    held: [...robot.mechanisms.held],
    capacity: robot.specs.intake?.capacity ?? 0,
    intake: robot.mechanisms.intake,
    hasIntake: robot.specs.intake !== null,
    hasLauncher: launcher !== null,
    shooterRunning: robot.mechanisms.flywheel.running,
    flywheelRadPerSec: robot.mechanisms.flywheel.radPerSec,
    flywheelTargetRadPerSec: spec?.targetRadPerSec ?? 0,
    exitSpeedMps: spec === null ? 0 : exitSpeedMps(spec, robot.mechanisms.flywheel),
    targetExitSpeedMps:
      spec === null ? 0 : exitSpeedMps(spec, { radPerSec: spec.targetRadPerSec, running: true }),
    shooterCurrentA: robot.shooterCurrentA,
  };
}

/** Body-frame velocity of a robot, from its world-frame velocity and heading. */
export function chassisVelocityOf(body: RigidBody): ChassisVelocity {
  const local = rotate(vec2(body.vel.v.x, body.vel.v.y), -body.pose.theta);
  return { vx: local.x, vy: local.y, omega: body.vel.omega };
}
