/**
 * Input sources.
 *
 * Three of them — keyboard, the browser Gamepad API, and the on-screen virtual
 * pad — each producing the same `ControlInput` the scripted controller produces.
 * Every source reports `null` when it is idle, which is what lets the hub pick a
 * source by who is actually driving rather than by a mode switch.
 *
 * All DOM handling lives here in `app/`. `core/` never sees an event.
 */

import {
  applyAxisDeadzone,
  applyRadialDeadzone,
  createControlInput,
  type ControlInput,
} from '../../core/control/controlInput.js';
import { PRECISION_SCALE, type KeyBindings } from './bindings.js';

export interface InputSource {
  readonly id: string;
  /** Current command, or `null` when this source is idle. */
  read(): ControlInput | null;
}

// --------------------------------------------------------------- keyboard ---

export class KeyboardSource implements InputSource {
  readonly id = 'keyboard';
  private readonly pressed = new Set<string>();
  private bindings: KeyBindings;

  constructor(bindings: KeyBindings) {
    this.bindings = bindings;
  }

  setBindings(bindings: KeyBindings): void {
    this.bindings = bindings;
    // Bindings changed under a held key; drop state rather than latch a stale
    // action on forever.
    this.pressed.clear();
  }

  attach(target: Window): () => void {
    const onDown = (event: KeyboardEvent): void => {
      // Never swallow keys while the user is typing into a field.
      if (isTextEntry(event.target)) return;
      this.pressed.add(event.code);
      if (this.isBound(event.code)) event.preventDefault();
    };
    const onUp = (event: KeyboardEvent): void => {
      this.pressed.delete(event.code);
    };
    // Losing focus mid-press would otherwise leave the robot driving forever.
    const onBlur = (): void => this.pressed.clear();

    target.addEventListener('keydown', onDown);
    target.addEventListener('keyup', onUp);
    target.addEventListener('blur', onBlur);

    return () => {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', onBlur);
      this.pressed.clear();
    };
  }

  private isBound(code: string): boolean {
    return Object.values(this.bindings).includes(code);
  }

  read(): ControlInput | null {
    const held = (code: string): number => (this.pressed.has(code) ? 1 : 0);

    const x = held(this.bindings.forward) - held(this.bindings.backward);
    const y = held(this.bindings.strafeLeft) - held(this.bindings.strafeRight);
    const turn = held(this.bindings.turnLeft) - held(this.bindings.turnRight);

    const buttons: Record<string, boolean> = {};
    for (const action of ['intake', 'outtake', 'launch'] as const) {
      if (this.pressed.has(this.bindings[action])) buttons[action] = true;
    }
    if (x === 0 && y === 0 && turn === 0 && Object.keys(buttons).length === 0) return null;

    // Diagonal keyboard input would otherwise command sqrt(2) on the stick.
    const magnitude = Math.hypot(x, y);
    const normaliser = magnitude > 1 ? 1 / magnitude : 1;
    const scale = this.pressed.has(this.bindings.slow) ? PRECISION_SCALE : 1;

    return createControlInput(x * normaliser * scale, y * normaliser * scale, turn * scale, buttons);
  }
}

/**
 * Duck-typed rather than `instanceof HTMLElement`, so the module stays usable
 * (and testable) outside a DOM, where that global does not exist at all.
 */
function isTextEntry(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false;
  const element = target as Partial<HTMLElement>;
  if (element.isContentEditable === true) return true;
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
}

// --------------------------------------------------------------- gamepad ---

/** Deadzone for physical sticks. ASSUMPTIONS.md §6.1. */
export const GAMEPAD_DEADZONE = 0.12;

/**
 * Real controller support through the browser Gamepad API.
 *
 * Standard mapping: axes 0/1 are the left stick, 2/3 the right. A gamepad's
 * +Y is *down*, and buttons 6/7 are the analogue triggers.
 */
export class GamepadSource implements InputSource {
  readonly id = 'gamepad';

  private connectedIndex: number | null = null;

