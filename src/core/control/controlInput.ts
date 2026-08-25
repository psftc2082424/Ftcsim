/**
 * The single control abstraction.
 *
 * Keyboard, the on-screen virtual pad, a real controller through the browser
 * Gamepad API, and deterministic scripted traces all produce exactly this
 * struct. Nothing downstream can tell which one it came from, which is what lets
 * a test drive the robot through the same path a human does — and what will let
 * metric probes measure a robot in Phase 5 without a second control path.
 *
 * Axis conventions match the robot body frame: +x forward, +y left, +turn
 * counter-clockwise, each in [-1, 1].
 */

export interface DriveAxes {
  readonly x: number;
  readonly y: number;
  readonly turn: number;
}

export interface ControlInput {
  readonly drive: DriveAxes;
  /** Named digital inputs. Empty in Phase 1: no mechanisms exist to bind. */
  readonly buttons: Readonly<Record<string, boolean>>;
  /** Named analogue inputs beyond the drive axes. */
  readonly axes: Readonly<Record<string, number>>;
}

const EMPTY: Readonly<Record<string, never>> = Object.freeze({});

export const NEUTRAL_INPUT: ControlInput = Object.freeze({
  drive: Object.freeze({ x: 0, y: 0, turn: 0 }),
  buttons: EMPTY,
  axes: EMPTY,
});

function clampAxis(value: number): number {
  if (Number.isNaN(value)) return 0;
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

/**
 * Build an input with axes clamped into range.
 *
 * Clamping here rather than in the drivetrain means every source is normalised
 * at one boundary, and an out-of-range value from a misbehaving gamepad cannot
 * reach the physics.
 */
export function createControlInput(
  x: number,
  y: number,
  turn: number,
  buttons: Readonly<Record<string, boolean>> = EMPTY,
  axes: Readonly<Record<string, number>> = EMPTY,
): ControlInput {
  return {
    drive: { x: clampAxis(x), y: clampAxis(y), turn: clampAxis(turn) },
    buttons,
    axes,
  };
}

export function clampControlInput(input: ControlInput): ControlInput {
  return createControlInput(
    input.drive.x,
    input.drive.y,
    input.drive.turn,
    input.buttons,
    input.axes,
  );
}

/**
 * Radial deadzone on the translation stick, applied by input *sources*, never by
 * the physics.
 *
 * A radial deadzone is used rather than a per-axis one because per-axis
 * deadzones snap a stick held near an axis onto that axis, so a robot commanded
 * diagonally jumps to straight. Rescaling the remaining range keeps full travel
 * reachable. ASSUMPTIONS.md §6.1.
 */
export function applyRadialDeadzone(x: number, y: number, deadzone: number): DriveAxes {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadzone) return { x: 0, y: 0, turn: 0 };

  const scaled = (magnitude - deadzone) / (1 - deadzone);
  const factor = Math.min(scaled, 1) / magnitude;
  return { x: x * factor, y: y * factor, turn: 0 };
}

/** Scalar deadzone for a single axis such as the turn stick or a trigger. */
export function applyAxisDeadzone(value: number, deadzone: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  const scaled = (magnitude - deadzone) / (1 - deadzone);
  return Math.sign(value) * Math.min(scaled, 1);
}
