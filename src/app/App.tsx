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
import { COMPETITION_ROBOT_CONFIG } from '../core/robot/robotConfig.js';
import { DECODE_GAME } from '../core/game/fixtures/decodeGame.js';
import { stageDecodePieces } from '../core/game/fixtures/decodeStaging.js';
import { createDecodeField } from '../core/game/fixtures/decodeCollision.js';
import { inchesToMeters } from '../core/units/convert.js';
import { vec2 } from '../core/math/vec2.js';
import type { TelemetrySample } from '../core/telemetry/sampler.js';
import type { MatchStatus } from './simRunner.js';
import { SimRunner, type RunnerStats } from './simRunner.js';
import { GamepadSource, InputHub, KeyboardSource, VirtualPadSource } from './input/sources.js';
import { DEFAULT_KEY_BINDINGS, type KeyBindings } from './input/bindings.js';
import { loadKeyBindings, saveKeyBindings } from './input/bindingPreferences.js';
import { DEFAULT_DRIVE_MODE, type DriveMode } from './input/driveMode.js';
import { loadDriveMode, saveDriveMode } from './input/driveModePreferences.js';
import { DEFAULT_RENDER_OPTIONS, type RenderOptions } from './render/fieldRenderer.js';
import { TelemetryPanel } from './components/TelemetryPanel.js';
import { MatchPanel } from './components/MatchPanel.js';
import { VirtualGamepad } from './components/VirtualGamepad.js';
import { ControlsPanel } from './components/ControlsPanel.js';
import { MechanismPanel } from './components/MechanismPanel.js';
import { RobotBuilder } from './components/RobotBuilder.js';
import { PresetPanel } from './components/PresetPanel.js';
import { PresetRepository } from '../storage/presets.js';
import { createStore } from '../storage/kvStore.js';
import type { RobotConfig } from '../core/robot/robotConfig.js';
import './styles/app.css';

/**
 * Where a DECODE robot legally starts (G304, p.102): over a LAUNCH LINE,
 * touching the FIELD perimeter, and fully on its own side. The GOAL-side LAUNCH
 * ZONE's base is the whole GOAL-side wall, so this puts an 18 in robot against
 * that wall inside red's half.
 */
