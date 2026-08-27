/**
 * Configurable keyboard bindings.
 *
 * PRODUCT_SPEC.md §15 requires controls to be configurable, so bindings are
 * data rather than hard-coded key checks. Actions are named by what they do to
 * the robot, not by which key produces them.
 */

export type DriveAction =
  | 'forward'
  | 'backward'
  | 'strafeLeft'
  | 'strafeRight'
  | 'turnLeft'
  | 'turnRight'
  | 'slow'
  | 'intake'
  | 'outtake'
  | 'launch';

export type KeyBindings = Readonly<Record<DriveAction, string>>;

export const ACTION_LABELS: Readonly<Record<DriveAction, string>> = {
  forward: 'Drive forward',
  backward: 'Drive backward',
  strafeLeft: 'Strafe left',
  strafeRight: 'Strafe right',
  turnLeft: 'Turn left (CCW)',
  turnRight: 'Turn right (CW)',
  slow: 'Precision (hold)',
  intake: 'Intake (hold)',
  outtake: 'Outtake (hold)',
  launch: 'Shoot',
};

export const DRIVE_ACTIONS: readonly DriveAction[] = [
  'forward',
  'backward',
  'strafeLeft',
  'strafeRight',
  'turnLeft',
  'turnRight',
  'slow',
  'intake',
  'outtake',
  'launch',
];

export const DEFAULT_KEY_BINDINGS: KeyBindings = Object.freeze({
  forward: 'KeyW',
  backward: 'KeyS',
  strafeLeft: 'KeyA',
  strafeRight: 'KeyD',
  turnLeft: 'KeyQ',
  turnRight: 'KeyE',
  slow: 'ShiftLeft',
  intake: 'KeyF',
  outtake: 'KeyR',
  launch: 'Space',
});

/**
 * Scale applied while the precision modifier is held.
 *
 * This is a UI convenience, not physics: it scales the *command*, exactly as a
 * driver easing off the stick would. It does not change any robot parameter.
 */
export const PRECISION_SCALE = 0.35;

/** Human-readable name for a `KeyboardEvent.code`. */
export function describeKey(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return `${code.slice(5)} Arrow`;
  switch (code) {
    case 'ShiftLeft':
      return 'Left Shift';
    case 'ShiftRight':
      return 'Right Shift';
    case 'Space':
      return 'Space';
    case 'ControlLeft':
      return 'Left Ctrl';
    default:
      return code;
  }
}
