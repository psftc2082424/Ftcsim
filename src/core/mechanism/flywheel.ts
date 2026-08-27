/**
 * Launcher specification — functionality-first model.
 *
 * A shooter has an exit speed and angle. When fired, it releases a held piece
 * and routes it to the scoring region. No physics needed: the game layer
 * handles piece trajectories and scoring via the rules pipeline.
 */

import { feetPerSecToMetersPerSec, inchesToMeters } from '../units/convert.js';
import type { LaunchCapability } from './capability.js';
import type { DerivedMechanism } from './mechanism.js';

/**
 * A launcher as the gameplay sees it: exit speed and angle.
 *
 * Derived from the config so robots can be built with meaningful shooter specs.
 * The actual firing just reads these values and routes a piece to scoring.
 */
export interface LauncherSpec {
  readonly exitSpeedMps: number;
  readonly exitAngleDeg: number;
  readonly spreadDeg: number;
  readonly shootOnMoveCompensation: number;
}

/**
 * Build a launcher spec from a mechanism the user configured.
 *
 * Exit speed is fixed from the config; no motor model or energy calc needed.
 */
export function deriveLauncher(
  mechanism: DerivedMechanism,
  capability: LaunchCapability,
): LauncherSpec {
  return {
    exitSpeedMps: feetPerSecToMetersPerSec(capability.exitSpeedFtPerSec),
    exitAngleDeg: capability.exitAngleDeg,
    spreadDeg: capability.spreadDeg,
    shootOnMoveCompensation: capability.shootOnMoveCompensation,
  };
}

/** The first launch capability a robot carries, with the mechanism it is on. */
export function launcherOf(
  mechanisms: readonly DerivedMechanism[],
): { readonly mechanism: DerivedMechanism; readonly capability: LaunchCapability } | undefined {
  for (const mechanism of mechanisms) {
    for (const capability of mechanism.config.capabilities) {
      if (capability.kind === 'launch') return { mechanism, capability };
    }
  }
  return undefined;
}
