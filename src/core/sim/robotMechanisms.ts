/**
 * Per-robot mechanism runtime — functionality-first model.
 *
 * Mechanisms are simple state machines:
 * - Intake: when active and a piece is in mouth, acquire it (no force sim),
 *   at most once every `1 / acquisitionRatePerSec`.
 * - Hopper: queue up to capacity pieces (FIFO).
 * - Shooter: holding fire fires at `shotsPerSecond`; a tap fires exactly one,
 *   because any real press spans many physics ticks.
 *
 * Once a piece leaves the shooter, it is an ordinary physically simulated game
 * piece (`sim/simWorld.ts`'s `launchPieceTowards`) — only the *mechanism* stays
 * a functional state machine. No roller force, no flywheel dynamics, no motor-
 * derived exit speed or RNG.
 */

import { deriveIntake, intakeOf, type IntakeCommand, type IntakeSpec } from '../mechanism/intake.js';
import { deriveLauncher, launcherOf, type LauncherSpec } from '../mechanism/flywheel.js';
import {
  INTAKE_BUTTON,
  LAUNCH_BUTTON,
  OUTTAKE_BUTTON,
} from './shooter.js';
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
  /** Tick the last piece was captured, so consecutive captures respect the rate. */
  lastCaptureTick: number;
  /** Fire button state last tick, kept for callers that care about edges. */
  firePressed: boolean;
}

export function initialMechanismState(): MechanismState {
  return {
    intake: 'off',
    held: [],
    lastFireTick: Number.NEGATIVE_INFINITY,
    lastEjectTick: Number.NEGATIVE_INFINITY,
    lastCaptureTick: Number.NEGATIVE_INFINITY,
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
    firing: input.buttons[LAUNCH_BUTTON] === true,
  };
}

/**
 * Ticks between successive shots at a given rate of fire.
 *
 * A rate of zero or less means "never fires again automatically" rather than
 * a division by zero or by a negative number; a misconfigured robot simply
 * cannot shoot, which is visible immediately rather than corrupting state.
 */
export function fireIntervalTicks(shotsPerSecond: number, tickRateHz: number): number {
  if (!(shotsPerSecond > 0)) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.round(tickRateHz / shotsPerSecond));
}

/**
 * May a piece be fired this tick?
 *
 * Holding the command fires at the launcher's configured rate; a tap still
 * fires exactly one, because the first tick a held command is seen is always
 * far enough past `lastFireTick` to pass. Releasing and re-pressing does not
 * reset the cadence — the interval is measured from the last shot, not from
 * when the button went down, which is what makes "hold to fire continuously"
 * and "tap for one" the same rule.
 */
export function feedAllows(
  state: MechanismState,
  commands: MechanismCommands,
  launcher: LauncherSpec | null,
  tick: number,
  tickRateHz: number,
): boolean {
  if (!commands.firing || launcher === null) return false;
  return tick - state.lastFireTick >= fireIntervalTicks(launcher.shotsPerSecond, tickRateHz);
}

/**
 * May a piece be captured this tick?
 *
 * The same cadence rule as firing, applied to consecutive intake captures:
 * a driver holding the intake over a cluster acquires them at the configured
 * `acquisitionRatePerSec` rather than all at once.
 */
export function captureAllows(
  state: MechanismState,
  intake: IntakeSpec,
  tick: number,
  tickRateHz: number,
): boolean {
  return tick - state.lastCaptureTick >= fireIntervalTicks(intake.acquisitionRatePerSec, tickRateHz);
}
