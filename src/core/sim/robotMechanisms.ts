/**
 * Per-robot mechanism runtime — functionality-first model.
 *
 * Mechanisms are simple state machines:
 * - Intake: when active and a piece is in mouth, acquire it (no force sim)
 * - Hopper: queue up to 3 pieces (FIFO)
 * - Shooter: when enabled and fire button pressed, remove one piece and fire it
 *
 * The game layer routes firing events through the scoring system.
 *
 * No roller force, no flywheel dynamics, no ballistic calculations.
 */

import { deriveIntake, intakeOf, type IntakeCommand, type IntakeSpec } from '../mechanism/intake.js';
import { deriveLauncher, launcherOf, type LauncherSpec } from '../mechanism/flywheel.js';
import {
  INTAKE_BUTTON,
  LAUNCH_BUTTON,
  OUTTAKE_BUTTON,
  SHOOTER_BUTTON,
} from './shooter.js';
import { inchesToMeters } from '../units/convert.js';
import { vec2, type Vec2 } from '../math/vec2.js';
import type { ControlInput } from '../control/controlInput.js';
import type { DerivedRobot } from '../robot/derive.js';

export interface MechanismSpecs {
  readonly intake: IntakeSpec | null;
  readonly launcher: LauncherSpec | null;
}

export interface MechanismState {
  intake: IntakeCommand;
  /** Piece ids in the hopper, oldest first. The next shot is `held[0]`. */
  held: string[];
  /** Tick the last piece was fired. */
  lastFireTick: number;
  /** Tick the last piece was ejected on outtake. */
  lastEjectTick: number;
  /** Fire button state last tick, for one-shot detection. */
  firePressed: boolean;
}

export function initialMechanismState(): MechanismState {
  return {
    intake: 'off',
    held: [],
    lastFireTick: Number.NEGATIVE_INFINITY,
    lastEjectTick: Number.NEGATIVE_INFINITY,
    firePressed: false,
  };
}

/**
 * Turn a derived robot into the specs its mechanisms run on.
 *
 * Done once when the world is built.
 */
export function deriveMechanismSpecs(robot: DerivedRobot): MechanismSpecs {
  const acquire = intakeOf(robot.mechanisms);
  const launch = launcherOf(robot.mechanisms);

  const intake = acquire === undefined ? null : deriveIntake(acquire.mechanism, acquire.capability);

  const launcher: LauncherSpec | null =
    launch === undefined
      ? null
      : deriveLauncher(launch.mechanism, launch.capability);

  return { intake, launcher };
}

export interface MechanismCommands {
  readonly intake: IntakeCommand;
  readonly shooterRunning: boolean;
  readonly firing: boolean;
}

/**
 * Read the driver's mechanism commands out of one control input.
 *
 * Intake and outtake are both held, outtake wins when both are pressed.
 */
export function readMechanismCommands(input: ControlInput): MechanismCommands {
  const outtake = input.buttons[OUTTAKE_BUTTON] === true;
  const intake = input.buttons[INTAKE_BUTTON] === true;

  return {
    intake: outtake ? 'outtake' : intake ? 'intake' : 'off',
    shooterRunning: input.buttons[SHOOTER_BUTTON] === true,
    firing: input.buttons[LAUNCH_BUTTON] === true,
  };
}

/**
 * May a piece be fired this tick?
 *
 * Fires on the rising edge of the fire button while shooter is enabled.
 * One press = one shot.
 */
export function feedAllows(state: MechanismState, commands: MechanismCommands): boolean {
  return commands.shooterRunning && commands.firing && !state.firePressed;
}
