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
import { GAME_REGISTRY, DEFAULT_GAME_ID, getGameEntry } from '../core/game/registry.js';
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
import { GameMenu } from './components/GameMenu.js';
import { PresetRepository } from '../storage/presets.js';
import { createStore } from '../storage/kvStore.js';
import type { RobotConfig } from '../core/robot/robotConfig.js';
import './styles/app.css';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [bindings, setBindings] = useState<KeyBindings>(DEFAULT_KEY_BINDINGS);
  const [bindingsReady, setBindingsReady] = useState(false);
  const [driveMode, setDriveMode] = useState<DriveMode>(DEFAULT_DRIVE_MODE);
  const [driveModeReady, setDriveModeReady] = useState(false);
  const [robotConfig, setRobotConfig] = useState<RobotConfig>(COMPETITION_ROBOT_CONFIG);
  const [view, setView] = useState<'menu' | 'play' | 'configure' | 'controls'>('play');
  const [showDebug, setShowDebug] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetrySample | null>(null);
  const [stats, setStats] = useState<RunnerStats | null>(null);
  const [match, setMatch] = useState<MatchStatus | null>(null);
  const [renderOptions, setRenderOptions] = useState<RenderOptions>(DEFAULT_RENDER_OPTIONS);
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [driverAlliance, setDriverAlliance] = useState<'red' | 'blue'>('red');
  const [selectedGameId, setSelectedGameId] = useState<string>(DEFAULT_GAME_ID);

  const gameEntry = useMemo(() => getGameEntry(selectedGameId), [selectedGameId]);

  // Input sources live outside React's render cycle and are created once; they
  // do not depend on which game is selected.
  const { keyboard, gamepad, virtualPad, inputHub } = useMemo(() => {
    const keyboardSource = new KeyboardSource(DEFAULT_KEY_BINDINGS);
    const gamepadSource = new GamepadSource();
    const virtualSource = new VirtualPadSource();
    const hub = new InputHub([virtualSource, gamepadSource, keyboardSource]);

    return {
      keyboard: keyboardSource,
      gamepad: gamepadSource,
      virtualPad: virtualSource,
      inputHub: hub,
    };
  }, []);

  // The runner is rebuilt whenever the selected game changes — a different
  // game means different rules, field geometry and staged pieces, so this is
  // a fresh world rather than something `reset()` can carry across.
  const runner = useMemo(
    () =>
      new SimRunner(
        COMPETITION_ROBOT_CONFIG,
        inputHub,
        gameEntry.definition,
        gameEntry.legalStartPoses[driverAlliance],
        gameEntry.stagePieces(),
        1,
        gameEntry.createField(),
        driverAlliance,
      ),
    // Recreated only when the game changes. `driverAlliance` seeds the initial
    // start pose here; changing alliance afterwards goes through
    // `selectAlliance`, which calls `runner.setAlliance` on the existing runner
    // rather than rebuilding it, so it is deliberately not a dependency here.
    [gameEntry, inputHub],
  );

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
      runner.setAlliance(alliance, gameEntry.legalStartPoses[alliance]);
    },
    [runner, gameEntry],
  );

  /** Picking a game from the menu loads it and takes the driver straight into Play. */
  const selectGame = useCallback((gameId: string) => {
    setSelectedGameId(gameId);
    setView('play');
  }, []);

  useEffect(() => {
    keyboard.setBindings(bindings);
  }, [keyboard, bindings]);

  useEffect(() => {
    runner.setDriveMode(driveMode);
  }, [runner, driveMode]);

  useEffect(() => {
    runner.setRenderOptions(renderOptions);
  }, [runner, renderOptions]);

  // The canvas unmounts while the Games menu is showing (it has no field to
  // draw), so re-attach it whenever a canvas-bearing view comes back — the
  // main lifecycle effect below only attaches once on mount and would
  // otherwise keep pointing at a canvas that no longer exists in the DOM.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    runner.attach(canvas);
  }, [runner, view]);

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
        <div className="brand"><span className="brand-mark">FTC</span><h1>Simulator</h1><span>{gameEntry.definition.name} · {gameEntry.definition.season}</span></div>
        <nav className="app-nav" aria-label="Main navigation">
          <button type="button" className={view === 'menu' ? 'is-selected' : ''} onClick={() => setView('menu')}>Games</button>
          <button type="button" className={view === 'play' ? 'is-selected' : ''} onClick={() => setView('play')}>Play</button>
          <button type="button" className={view === 'configure' ? 'is-selected' : ''} onClick={() => setView('configure')}>Configure</button>
          <button type="button" className={view === 'controls' ? 'is-selected' : ''} onClick={() => setView('controls')}>Controls</button>
        </nav>
        <span className="made-by">Made by 10298 Brain Stormz</span>
      </header>

      {view === 'menu' ? (
        <main className="app-main app-main-menu">
          <GameMenu games={GAME_REGISTRY} selectedGameId={selectedGameId} onSelect={selectGame} />
        </main>
      ) : (
        <main className={`app-main ${view === 'configure' ? 'is-configure' : ''}`}>
          <div className="field-column">
            <div className="canvas-wrap">
              <canvas ref={canvasRef} className="field-canvas" />
            </div>
            <MatchPanel game={gameEntry.definition} status={match} />

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
      )}
    </div>
  );
}
