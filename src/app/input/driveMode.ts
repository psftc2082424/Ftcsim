/**
 * Driver-coordinate preferences and the one app-layer transform they need.
 *
 * Robot-centric input is already expressed in the `ControlInput` body frame.
 * Field-centric mode rotates only the driver's translation request into that
 * same body frame before it reaches the existing drivetrain. It does not
 * alter motor commands, kinematics, acceleration, braking, or collisions.
 */

import { createControlInput, type ControlInput } from '../../core/control/controlInput.js';

export type DriveMode = 'robot' | 'field';

export const DEFAULT_DRIVE_MODE: DriveMode = 'robot';

/**
 * Convert a screen-oriented field request to the robot body frame.
 *
 * In field mode, forward means toward the GOAL side (+world Y) and left means
 * screen-left (-world X). Heading zero still points in the body's +X direction,
 * as the unchanged drivetrain expects.
 */
export function fieldCentricInput(input: ControlInput, headingRad: number): ControlInput {
  const worldX = -input.drive.y;
  const worldY = input.drive.x;
  const cos = Math.cos(headingRad);
  const sin = Math.sin(headingRad);

  // Rotate world-frame demand by -heading into the body frame.
  const bodyX = cos * worldX + sin * worldY;
  const bodyY = -sin * worldX + cos * worldY;
  return createControlInput(bodyX, bodyY, input.drive.turn, input.buttons, input.axes);
}