  attach(target: Window): () => void {
    const onConnect = (event: GamepadEvent): void => {
      this.connectedIndex = event.gamepad.index;
    };
    const onDisconnect = (event: GamepadEvent): void => {
      if (this.connectedIndex === event.gamepad.index) this.connectedIndex = null;
    };

    target.addEventListener('gamepadconnected', onConnect as EventListener);
    target.addEventListener('gamepaddisconnected', onDisconnect as EventListener);

    return () => {
      target.removeEventListener('gamepadconnected', onConnect as EventListener);
      target.removeEventListener('gamepaddisconnected', onDisconnect as EventListener);
    };
  }

  get connected(): boolean {
    return this.activePad() !== null;
  }

  private activePad(): Gamepad | null {
    if (typeof navigator === 'undefined' || navigator.getGamepads === undefined) return null;
    const pads = navigator.getGamepads();
    if (this.connectedIndex !== null) {
      const pad = pads[this.connectedIndex];
      if (pad !== null && pad !== undefined) return pad;
    }
    // The connected pad may have been replaced; fall back to the first live one.
    for (const pad of pads) {
      if (pad !== null && pad !== undefined) return pad;
    }
    return null;
  }

  read(): ControlInput | null {
    const pad = this.activePad();
    if (pad === null) return null;

    const leftX = pad.axes[0] ?? 0;
    const leftY = pad.axes[1] ?? 0;
    const rightX = pad.axes[2] ?? 0;

    // Gamepad +Y is down; robot +x is forward and +y is left, so both invert.
    const translation = applyRadialDeadzone(-leftY, -leftX, GAMEPAD_DEADZONE);
    const turn = applyAxisDeadzone(-rightX, GAMEPAD_DEADZONE);

    const buttons: Record<string, boolean> = {};
    const mapping: Readonly<Record<number, string>> = {
      0: 'launch', 4: 'outtake', 6: 'intake',
    };
    pad.buttons.forEach((button, index) => {
      const action = mapping[index];
      if (button.pressed && action !== undefined) buttons[action] = true;
    });

    if (translation.x === 0 && translation.y === 0 && turn === 0 && Object.keys(buttons).length === 0) return null;
    return createControlInput(translation.x, translation.y, turn, buttons);
  }
}

// ----------------------------------------------------------- virtual pad ---

/**
 * On-screen PS5-style pad.
 *
 * The React component writes stick and button state here; this class holds no
 * DOM references of its own so the same state can be read by the simulation
 * loop without touching React.
 */
export class VirtualPadSource implements InputSource {
  readonly id = 'virtual';

  private leftX = 0;
  private leftY = 0;
  private rightX = 0;
  private readonly pressed = new Set<string>();

  /** Stick values in [-1, 1], already in robot axes: +x forward, +y left. */
  setLeftStick(forward: number, left: number): void {
    this.leftX = clamp(forward);
    this.leftY = clamp(left);
  }

  setRightStick(turn: number): void {
    this.rightX = clamp(turn);
  }

  setButton(name: string, down: boolean): void {
    if (down) this.pressed.add(name);
    else this.pressed.delete(name);
  }

  releaseAll(): void {
    this.leftX = 0;
    this.leftY = 0;
    this.rightX = 0;
    this.pressed.clear();
  }

  get activeButtons(): readonly string[] {
    return [...this.pressed].sort();
  }

  read(): ControlInput | null {
    if (this.leftX === 0 && this.leftY === 0 && this.rightX === 0 && this.pressed.size === 0) {
      return null;
    }

    const buttons: Record<string, boolean> = {};
    for (const name of this.pressed) buttons[name] = true;

    return createControlInput(this.leftX, this.leftY, this.rightX, buttons);
  }
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

// ----------------------------------------------------------------- hub ---

/**
 * Merges the sources by priority: whoever is actively driving wins.
 *
 * Priority rather than summation, because two sources adding together would let
 * a resting gamepad stick fight the keyboard. The order puts direct manipulation
 * first.
 */
export class InputHub {
  constructor(private readonly sources: readonly InputSource[]) {}

  read(): ControlInput | null {
    for (const source of this.sources) {
      const input = source.read();
      if (input !== null) return input;
    }
    return null;
  }

  /** Id of the source currently in control, or `null` when everything is idle. */
  activeSource(): string | null {
    for (const source of this.sources) {
      if (source.read() !== null) return source.id;
    }
    return null;
  }
}
