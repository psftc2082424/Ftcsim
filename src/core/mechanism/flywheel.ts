/**
 * Launcher capability adapter.
 *
 * The filename is retained for saved import paths, but a launcher is no longer
 * modelled as a flywheel. It is a functional capability: a driver command can
 * send one eligible held piece through the game definition's launch route.
 */

import type { LaunchCapability } from './capability.js';
import type { DerivedMechanism } from './mechanism.js';

export interface LauncherSpec {
  readonly capability: LaunchCapability;
}

export function deriveLauncher(
  _mechanism: DerivedMechanism,
  capability: LaunchCapability,
): LauncherSpec {
  return { capability };
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
