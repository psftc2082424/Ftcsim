/**
 * Per-robot mechanism runtime — step 3 of the tick, `mechanisms.update`.
 *
 * The canonical tick order (ARCHITECTURE.md §9) has always had a slot here, and
 * until now it was empty because mechanisms had nothing to act on. This is what
 * fills it: the state a robot's intake and shooter carry between ticks, and the
 * derivation from a `RobotConfig` that produces the physical specs they run on.
 *
 * Nothing in this file is season-specific and nothing branches on a mechanism's
 * `preset` label. A robot has an intake because it carries an `acquire`
 * capability, and a shooter because it carries a `launch` one (ARCHITECTURE.md
 * §7).
 *
 * ── What the driver controls ───────────────────────────────────────────────
 *
 * Four named buttons and one axis, all of them ordinary `ControlInput` entries
 * that any source can produce — keyboard, gamepad, the on-screen pad or a
 * scripted trace. The simulation cannot tell which one it came from, which is
 * what lets a test drive a shot the same way a person does.
 */

import { deriveFlywheel, launcherOf, IDLE_FLYWHEEL, type FlywheelSpec, type FlywheelState } from '../mechanism/flywheel.js';
import { deriveIntake, intakeOf, type IntakeCommand, type IntakeSpec } from '../mechanism/intake.js';
import {
  INTAKE_BUTTON,
  LAUNCH_BUTTON,
  OUTTAKE_BUTTON,
  SHOOTER_BUTTON,
  SHOOTER_SPEED_AXIS,
} from './shooter.js';
import { inchesToMeters } from '../units/convert.js';
import { vec2, type Vec2 } from '../math/vec2.js';
import type { ControlInput } from '../control/controlInput.js';
import type { LaunchCapability } from '../mechanism/capability.js';
import type { DerivedRobot } from '../robot/derive.js';

/** A shooter's physical spec plus where on the robot it points from. */
export interface LauncherSpec {
  readonly flywheel: FlywheelSpec;
  readonly capability: LaunchCapability;
  /** Muzzle position in the body frame, metres. */
  readonly mountM: Vec2;
  /** Muzzle facing relative to robot-forward, radians. */
  readonly facingRad: number;
}

export interface MechanismSpecs {
  readonly intake: IntakeSpec | null;
  readonly launcher: LauncherSpec | null;
  /**
   * Pieces the feeder can deliver to the shooter each second, or `null` when the
   * robot has nothing that feeds.
   *
   * The intake is the indexer: `throughputPerSec` is already "one piece per
   * revolution of the mechanism's output" (`mechanism/mechanism.ts`,
   * ASSUMPTIONS.md §9.1), which is exactly a feed cadence. So gearing an intake
   * for grip costs shots per second, and a robot with no intake fires one piece
   * per press because nothing is cycling a magazine for it.
   */
  readonly feedPerSec: number | null;
}

export interface MechanismState {
  flywheel: FlywheelState;
  intake: IntakeCommand;
  /** Piece ids in the hopper, oldest first. The next shot is `held[0]`. */
  held: string[];
  /** Tick the last piece left, so the feed cadence can be honoured. */
  lastFireTick: number;
  /** Tick the last piece was spat back out, on the same cadence. */
  lastEjectTick: number;
  /** Fire button state last tick, for one-shot robots with no feeder. */
  firePressed: boolean;
  /** Target speed trim from the analogue axis, 0-1. */
  speedScale: number;
}

export function initialMechanismState(): MechanismState {
  return {
    flywheel: IDLE_FLYWHEEL,
    intake: 'off',
    held: [],
    lastFireTick: Number.NEGATIVE_INFINITY,
    lastEjectTick: Number.NEGATIVE_INFINITY,
    firePressed: false,
    speedScale: 1,
  };
}

/**
 * Turn a derived robot into the specs its mechanisms run on.
 *
 * Done once when the world is built. A robot with neither capability gets two
 * nulls and costs nothing per tick.
 */
export function deriveMechanismSpecs(robot: DerivedRobot): MechanismSpecs {
  const acquire = intakeOf(robot.mechanisms);
  const launch = launcherOf(robot.mechanisms);

  const intake = acquire === undefined ? null : deriveIntake(acquire.mechanism, acquire.capability);

  const launcher: LauncherSpec | null =
    launch === undefined
      ? null
      : {
          flywheel: deriveFlywheel(launch.mechanism, launch.capability),
          capability: launch.capability,
          mountM: vec2(
            inchesToMeters(launch.mechanism.config.mount.xIn),
            inchesToMeters(launch.mechanism.config.mount.yIn),
          ),
          facingRad: (launch.mechanism.config.mount.facingDeg * Math.PI) / 180,
        };

  return {
    intake,
    launcher,
    feedPerSec: acquire?.mechanism.throughputPerSec ?? null,
  };
}

export interface MechanismCommands {
  readonly intake: IntakeCommand;
  readonly shooterRunning: boolean;
  readonly firing: boolean;
  /** Fraction of the configured target speed the driver is asking for. */
  readonly speedScale: number;
}

/**
 * Read the driver's mechanism commands out of one control input.
 *
 * Intake and outtake are both held rather than toggled, and outtake wins when
 * both are down — a driver mashing both wants the jam cleared. Whether a
 * physical button holds or toggles is a *binding* question and lives in the app
 * layer, so the core only ever sees "is it down now".
 */
export function readMechanismCommands(input: ControlInput): MechanismCommands {
  const outtake = input.buttons[OUTTAKE_BUTTON] === true;
  const intake = input.buttons[INTAKE_BUTTON] === true;

  const axis = input.axes[SHOOTER_SPEED_AXIS];

  return {
    intake: outtake ? 'outtake' : intake ? 'intake' : 'off',
    shooterRunning: input.buttons[SHOOTER_BUTTON] === true,
    firing: input.buttons[LAUNCH_BUTTON] === true,
    speedScale: axis === undefined ? 1 : clamp01(axis),
  };
}

/**
 * May a piece leave this tick?
 *
 * A robot with a feeder fires on cadence while the button is held: the magazine
 * cycles at the intake's throughput and each piece leaves at whatever speed the
 * wheel has recovered to by then. A robot with no feeder fires on the press,
 * once, because nothing is cycling for it.
 *
 * Note what is *not* here: there is no minimum flywheel speed. Firing into a
 * wheel that has not spun up throws the piece a short distance and drops it,
 * which is the behaviour a driver has to learn rather than one the simulator
 * should forbid.
 */
export function feedAllows(
  specs: MechanismSpecs,
  state: MechanismState,
  commands: MechanismCommands,
  tick: number,
  dtSec: number,
): boolean {
  if (!commands.firing) return false;

  const feedPerSec = specs.feedPerSec;
  if (feedPerSec === null || feedPerSec <= 0) return !state.firePressed;

  const intervalTicks = 1 / (feedPerSec * dtSec);
  return tick - state.lastFireTick >= intervalTicks;
}

/** Target speed after the driver's trim, rad/s. */
export function trimmedTarget(spec: FlywheelSpec, speedScale: number): FlywheelSpec {
  if (speedScale >= 1) return spec;
  return { ...spec, targetRadPerSec: spec.targetRadPerSec * clamp01(speedScale) };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
