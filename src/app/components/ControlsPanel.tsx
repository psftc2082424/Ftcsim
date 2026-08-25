/**
 * Keyboard binding editor (PRODUCT_SPEC.md §15: "controls must be
 * configurable").
 *
 * Click an action, press a key, done. Bindings are plain data, so the same
 * structure will serialise into a preset once storage lands in Phase 2.
 */

import { useEffect, useState } from 'react';
import {
  ACTION_LABELS,
  DRIVE_ACTIONS,
  DEFAULT_KEY_BINDINGS,
  describeKey,
  type DriveAction,
  type KeyBindings,
} from '../input/bindings.js';

interface Props {
  readonly bindings: KeyBindings;
  readonly onChange: (bindings: KeyBindings) => void;
  readonly gamepadConnected: boolean;
}

export function ControlsPanel({ bindings, onChange, gamepadConnected }: Props) {
  const [capturing, setCapturing] = useState<DriveAction | null>(null);

  useEffect(() => {
    if (capturing === null) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();

      if (event.code === 'Escape') {
        setCapturing(null);
        return;
      }

      // Rebinding a key that is already in use would leave two actions on one
      // key; clear the old owner instead of silently duplicating.
      const next: Record<DriveAction, string> = { ...bindings };
      for (const action of DRIVE_ACTIONS) {
        if (next[action] === event.code) next[action] = '';
      }
      next[capturing] = event.code;

      onChange(next);
      setCapturing(null);
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [capturing, bindings, onChange]);

  return (
    <section className="panel">
      <h2>Controls</h2>

      <p className="muted small">
        Keyboard, this page&rsquo;s virtual pad, and a real controller through the browser Gamepad
        API all feed the same input path. Whichever you touch last takes over.
      </p>

      <div className="binding-list">
        {DRIVE_ACTIONS.map((action) => (
          <div key={action} className="binding-row">
            <span className="binding-label">{ACTION_LABELS[action]}</span>
            <button
              type="button"
              className={`binding-key ${capturing === action ? 'is-capturing' : ''}`}
              onClick={() => setCapturing(capturing === action ? null : action)}
            >
              {capturing === action
                ? 'Press a key…'
                : bindings[action] === ''
                  ? 'Unbound'
                  : describeKey(bindings[action])}
            </button>
          </div>
        ))}
      </div>

      <div className="row-actions">
        <button type="button" className="secondary" onClick={() => onChange(DEFAULT_KEY_BINDINGS)}>
          Reset to defaults
        </button>
      </div>

      <div className="status-line">
        <span className={gamepadConnected ? 'dot dot-on' : 'dot'} />
        {gamepadConnected ? 'Gamepad connected' : 'No gamepad detected'}
      </div>
    </section>
  );
}
