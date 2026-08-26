/**
 * Firing a game piece, from a robot's own mechanisms.
 *
 * ── Why this lives in `sim` and not in `game` ──────────────────────────────
 *
 * Launching is something a *robot* does, not something a rule does. The driver
 * presses a button, the shooter spins, a piece leaves. Nothing about that needs
 * to know what a piece is worth, so it belongs on the control path beside the
 * drivetrain rather than behind the rules-to-physics `Effect` channel
 * (ARCHITECTURE.md §3.2). The game layer sees the consequences the way it sees
 * every other physical fact: as events derived from where things ended up.
 *
 * ── What a shot is made of ─────────────────────────────────────────────────
 *
 * Everything comes from the robot's `LaunchCapability`, which the user
 * configures: exit speed, elevation, and an accuracy spread. None of it is
 * invented here — a shooter that throws further is one the user built to throw
 * further, and the trajectory it produces is integrated by
 * `physics/ballistics.ts` rather than assumed.
 *
 * The spread is the one part that is random, and it draws from the world's
 * seeded generator so a replay reproduces the same shots (ARCHITECTURE.md §9.1).
 */

import { degreesToRadians, inchesToMeters } from '../units/convert.js';
import type { LaunchCapability } from '../mechanism/capability.js';
import type { DerivedMechanism } from '../mechanism/mechanism.js';
import type { Pcg32 } from '../math/rng.js';

/**
 * Button name a robot's launcher answers to.
 *
 * One name for every season: `ControlInput.buttons` is a map of names, the
 * virtual pad already produces them, and the engine has no opinion about which
 * physical button a driver binds to it.
 */
export const LAUNCH_BUTTON = 'launch';

/**
 * Height a piece leaves the robot at, in inches.
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
  /** World bearing, robot heading plus whatever the spread drew. */
  readonly headingRad: number;
  readonly fromHeightM: number;
}

/** The first launch capability a robot carries, or `undefined` if it has none. */
export function launcherOf(
  mechanisms: readonly DerivedMechanism[],
): LaunchCapability | undefined {
  for (const mechanism of mechanisms) {
    for (const capability of mechanism.config.capabilities) {
      if (capability.kind === 'launch') return capability;
    }
  }
  return undefined;
}

/**
 * Turn a capability and a heading into a shot.
 *
 * The spread is applied as a uniform bearing error of up to `spreadDeg / 2`
 * either side, which is how a spread is quoted: a cone of that total width. A
 * zero spread is a perfectly repeatable shooter and draws nothing, so a test can
 * ask for exact trajectories without stubbing the generator.
 */
export function aimShot(
  capability: LaunchCapability,
  headingRad: number,
  fromHeightM: number,
  rng: Pcg32,
): LaunchShot {
  const halfSpreadRad = degreesToRadians(capability.spreadDeg / 2);
  const error = halfSpreadRad === 0 ? 0 : (rng.nextFloat() * 2 - 1) * halfSpreadRad;

  return {
    speedMps: feetPerSecToMetersPerSec(capability.exitSpeedFtPerSec),
    elevationRad: degreesToRadians(capability.exitAngleDeg),
    headingRad: headingRad + error,
    fromHeightM,
  };
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

/**
 * How far in front of the robot a piece has to be for the launcher to take it.
 *
 * A launcher has no `reachIn` of its own — an intake does — so this is the
 * distance from the robot's leading face within which a piece counts as loaded.
 * One piece diameter: a piece touching the robot is loaded, and one a diameter
 * away is not.
 */
export function loadedWithinM(pieceRadiusM: number): number {
  return pieceRadiusM * 2;
}

function feetPerSecToMetersPerSec(feetPerSec: number): number {
  return inchesToMeters(feetPerSec * 12);
}
