/**
 * Application shell.
 *
 * React owns the chrome: panels, forms, telemetry readouts. It does **not**
 * participate in the simulation loop — `SimRunner` drives the physics and the
 * canvas outside React entirely, and pushes telemetry here ten times a second.
 * The only React state that changes while driving is the telemetry sample and
 * the loop stats.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_ROBOT_CONFIG } from '../core/robot/robotConfig.js';
import type { TelemetrySample } from '../core/telemetry/sampler.js';
import { SimRunner, type RunnerStats } from './simRunner.js';
import { GamepadSource, InputHub, KeyboardSource, VirtualPadSource } from './input/sources.js';
import { DEFAULT_KEY_BINDINGS, type KeyBindings } from './input/bindings.js';
import { DEFAULT_RENDER_OPTIONS, type RenderOptions } from './render/fieldRenderer.js';
import { TelemetryPanel } from './components/TelemetryPanel.js';
import { VirtualGamepad } from './components/VirtualGamepad.js';
import { ControlsPanel } from './components/ControlsPanel.js';
import { RobotBuilder } from './components/RobotBuilder.js';
import { PresetPanel } from './components/PresetPanel.js';
import { PresetRepository } from '../storage/presets.js';
import { createStore } from '../storage/kvStore.js';
import type { RobotConfig } from '../core/robot/robotConfig.js';
import './styles/app.css';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [bindings, setBindings] = useState<KeyBindings>(DEFAULT_KEY_BINDINGS);
  const [robotConfig, setRobotConfig] = useState<RobotConfig>(DEFAULT_ROBOT_CONFIG);
  const [telemetry, setTelemetry] = useState<TelemetrySample | null>(null);
  const [stats, setStats] = useState<RunnerStats | null>(null);
  const [renderOptions, setRenderOptions] = useState<RenderOptions>(DEFAULT_RENDER_OPTIONS);
  const [gamepadConnected, setGamepadConnected] = useState(false);

  // Input sources and the runner are created once and live outside React's
  // render cycle; re-creating them per render would reset the simulation.
  const { runner, keyboard, gamepad, virtualPad } = useMemo(() => {
    const keyboardSource = new KeyboardSource(DEFAULT_KEY_BINDINGS);
    const gamepadSource = new GamepadSource();
    const virtualSource = new VirtualPadSource();
    const hub = new InputHub([virtualSource, gamepadSource, keyboardSource]);

    return {
      runner: new SimRunner(DEFAULT_ROBOT_CONFIG, hub),
      keyboard: keyboardSource,
      gamepad: gamepadSource,
      virtualPad: virtualSource,
    };
  }, []);

  // The repository is created once; recreating it per render would reopen the
  // database and drop the listing on every keystroke.
  const presets = useMemo(() => new PresetRepository(createStore('presets')), []);

  /**
   * Loading or applying a robot rebuilds the world. A robot's mass and geometry
   * cannot meaningfully change mid-drive, so the reset is the honest behaviour
   * rather than a limitation.
   */
  const applyRobot = useCallback(
    (config: RobotConfig) => {
      setRobotConfig(config);
      runner.reset(config);
    },
    [runner],
  );

  useEffect(() => {
    keyboard.setBindings(bindings);
  }, [keyboard, bindings]);

  useEffect(() => {
    runner.setRenderOptions(renderOptions);
  }, [runner, renderOptions]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    runner.attach(canvas);

    const detachKeyboard = keyboard.attach(window);
    const detachGamepad = gamepad.attach(window);
    const unsubscribeTelemetry = runner.onTelemetry(setTelemetry);
    const unsubscribeStats = runner.onStats((next) => {
      setStats(next);
      setGamepadConnected(gamepad.connected);
    });

    runner.start();

    return () => {
      runner.stop();
      detachKeyboard();
      detachGamepad();
      unsubscribeTelemetry();
      unsubscribeStats();
    };
  }, [runner, keyboard, gamepad]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>FTC Universal 2D Simulator</h1>
        <span className="phase-badge">Phase 2 — Robot Builder</span>
      </header>

      <main className="app-main">
        <div className="field-column">
          <div className="canvas-wrap">
            <canvas ref={canvasRef} className="field-canvas" />
          </div>

          <div className="field-toolbar">
            <button type="button" onClick={() => runner.reset(robotConfig)}>
              Reset robot
            </button>
            <label>
              <input
                type="checkbox"
                checked={renderOptions.showGrid}
                onChange={(event) =>
                  setRenderOptions({ ...renderOptions, showGrid: event.target.checked })
                }
              />
              Tile grid
            </label>
            <label>
              <input
                type="checkbox"
                checked={renderOptions.showVelocity}
                onChange={(event) =>
                  setRenderOptions({ ...renderOptions, showVelocity: event.target.checked })
                }
              />
              Velocity vector
            </label>
          </div>

          <p className="muted small field-note">
            12 ft × 12 ft field, drawn to scale. Origin at centre, +X right, +Y up, headings
            counter-clockwise.
          </p>
        </div>

        <aside className="side-column">
          <TelemetryPanel sample={telemetry} stats={stats} />
          <VirtualGamepad source={virtualPad} />
          <ControlsPanel
            bindings={bindings}
            onChange={setBindings}
            gamepadConnected={gamepadConnected}
          />
        </aside>

        <aside className="side-column">
          <RobotBuilder key={robotConfig.id} applied={robotConfig} onApply={applyRobot} />
          <PresetPanel repository={presets} current={robotConfig} onLoad={applyRobot} />
        </aside>
      </main>
    </div>
  );
}
