/**
 * Turning a spinning flywheel and a moving robot into one shot.
 *
 * ── Why this lives in `sim` and not in `game` ──────────────────────────────
 *
 * Launching is something a *robot* does, not something a rule does. The driver
 * spins the shooter up and presses fire; a piece leaves. Nothing about that
 * needs to know what a piece is worth, so it belongs on the control path beside
 * the drivetrain rather than behind the rules-to-physics `Effect` channel
 * (ARCHITECTURE.md §3.2). The game layer sees the consequences the way it sees
 * every other physical fact: as events derived from where things ended up.
 *
 * ── The accuracy model ─────────────────────────────────────────────────────
 *
 * There is no hit probability anywhere in this simulator. A shot is a velocity,
 * it flies (`physics/ballistics.ts`), and it lands where it lands. Three things
 * decide that velocity, and only the first is random:
 *
 *   1. **Mechanical spread.** A cone of `spreadDeg`, drawn uniformly from the
 *      world's seeded generator. This is the shooter's own repeatability —
 *      compression, ball seam, feed alignment — and it is the one term no
 *      amount of robot cleverness removes.
 *
 *   2. **Carried velocity.** A ball leaving a moving robot keeps the robot's
 *      velocity *at the muzzle*, which is `v + w x r` — the chassis velocity
 *      plus what yaw contributes at the shooter's mount. This is not a penalty
 *      applied to moving robots; it is what leaving a moving vehicle means, and
 *      it is exact.
 *
 *   3. **Yaw during transit.** The ball spends a short time being accelerated by
 *      the wheel, and a rotating robot turns during it, so the ball leaves
 *      pointing somewhere the shooter was not aiming when it started.
 *
 * `shootOnMoveCompensation` cancels a fraction of (2) and (3): a shooter that
 * measures its own motion aims off to compensate. What is left is a real
 * velocity error, so a robot strafing at 1 m/s while shooting at 8 m/s with no
 * compensation throws the ball about 7° off — which is the number, not a
 * percentage subtracted from a score.
 *
 * ASSUMPTIONS.md §9.7.
 */

import { degreesToRadians } from '../units/convert.js';
import { vec2, type Vec2 } from '../math/vec2.js';
import type { LaunchCapability } from '../mechanism/capability.js';
import type { Pcg32 } from '../math/rng.js';

/**
 * Button names a robot's mechanisms answer to.
 *
 * One set of names for every season: `ControlInput.buttons` is a map of names,
 * every input source already produces them, and the engine has no opinion about
 * which physical button a driver binds to any of them.
 */
export const LAUNCH_BUTTON = 'launch';
export const SHOOTER_BUTTON = 'shooter';
export const INTAKE_BUTTON = 'intake';
export const OUTTAKE_BUTTON = 'outtake';

/**
 * Analogue axis that trims the shooter's target speed, if a source supplies one.
 *
 * Read as a fraction of the configured target in [0, 1]; absent means "use what
 * the robot was built for". A driver with a trigger can hold a short shot.
 */
export const SHOOTER_SPEED_AXIS = 'shooterSpeed';

/**
 * Height a piece leaves the robot at, in metres.
 *
 * A shooter sits on top of a chassis rather than on the floor. Taken as the
 * robot's own height, which is the tallest a piece could leave from without the
 * mechanism exceeding the robot's declared envelope — the user configures that
 * height, so this is derived from their design rather than picked.
 */
export function launchHeightM(robotHeightM: number): number {
  return robotHeightM;
}

export interface LaunchShot {
  readonly speedMps: number;
  readonly elevationRad: number;
  /** World bearing the piece actually leaves on. */
  readonly headingRad: number;
  readonly fromHeightM: number;
}

/** Everything about the robot and the shooter at the instant of firing. */
export interface ShotConditions {
  readonly capability: LaunchCapability;
  /** Speed the flywheel can impart right now — not the configured target. */
  readonly exitSpeedMps: number;
  /** World bearing the shooter is pointing: robot heading plus mount facing. */
  readonly aimRad: number;
  /** World velocity of the muzzle: chassis velocity plus `w x r`. */
  readonly muzzleVelocity: Vec2;
  /** Robot yaw rate, rad/s. */
  readonly omegaRadPerSec: number;
  readonly pieceDiameterM: number;
  readonly fromHeightM: number;
}

