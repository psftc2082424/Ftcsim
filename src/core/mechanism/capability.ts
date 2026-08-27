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
 * Capabilities describe the match-visible function a mechanism provides. They
 * do not encode roller, flywheel or projectile construction details.
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
   * Pieces the mechanism can pull in per second, once one is in the mouth.
   *
   * A functional acquisition rate, not a roller surface speed: it gates how
   * often *consecutive* captures may happen, the same way a shooter's rate of
   * fire gates consecutive shots. A higher value means a driver holding the
   * intake over a cluster of pieces clears it faster.
   */
  readonly acquisitionRatePerSec: number;
}

/** Deposit possessed pieces — an outtake, a dropper, a depositor. */
export interface ReleaseCapability {
  readonly kind: 'release';
  readonly pieceTypes: readonly string[];
  readonly reachIn: number;
}

/**
 * Send a held piece to a game-defined target — a shooter or launcher.
 *
 * Firing routes one eligible held piece toward the current game's declared
 * destination on a real, physically simulated path (`sim/simWorld.ts`'s
 * `launchPieceTowards`) — the piece becomes an ordinary game-piece body the
 * moment it leaves, colliding and coming to rest normally. What stays
 * functional is the *mechanism*: accuracy is perfect (the trajectory is solved
 * from geometry, not aimed by the driver or perturbed by noise), and there is
 * no flywheel, RPM or motor-derived exit speed — `shotsPerSecond` is a declared
 * rate of fire, not a value backed by a spin-up simulation.
 */
export interface LaunchCapability {
  readonly kind: 'launch';
  readonly pieceTypes: readonly string[];
  /**
   * Shots per second while the fire command is held.
   *
   * A tap still fires exactly one, because any real press spans many physics
   * ticks; holding the command keeps firing at this rate until storage is
   * empty or the command is released.
   */
  readonly shotsPerSecond: number;
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

/** Capability kinds driven manually by a `ControlInput` action. */
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
