/** Shared, source-agnostic controls for functional robot mechanisms. */

import type { LaunchCapability } from '../mechanism/capability.js';

export const LAUNCH_BUTTON = 'launch';
export const INTAKE_BUTTON = 'intake';
export const OUTTAKE_BUTTON = 'outtake';

/** Whether a launcher accepts a game-piece type. */
export function launcherAccepts(capability: LaunchCapability, pieceType: string): boolean {
  return capability.pieceTypes.length === 0 || capability.pieceTypes.includes(pieceType);
}
