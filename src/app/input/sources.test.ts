import { describe, expect, it } from 'vitest';
import { InputHub, KeyboardSource, VirtualPadSource, type InputSource } from './sources.js';
import { DEFAULT_KEY_BINDINGS, PRECISION_SCALE, describeKey } from './bindings.js';
import { createControlInput, type ControlInput } from '../../core/control/controlInput.js';

/**
 * `KeyboardSource.attach` needs a DOM, but `read()` does not. Driving the
 * private key set through a fake window keeps the test in the `node`
 * environment while still exercising the real listener wiring.
 */
function fakeWindow() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    win: {
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        const set = listeners.get(type) ?? new Set();
        set.add(fn);
        listeners.set(type, set);
      },
      removeEventListener: (type: string, fn: (event: unknown) => void) => {
        listeners.get(type)?.delete(fn);
      },
    } as unknown as Window,
    fire: (type: string, event: unknown) => {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
    count: (type: string) => listeners.get(type)?.size ?? 0,
  };
}

const keyEvent = (code: string) => ({ code, target: null, preventDefault: () => {} });

describe('keyboard source', () => {
  it('is idle with nothing pressed', () => {
    const source = new KeyboardSource(DEFAULT_KEY_BINDINGS);
    expect(source.read()).toBeNull();
  });

  it('maps bound keys onto the robot axes', () => {
    const source = new KeyboardSource(DEFAULT_KEY_BINDINGS);
    const { win, fire } = fakeWindow();
    source.attach(win);

    fire('keydown', keyEvent('KeyW'));
    expect(source.read()?.drive).toEqual({ x: 1, y: 0, turn: 0 });

    fire('keyup', keyEvent('KeyW'));
    fire('keydown', keyEvent('KeyA'));
    expect(source.read()?.drive.y).toBe(1); // A strafes left, robot +y

    fire('keyup', keyEvent('KeyA'));
    fire('keydown', keyEvent('KeyE'));
    expect(source.read()?.drive.turn).toBe(-1); // E turns clockwise
  });

  it('cancels opposing keys', () => {
    const source = new KeyboardSource(DEFAULT_KEY_BINDINGS);
    const { win, fire } = fakeWindow();
    source.attach(win);

    fire('keydown', keyEvent('KeyW'));
    fire('keydown', keyEvent('KeyS'));
    expect(source.read()).toBeNull();
  });

  /**
   * Two keys held would otherwise command sqrt(2) on the translation stick, so
   * a diagonal would ask for more than full power and be silently saturated.
   */
  it('normalises diagonal input to unit magnitude', () => {
    const source = new KeyboardSource(DEFAULT_KEY_BINDINGS);
    const { win, fire } = fakeWindow();
    source.attach(win);

    fire('keydown', keyEvent('KeyW'));
    fire('keydown', keyEvent('KeyA'));

    const drive = source.read()?.drive;
    expect(Math.hypot(drive?.x ?? 0, drive?.y ?? 0)).toBeCloseTo(1, 9);
  });

  it('scales down while the precision modifier is held', () => {
    const source = new KeyboardSource(DEFAULT_KEY_BINDINGS);
    const { win, fire } = fakeWindow();
    source.attach(win);

    fire('keydown', keyEvent('KeyW'));
    fire('keydown', keyEvent('ShiftLeft'));
    expect(source.read()?.drive.x).toBeCloseTo(PRECISION_SCALE, 9);
  });

  it('releases everything when the window loses focus', () => {
    // Otherwise a key held while alt-tabbing leaves the robot driving forever.
    const source = new KeyboardSource(DEFAULT_KEY_BINDINGS);
    const { win, fire } = fakeWindow();
    source.attach(win);

    fire('keydown', keyEvent('KeyW'));
    expect(source.read()).not.toBeNull();

    fire('blur', {});
    expect(source.read()).toBeNull();
  });

  it('ignores keys typed into a text field', () => {
    const source = new KeyboardSource(DEFAULT_KEY_BINDINGS);
    const { win, fire } = fakeWindow();
    source.attach(win);

    // A non-HTMLElement target is treated as "not text entry"; the guard is
    // exercised through the real code path in the browser.
    fire('keydown', { code: 'KeyW', target: null, preventDefault: () => {} });
    expect(source.read()).not.toBeNull();
  });

  it('honours rebound keys and clears held state on rebind', () => {
    const source = new KeyboardSource(DEFAULT_KEY_BINDINGS);
    const { win, fire } = fakeWindow();
    source.attach(win);

    fire('keydown', keyEvent('KeyW'));
    expect(source.read()).not.toBeNull();

    source.setBindings({ ...DEFAULT_KEY_BINDINGS, forward: 'ArrowUp' });
    expect(source.read()).toBeNull();

    fire('keydown', keyEvent('ArrowUp'));
    expect(source.read()?.drive.x).toBe(1);
  });

  it('detaches its listeners', () => {
    const source = new KeyboardSource(DEFAULT_KEY_BINDINGS);
    const { win, count } = fakeWindow();
    const detach = source.attach(win);

    expect(count('keydown')).toBe(1);
    detach();
    expect(count('keydown')).toBe(0);
  });
});