const LEGAL_START_POSES = {
  red: { p: vec2(inchesToMeters(-30), inchesToMeters(63)), theta: 0 },
  blue: { p: vec2(inchesToMeters(30), inchesToMeters(63)), theta: 0 },
} as const;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [bindings, setBindings] = useState<KeyBindings>(DEFAULT_KEY_BINDINGS);
  const [bindingsReady, setBindingsReady] = useState(false);
  const [driveMode, setDriveMode] = useState<DriveMode>(DEFAULT_DRIVE_MODE);
  const [driveModeReady, setDriveModeReady] = useState(false);
  const [robotConfig, setRobotConfig] = useState<RobotConfig>(COMPETITION_ROBOT_CONFIG);
  const [view, setView] = useState<'play' | 'configure' | 'controls'>('play');
  const [showDebug, setShowDebug] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetrySample | null>(null);
  const [stats, setStats] = useState<RunnerStats | null>(null);
  const [match, setMatch] = useState<MatchStatus | null>(null);
  const [renderOptions, setRenderOptions] = useState<RenderOptions>(DEFAULT_RENDER_OPTIONS);
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [driverAlliance, setDriverAlliance] = useState<'red' | 'blue'>('red');

  // Input sources and the runner are created once and live outside React's
  // render cycle; re-creating them per render would reset the simulation.
  const { runner, keyboard, gamepad, virtualPad } = useMemo(() => {
    const keyboardSource = new KeyboardSource(DEFAULT_KEY_BINDINGS);
    const gamepadSource = new GamepadSource();
    const virtualSource = new VirtualPadSource();
    const hub = new InputHub([virtualSource, gamepadSource, keyboardSource]);

    return {
      runner: new SimRunner(
        COMPETITION_ROBOT_CONFIG,
        hub,
        DECODE_GAME,
        LEGAL_START_POSES.red,
        stageDecodePieces(),
        1,
        createDecodeField(),
      ),
      keyboard: keyboardSource,
      gamepad: gamepadSource,
      virtualPad: virtualSource,
    };
  }, []);

  // The repository is created once; recreating it per render would reopen the
  // database and drop the listing on every keystroke.
  const presets = useMemo(() => new PresetRepository(createStore('presets')), []);
  const bindingStore = useMemo(() => createStore('settings'), []);

  useEffect(() => {
    let current = true;
    void loadKeyBindings(bindingStore).then((saved) => {
      if (!current) return;
      setBindings(saved);
      setBindingsReady(true);
    });
    return () => {
      current = false;
    };
  }, [bindingStore]);

  useEffect(() => {
    let current = true;
    void loadDriveMode(bindingStore).then((saved) => {
      if (!current) return;
      setDriveMode(saved);
      setDriveModeReady(true);
    });
    return () => {
      current = false;
    };
  }, [bindingStore]);

  useEffect(() => {
    if (!bindingsReady) return;
    void saveKeyBindings(bindingStore, bindings);
  }, [bindingStore, bindings, bindingsReady]);

  useEffect(() => {
    if (!driveModeReady) return;
    void saveDriveMode(bindingStore, driveMode);
  }, [bindingStore, driveMode, driveModeReady]);

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

  const selectAlliance = useCallback(
    (alliance: 'red' | 'blue') => {
      setDriverAlliance(alliance);
      runner.setAlliance(alliance, LEGAL_START_POSES[alliance]);
    },
    [runner],
  );

  useEffect(() => {
    keyboard.setBindings(bindings);
  }, [keyboard, bindings]);

  useEffect(() => {
    runner.setDriveMode(driveMode);
  }, [runner, driveMode]);

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
    const unsubscribeMatch = runner.onMatch(setMatch);
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
      unsubscribeMatch();
      unsubscribeStats();
    };
  }, [runner, keyboard, gamepad]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand"><span className="brand-mark">FTC</span><h1>Simulator</h1><span>DECODE 2025–26</span></div>
        <nav className="app-nav" aria-label="Main navigation">
          <button type="button" className={view === 'play' ? 'is-selected' : ''} onClick={() => setView('play')}>Play</button>
          <button type="button" className={view === 'configure' ? 'is-selected' : ''} onClick={() => setView('configure')}>Configure</button>
          <button type="button" className={view === 'controls' ? 'is-selected' : ''} onClick={() => setView('controls')}>Controls</button>
        </nav>
        <span className="made-by">Made by 10298 Brain Stormz</span>
      </header>

      <main className={`app-main ${view === 'configure' ? 'is-configure' : ''}`}>
        <div className="field-column">
          <div className="canvas-wrap">
            <canvas ref={canvasRef} className="field-canvas" />
          </div>
          <MatchPanel game={DECODE_GAME} status={match} />

          <div className="field-toolbar">
            <button type="button" onClick={() => runner.reset(robotConfig)}>Restart match</button>
            <label>
              Team
              <select
                aria-label="Driver alliance"
                value={driverAlliance}
                onChange={(event) => selectAlliance(event.target.value as 'red' | 'blue')}
              >
                <option value="red">Red alliance</option>
                <option value="blue">Blue alliance</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={renderOptions.showGrid}
                onChange={(event) =>
                  setRenderOptions({ ...renderOptions, showGrid: event.target.checked })
                }
              />
              Grid
            </label>
            <label>
              <input
                type="checkbox"
                checked={renderOptions.showVelocity}
                onChange={(event) =>
                  setRenderOptions({ ...renderOptions, showVelocity: event.target.checked })
                }
              />
              Velocity
            </label>
            <label>
              <input
                type="checkbox"
                checked={renderOptions.showGameGeometry === true}
                onChange={(event) =>
                  setRenderOptions({ ...renderOptions, showGameGeometry: event.target.checked })
                }
              />
              Debug field geometry
            </label>
            <label>
              <input
                type="checkbox"
                checked={renderOptions.showGeometryLabels === true}
                onChange={(event) =>
                  setRenderOptions({ ...renderOptions, showGeometryLabels: event.target.checked })
                }
              />
              Labels
            </label>
          </div>

          <p className="muted small field-note">Solo driver practice · {driverAlliance} alliance · 12 ft × 12 ft</p>
        </div>

        {view === 'play' ? (
          <aside className="side-column play-sidebar">
            <MechanismPanel sample={telemetry} />
            <VirtualGamepad source={virtualPad} />
            <button type="button" className="debug-toggle" onClick={() => setShowDebug(!showDebug)}>
              {showDebug ? 'Hide engineering telemetry' : 'Show engineering telemetry'}
            </button>
            {showDebug && <TelemetryPanel sample={telemetry} stats={stats} />}
          </aside>
        ) : view === 'configure' ? (
          <aside className="side-column configure-sidebar">
            <RobotBuilder key={robotConfig.id} applied={robotConfig} onApply={applyRobot} />
            <PresetPanel repository={presets} current={robotConfig} onLoad={applyRobot} />
          </aside>
        ) : (
          <aside className="side-column configure-sidebar">
            <ControlsPanel
              bindings={bindings}
              onChange={setBindings}
              gamepadConnected={gamepadConnected}
              driveMode={driveMode}
              onDriveModeChange={setDriveMode}
            />
          </aside>
        )}
      </main>
    </div>
  );
}
