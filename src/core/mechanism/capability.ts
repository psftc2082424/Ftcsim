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
  /**
   * Reach in front of the mount point, inches. Used in Phase 3 to decide which
   * pieces are within grabbing distance.
   */
  readonly reachIn: number;
}

/** Deposit possessed pieces — an outtake, a dropper, a depositor. */
export interface ReleaseCapability {
  readonly kind: 'release';
  readonly pieceTypes: readonly string[];
  readonly reachIn: number;
}

/** Throw a piece — a shooter, a flywheel, a launcher. */
export interface LaunchCapability {
  readonly kind: 'launch';
  readonly pieceTypes: readonly string[];
  /** Exit velocity, ft/s. Derived from flywheel surface speed when actuated. */
  readonly exitSpeedFtPerSec: number;
  /** Launch angle above horizontal, degrees. */
  readonly exitAngleDeg: number;
  /** Angular spread, degrees. Larger is less accurate. */
  readonly spreadDeg: number;
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
