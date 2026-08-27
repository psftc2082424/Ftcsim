/**
 * On-screen PS5-style controller (PRODUCT_SPEC.md §15).
 *
 * The two sticks drive the robot. The face, shoulder, trigger and d-pad
 * controls report the same named mechanism actions as keyboard and Gamepad API.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VirtualPadSource } from '../input/sources.js';

interface Props {
  readonly source: VirtualPadSource;
}

const STICK_RADIUS = 46;
const KNOB_RADIUS = 20;

interface StickState {
  readonly x: number;
  readonly y: number;
}

const CENTER: StickState = { x: 0, y: 0 };

function Stick({
  label,
  axisLabel,
  vertical,
  onChange,
}: {
  label: string;
  axisLabel: string;
  vertical: boolean;
  onChange: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<StickState>(CENTER);
  const pointerId = useRef<number | null>(null);

  const update = useCallback(
    (clientX: number, clientY: number) => {
      const element = ref.current;
      if (element === null) return;

      const rect = element.getBoundingClientRect();
      const dx = clientX - (rect.left + rect.width / 2);
      const dy = clientY - (rect.top + rect.height / 2);

      const distance = Math.hypot(dx, dy);
      const limit = STICK_RADIUS - KNOB_RADIUS / 2;
      const scale = distance > limit ? limit / distance : 1;

      const nx = (dx * scale) / limit;
      const ny = (dy * scale) / limit;

      setKnob({ x: nx * limit, y: vertical ? ny * limit : 0 });
      // Screen down is +y; the robot's forward is -screenY and left is -screenX.
      onChange(vertical ? -ny : 0, -nx);
    },
    [onChange, vertical],
  );

  const release = useCallback(() => {
    pointerId.current = null;
    setKnob(CENTER);
    onChange(0, 0);
  }, [onChange]);

  return (
    <div className="pad-stick-group">
      <div
        ref={ref}
        className="pad-stick"
        role="slider"
        aria-label={label}
        aria-valuetext={axisLabel}
        aria-valuenow={0}
        aria-valuemin={-1}
        aria-valuemax={1}
        tabIndex={0}
        onPointerDown={(event) => {
          pointerId.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          update(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (pointerId.current !== event.pointerId) return;
          update(event.clientX, event.clientY);
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <div className="pad-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>
      <span className="pad-caption">{label}</span>
    </div>
  );
}

function PadButton({
  name,
  label,
  className,
  source,
}: {
  name: string;
  label: string;
  className: string;
  source: VirtualPadSource;
}) {
  const [down, setDown] = useState(false);

  const press = (isDown: boolean): void => {
    setDown(isDown);
    source.setButton(name, isDown);
  };

  return (
    <button
      type="button"
      className={`pad-button ${className} ${down ? 'is-down' : ''}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        press(true);
      }}
      onPointerUp={() => press(false)}
      onPointerCancel={() => press(false)}
      onPointerLeave={() => down && press(false)}
    >
      {label}
    </button>
  );
}

export function VirtualGamepad({ source }: Props) {
  const setLeft = useCallback(
    (forward: number, left: number) => source.setLeftStick(forward, left),
    [source],
  );
  const setRight = useCallback((_: number, left: number) => source.setRightStick(left), [source]);

  // A pointer released outside the window would otherwise latch a stick on.
  useEffect(() => () => source.releaseAll(), [source]);

  return (
    <section className="panel">
      <h2>Virtual Controller</h2>

      <div className="pad-shoulders">
        <PadButton name="intake" label="INTAKE" className="pad-trigger" source={source} />
        <PadButton name="outtake" label="OUT" className="pad-bumper" source={source} />
      </div>

      <div className="pad-main">
        <div className="pad-dpad">
          <PadButton name="dpadUp" label="▲" className="pad-dpad-up" source={source} />
          <PadButton name="dpadLeft" label="◀" className="pad-dpad-left" source={source} />
          <PadButton name="dpadRight" label="▶" className="pad-dpad-right" source={source} />
          <PadButton name="dpadDown" label="▼" className="pad-dpad-down" source={source} />
        </div>

        <div className="pad-face">
          <PadButton name="triangle" label="△" className="pad-face-up" source={source} />
          <PadButton name="square" label="□" className="pad-face-left" source={source} />
          <PadButton name="circle" label="○" className="pad-face-right" source={source} />
          <PadButton name="launch" label="FIRE" className="pad-face-down" source={source} />
        </div>
      </div>

      <div className="pad-sticks">
        <Stick label="Left stick — drive / strafe" axisLabel="translation" vertical onChange={setLeft} />
        <Stick label="Right stick — turn" axisLabel="rotation" vertical={false} onChange={setRight} />
      </div>

      <p className="muted small">
        Hold INTAKE to collect, then press FIRE once for each stored artifact.
      </p>
    </section>
  );
}