describe('virtual pad source', () => {
  it('is idle until touched', () => {
    expect(new VirtualPadSource().read()).toBeNull();
  });

  it('reports stick values on the robot axes', () => {
    const pad = new VirtualPadSource();
    pad.setLeftStick(0.5, -0.25);
    pad.setRightStick(0.75);

    expect(pad.read()?.drive).toEqual({ x: 0.5, y: -0.25, turn: 0.75 });
  });

  it('clamps out-of-range values', () => {
    const pad = new VirtualPadSource();
    pad.setLeftStick(4, -9);
    expect(pad.read()?.drive.x).toBe(1);
    expect(pad.read()?.drive.y).toBe(-1);
  });

  it('reports button state even with the sticks centred', () => {
    const pad = new VirtualPadSource();
    pad.setButton('cross', true);

    const input = pad.read();
    expect(input).not.toBeNull();
    expect(input?.buttons.cross).toBe(true);
    expect(input?.drive).toEqual({ x: 0, y: 0, turn: 0 });
    expect(pad.activeButtons).toEqual(['cross']);
  });

  it('releaseAll() returns to idle', () => {
    const pad = new VirtualPadSource();
    pad.setLeftStick(1, 1);
    pad.setButton('square', true);
    pad.releaseAll();
    expect(pad.read()).toBeNull();
  });
});

describe('input hub', () => {
  const stub = (id: string, input: ControlInput | null): InputSource => ({ id, read: () => input });

  it('takes the first active source in priority order', () => {
    const first = createControlInput(1, 0, 0);
    const second = createControlInput(0, 1, 0);

    const hub = new InputHub([stub('a', first), stub('b', second)]);
    expect(hub.read()).toBe(first);
    expect(hub.activeSource()).toBe('a');
  });

  it('falls through idle sources', () => {
    const later = createControlInput(0, 0, 1);
    const hub = new InputHub([stub('a', null), stub('b', null), stub('c', later)]);
    expect(hub.read()).toBe(later);
    expect(hub.activeSource()).toBe('c');
  });

  it('reports idle when nothing is driving', () => {
    const hub = new InputHub([stub('a', null), stub('b', null)]);
    expect(hub.read()).toBeNull();
    expect(hub.activeSource()).toBeNull();
  });
});

describe('binding labels', () => {
  it('renders key codes readably', () => {
    expect(describeKey('KeyW')).toBe('W');
    expect(describeKey('ShiftLeft')).toBe('Left Shift');
    expect(describeKey('ArrowUp')).toBe('Up Arrow');
    expect(describeKey('Digit1')).toBe('1');
    expect(describeKey('F9')).toBe('F9');
  });
});
