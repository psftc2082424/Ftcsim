/**
 * Mechanism capabilities (ARCHITECTURE.md §7).
 *
 * The engine operates on **what a mechanism can do**, never on what it is
 * called. Type names like "intake" or "shooter" exist only as authoring presets
 * in the UI; nothing in `core/` branches on them. That is what keeps the
 * simulator season-agnostic: a new game needing "hang a specimen on a bar at
 * 26 inches" is `release` + `elevate(≥26 in)`, a data change rather than a code
 * change (PRODUCT_SPEC.md §23).
 *
 * ── Scope in Phase 2 ───────────────────────────────────────────────────────
 *
 * This phase defines the framework and derives each capability's *rates* from
 * the motor and gearing that drive it. It does **not** simulate mechanisms
 * acting on game pieces, because there are no game pieces until Phase 3. The
 * capabilities are real, derived and testable today; what they act upon arrives
 * with the game engine.
 *
 * PRODUCT_SPEC.md §8: "Do not over-engineer every mechanism in the first
 * version."
 */

export type CapabilityKind = 'acquire' | 'release' | 'launch' | 'elevate' | 'climb' | 'traverse';

/** Take possession of game pieces — an intake, a claw, a collector. */
export interface AcquireCapability {
  readonly kind: 'acquire';
  /** Piece type ids this can pick up. Empty means "whatever the game defines". */
  readonly pieceTypes: readonly string[];
  /** How many pieces the mechanism can hold at once. */
  readonly capacity: number;
  /** Depth of the mouth in front of the mount point, inches. */
  readonly reachIn: number;
  /**
   * Width of the mouth across the mount's facing, inches.
   *
   * A wide mouth collects off-centre pieces without the driver lining up; a
   * narrow one has to be aimed. Geometry, so it belongs to the design rather
   * than being derived from the motor.
   */
  readonly mouthWidthIn: number;
  /**
   * Diameter of the roller that grips the piece, inches.
   *
   * Sets both halves of what the intake can do: surface speed is `w * r`, and
   * the force it can apply is `tau / r`. A big roller is fast and weak, a small
   * one slow and strong, from the one number (`mechanism/intake.ts`).
   */
  readonly rollerDiameterIn: number;
}

/** Deposit possessed pieces — an outtake, a dropper, a depositor. */
export interface ReleaseCapability {
  readonly kind: 'release';
  readonly pieceTypes: readonly string[];
  readonly reachIn: number;
}

/**
 * Throw a piece — a shooter, a flywheel, a launcher.
 *
 * `exitSpeedFtPerSec` is the speed the *controller aims for*, not a speed the
 * simulation grants. It is turned into the wheel speed that would produce it
 * (`requiredRadPerSec`), and the shooter then has to actually get there against
 * its own inertia. A shot fired early leaves at whatever the wheel has reached,
 * so a target the motor cannot reach is a design that falls short rather than a
 * number that quietly comes true (`mechanism/flywheel.ts`).
 */
export interface LaunchCapability {
  readonly kind: 'launch';
  readonly pieceTypes: readonly string[];
  /** Exit velocity the shooter is commanded to reach, ft/s. */
  readonly exitSpeedFtPerSec: number;
  /** Launch angle above horizontal, degrees. */
  readonly exitAngleDeg: number;
  /**
   * Mechanical spread, degrees, total cone width.
   *
   * Repeatability of the shooter itself — compression, seam, feed alignment —
   * and the only random term in the shot. Everything else that moves a shot off
   * target is computed from the robot's motion.
   */
  readonly spreadDeg: number;
  /** Flywheel diameter, inches. Sets surface speed and inertia together. */
  readonly flywheelDiameterIn: number;
  /** Mass of everything that spins, pounds. The wheel's inertia is `½mr²`. */
  readonly flywheelMassLb: number;
  /**
   * Exit speed over flywheel surface speed.
   *
   * A geometric property of the build: 0.5 for one wheel against a fixed hood,
   * 1.0 for two counter-rotating wheels. Also fixes how much energy each shot
   * takes out of the wheel, because the backspin the transfer imparts is part
   * of that energy.
   */
  readonly transferRatio: number;
  /**
   * Fraction of the robot's own velocity the aiming solution cancels, 0-1.
   *
   * A ball leaves a moving robot carrying the robot's velocity — that is not a
   * penalty, it is what "leaving a moving vehicle" means. A shooter that knows
   * how fast it is travelling can aim off to cancel it. This is how much of it
   * it cancels: 0 is a robot that must stop to shoot, 1 is a perfect
   * shoot-on-the-move solution (`sim/shooter.ts`).
   */
  readonly shootOnMoveCompensation: number;
}

/** Present a piece at a height — an elevator, an arm, a lift, a slide. */
export interface ElevateCapability {
  readonly kind: 'elevate';
  readonly minHeightIn: number;
  readonly maxHeightIn: number;
  /** Time to traverse the full range, seconds. */
  readonly travelTimeSec: number;
}

/** Endgame ascent — a hang, a climb, a park at height. */
export interface ClimbCapability {
  readonly kind: 'climb';
  /** Game-defined level identifier; the meaning comes from the GameDefinition. */
  readonly level: number;
  readonly timeSec: number;
  /** Probability of success, 0-1. */
  readonly successRate: number;
}

/**
 * Ability to pass beneath field structures.
 *
 * Unlike the others this is a property of the robot rather than of a powered
 * mechanism, and it exists so a clearance metric can be derived from the actual
 * robot height rather than looked up (PRODUCT_SPEC.md §13).
 */
export interface TraverseCapability {
  readonly kind: 'traverse';
  /** Overall height that must clear an obstacle, inches. */
  readonly requiredClearanceIn: number;
}

export type Capability =
  | AcquireCapability
  | ReleaseCapability
  | LaunchCapability
  | ElevateCapability
  | ClimbCapability
  | TraverseCapability;

/** Capabilities whose throughput is set by the motor driving them. */
export const RATE_DRIVEN_KINDS: readonly CapabilityKind[] = ['acquire', 'release', 'launch'];

export function isCapabilityKind(value: string): value is CapabilityKind {
  return (
    value === 'acquire' ||
    value === 'release' ||
    value === 'launch' ||
    value === 'elevate' ||
    value === 'climb' ||
    value === 'traverse'
  );
}
