/**
 * The bridge between the browser and the simulation core.
 *
 * Owns a `SimWorld` and drives it from a fixed-timestep accumulator inside
 * `requestAnimationFrame`. Three rates, deliberately separate
 * (ARCHITECTURE.md §9):
 *
 *   - physics   200 Hz, fixed. Frame time never becomes a timestep.
 *   - render    whatever rAF offers, interpolated between the last two ticks.
 *   - telemetry 10 Hz, the only rate React ever sees.
 *
 * **React does not participate in the simulation loop.** Nothing in this file
 * imports React or touches component state; telemetry is pushed to subscribers
 * ten times a second and that is the entire coupling.
 *
 * This drives the same `SimWorld` the headless test harness drives. There is no
 * second simulation implementation.
 */

import {
  DT_SECONDS,
  TELEMETRY_TICK_INTERVAL,
  type GamePieceSpec,
} from '../core/sim/simWorld.js';
import { simulationFromDefinition, type MatchSimulation } from '../core/game/matchSimulation.js';
import type { GameDefinition } from '../core/game/gameDefinition.js';
import type { MatchState } from '../core/game/matchStructure.js';
import { LatchedController } from '../core/control/controller.js';
import { NEUTRAL_INPUT } from '../core/control/controlInput.js';
import { createStandardField, type FieldTemplate } from '../core/field/fieldTemplate.js';
import { sampleTelemetry, type TelemetrySample } from '../core/telemetry/sampler.js';
import type { RobotConfig } from '../core/robot/robotConfig.js';
import { vec2 } from '../core/math/vec2.js';
import type { Pose } from '../core/physics/body.js';
import {
  DEFAULT_RENDER_OPTIONS,
  renderFrame,
  syncCanvasSize,
  type FieldOverlay,
  type RenderOptions,
} from './render/fieldRenderer.js';
import type { InputHub } from './input/sources.js';
import { FixedTimestepAccumulator } from './fixedTimestep.js';

/**
 * Longest frame gap the accumulator will honour, in seconds.
 *
 * A backgrounded tab can return with a multi-second gap; without a clamp the
 * loop would try to catch up thousands of ticks in one frame, take longer than
 * a frame to do it, and fall further behind every time. Clamping drops the
 * missed time instead — simulated time is allowed to lag wall time, but the
 * simulation never stalls.
 */
const MAX_FRAME_SECONDS = 0.25;

/** How many recent awards the live scoring feed carries. */
const RECENT_AWARD_COUNT = 6;

export interface RunnerStats {
  readonly tick: number;
  readonly simTimeSec: number;
  readonly framesPerSecond: number;
  readonly ticksPerSecond: number;
  readonly activeSource: string | null;
}

/**
 * What the game layer is doing, sampled at the telemetry rate.
 *
 * Separate from `RunnerStats` because it describes the *match* rather than
 * the loop, and separate from telemetry because telemetry describes one
 * robot. A definition with no rules simply never awards anything.
 */
export interface MatchAward {
  readonly ruleId: string;
  readonly label: string;
  readonly points: number;
  readonly alliance: 'red' | 'blue';
}

export interface MatchStatus {
  readonly state: MatchState;
  readonly matchTimeSec: number;
  readonly red: number;
  readonly blue: number;
  /** Most recent awards, newest first. A live feed, not the audit trail. */
  readonly recentAwards: readonly MatchAward[];
}

export type TelemetryListener = (sample: TelemetrySample) => void;
export type StatsListener = (stats: RunnerStats) => void;
export type MatchListener = (status: MatchStatus) => void;

export class SimRunner {
  readonly field: FieldTemplate;

  /**
   * The whole Phase 3 pipeline, not a bare `SimWorld`.
   *
   * `MatchSimulation` owns a world and adds observations, events, rules and
   * score on top of it. Driving that here is what makes the game layer visible
   * in the product rather than only in tests, and it is still the one
   * simulation implementation — the headless harness drives the same class.
   */
  private simulation: MatchSimulation;
  private readonly controller = new LatchedController('ui');
  private readonly stepper = new FixedTimestepAccumulator(DT_SECONDS, MAX_FRAME_SECONDS);
  private lastFrameMs: number | null = null;
  private rafId: number | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private renderOptions: RenderOptions = DEFAULT_RENDER_OPTIONS;

  private readonly telemetryListeners = new Set<TelemetryListener>();
  private readonly statsListeners = new Set<StatsListener>();
  private readonly matchListeners = new Set<MatchListener>();
  private lastTelemetryTick = -1;

  private frameCount = 0;
  private lastRateSampleMs = 0;
  private lastRateSampleTick = 0;
  private framesPerSecond = 0;
  private ticksPerSecond = 0;