/**
 * Time a ball spends being accelerated by the wheel, seconds.
 *
 * The one length scale in this model that is not measured: the ball is taken to
 * travel about its own radius through the acceleration zone, at a mean speed of
 * half its exit speed, giving `t = 2r/(v/2) = D/v`. Bounded by the ball's own
 * size, so it cannot be wildly wrong, and it only ever matters for a robot that
 * is turning while it fires. ASSUMPTIONS.md §9.7.
 */
export function transitTimeSec(pieceDiameterM: number, exitSpeedMps: number): number {
  if (!(exitSpeedMps > 0)) return 0;
  return pieceDiameterM / exitSpeedMps;
}

/**
 * Compose a shot from the shooter's aim and the robot's motion.
 *
 * A zero spread draws nothing from the generator, so a test can ask for exact
 * trajectories without stubbing it — and adding a shooter to a robot cannot
 * shift the numbers any other system draws, because the caller passes the
 * launch sub-stream (ARCHITECTURE.md §9.1).
 */
export function aimShot(conditions: ShotConditions, rng: Pcg32): LaunchShot {
  const { capability, exitSpeedMps, pieceDiameterM } = conditions;

  const halfSpreadRad = degreesToRadians(capability.spreadDeg / 2);
  const mechanicalError = halfSpreadRad === 0 ? 0 : (rng.nextFloat() * 2 - 1) * halfSpreadRad;

  const uncompensated = 1 - clamp01(capability.shootOnMoveCompensation);

  // The robot turns while the ball is in the shooter, so it leaves pointing
  // where the barrel had got to rather than where it started.
  const yawSmear =
    uncompensated * conditions.omegaRadPerSec * transitTimeSec(pieceDiameterM, exitSpeedMps);

  const muzzleBearing = conditions.aimRad + mechanicalError + yawSmear;

  const elevationRad = degreesToRadians(capability.exitAngleDeg);
  const muzzleHorizontal = exitSpeedMps * Math.cos(elevationRad);
  const verticalMps = exitSpeedMps * Math.sin(elevationRad);

  // Whatever of the robot's velocity the aiming solution did not cancel rides
  // along with the ball. The robot never leaves the floor, so this is purely
  // horizontal and the vertical component is untouched.
  const horizontal = vec2(
    muzzleHorizontal * Math.cos(muzzleBearing) + uncompensated * conditions.muzzleVelocity.x,
    muzzleHorizontal * Math.sin(muzzleBearing) + uncompensated * conditions.muzzleVelocity.y,
  );

  const horizontalSpeed = Math.hypot(horizontal.x, horizontal.y);

  return {
    speedMps: Math.hypot(horizontalSpeed, verticalMps),
    elevationRad: Math.atan2(verticalMps, horizontalSpeed),
    headingRad:
      horizontalSpeed === 0 ? muzzleBearing : Math.atan2(horizontal.y, horizontal.x),
    fromHeightM: conditions.fromHeightM,
  };
}

/**
 * World velocity of a point rigidly attached to a robot: `v + w x r`.
 *
 * In two dimensions the cross product of `w = (0, 0, omega)` with `r = (x, y, 0)`
 * is `(-omega*y, omega*x, 0)`, which is what turns a shooter mounted off the
 * centre line into a moving muzzle whenever the robot spins.
 */
export function pointVelocity(
  chassisVelocity: Vec2,
  omegaRadPerSec: number,
  offsetWorld: Vec2,
): Vec2 {
  return vec2(
    chassisVelocity.x - omegaRadPerSec * offsetWorld.y,
    chassisVelocity.y + omegaRadPerSec * offsetWorld.x,
  );
}

/**
 * Can this launcher throw this piece type?
 *
 * An empty list means "whatever the game defines", which is what the capability
 * model already documents — a shooter built without naming types is not a
 * shooter that fires nothing.
 */
export function launcherAccepts(capability: LaunchCapability, pieceType: string): boolean {
  return capability.pieceTypes.length === 0 || capability.pieceTypes.includes(pieceType);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