  constructor(
    private robotConfig: RobotConfig,
    private readonly inputHub: InputHub,
    private readonly game: GameDefinition,
    private readonly startPose: Pose = { p: vec2(0, 0), theta: 0 },
    /** Game pieces the field starts with. A bare drivetrain world has none. */
    private readonly stagedPieces: readonly GamePieceSpec[] = [],
    private readonly seed = 1,
    field: FieldTemplate = createStandardField(),
  ) {
    this.field = field;
    this.simulation = this.createSimulation();
  }

  private createSimulation(): MatchSimulation {
    return simulationFromDefinition(this.game, {
      robots: [
        {
          config: this.robotConfig,
          controller: this.controller,
          alliance: 'red',
          startPose: this.startPose,
        },
      ],
      pieces: this.stagedPieces,
      field: this.field,
      seed: this.seed,
    });
  }

  /** Regions and zones the game declares, for the renderer's overlay. */
  get overlay(): FieldOverlay {
    return { regions: this.game.regions, zones: this.game.zones };
  }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
  }

  start(): void {
    if (this.rafId !== null) return;
    this.lastFrameMs = null;
    // Publish one sample immediately so the panels show real values rather than
    // an empty state until the first frame lands.
    this.emitTelemetry();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  /** Rebuild the world from scratch. Used by the Reset control. */
  reset(config: RobotConfig = this.robotConfig): void {
    this.robotConfig = config;
    this.controller.set(NEUTRAL_INPUT);
    this.simulation = this.createSimulation();
    this.stepper.reset();
    this.lastTelemetryTick = -1;
    this.emitTelemetry();
    this.emitMatch();
  }

  setRenderOptions(options: RenderOptions): void {
    this.renderOptions = options;
  }

  onTelemetry(listener: TelemetryListener): () => void {
    this.telemetryListeners.add(listener);
    return () => this.telemetryListeners.delete(listener);
  }

  onStats(listener: StatsListener): () => void {
    this.statsListeners.add(listener);
    return () => this.statsListeners.delete(listener);
  }

  onMatch(listener: MatchListener): () => void {
    this.matchListeners.add(listener);
    return () => this.matchListeners.delete(listener);
  }

  private readonly frame = (nowMs: number): void => {
    this.rafId = requestAnimationFrame(this.frame);

    if (this.lastFrameMs === null) {
      this.lastFrameMs = nowMs;
      this.lastRateSampleMs = nowMs;
      this.lastRateSampleTick = this.simulation.tick;
    }

    const elapsed = (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;

    // Whole fixed steps only. The leftover carries into the next frame.
    const steps = this.stepper.advance(elapsed);
    for (let i = 0; i < steps; i++) {
      this.controller.set(this.inputHub.read() ?? NEUTRAL_INPUT);
      this.simulation.step();
    }

    this.render(this.stepper.alpha);

    if (this.simulation.tick - this.lastTelemetryTick >= TELEMETRY_TICK_INTERVAL) {
      this.emitTelemetry();
      this.emitMatch();
    }

    this.updateRates(nowMs);
  };

  private render(alpha: number): void {
    const canvas = this.canvas;
    if (canvas === null) return;

    syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    renderFrame(
      ctx,
      this.simulation.world.snapshot(),
      this.field,
      alpha,
      this.renderOptions,
      this.overlay,
    );
    this.frameCount++;
  }

  private emitTelemetry(): void {
    this.lastTelemetryTick = this.simulation.tick;
    const sample = sampleTelemetry(this.simulation.world.snapshot());
    for (const listener of this.telemetryListeners) listener(sample);
  }

  private emitMatch(): void {
    if (this.matchListeners.size === 0) return;

    const score = this.simulation.score;
    const status: MatchStatus = {
      state: this.simulation.matchState,
      matchTimeSec: this.simulation.tick * DT_SECONDS,
      red: score.red,
      blue: score.blue,
      recentAwards: score.deltas
        .slice(-RECENT_AWARD_COUNT)
        .reverse()
        .map((delta) => ({
          ruleId: delta.ruleId,
          label: delta.label,
          points: delta.points,
          alliance: delta.alliance,
        })),
    };

    for (const listener of this.matchListeners) listener(status);
  }

  private updateRates(nowMs: number): void {
    const windowMs = nowMs - this.lastRateSampleMs;
    if (windowMs < 500) return;

    this.framesPerSecond = (this.frameCount * 1000) / windowMs;
    this.ticksPerSecond = ((this.simulation.tick - this.lastRateSampleTick) * 1000) / windowMs;

    this.frameCount = 0;
    this.lastRateSampleMs = nowMs;
    this.lastRateSampleTick = this.simulation.tick;

    const stats: RunnerStats = {
      tick: this.simulation.tick,
      simTimeSec: this.simulation.tick * DT_SECONDS,
      framesPerSecond: this.framesPerSecond,
      ticksPerSecond: this.ticksPerSecond,
      activeSource: this.inputHub.activeSource(),
    };
    for (const listener of this.statsListeners) listener(stats);
  }
}
