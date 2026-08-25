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

import { DT_SECONDS, SimWorld, TELEMETRY_TICK_INTERVAL } from '../core/sim/simWorld.js';
import { LatchedController } from '../core/control/controller.js';
import { NEUTRAL_INPUT } from '../core/control/controlInput.js';
import { createStandardField, type FieldTemplate } from '../core/field/fieldTemplate.js';
import { sampleTelemetry, type TelemetrySample } from '../core/telemetry/sampler.js';
import type { RobotConfig } from '../core/robot/robotConfig.js';
import { vec2 } from '../core/math/vec2.js';
import {
  DEFAULT_RENDER_OPTIONS,
  renderFrame,
  syncCanvasSize,
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

export interface RunnerStats {
  readonly tick: number;
  readonly simTimeSec: number;
  readonly framesPerSecond: number;
  readonly ticksPerSecond: number;
  readonly activeSource: string | null;
}

export type TelemetryListener = (sample: TelemetrySample) => void;
export type StatsListener = (stats: RunnerStats) => void;

export class SimRunner {
  readonly field: FieldTemplate;

  private world: SimWorld;
  private readonly controller = new LatchedController('ui');
  private readonly stepper = new FixedTimestepAccumulator(DT_SECONDS, MAX_FRAME_SECONDS);
  private lastFrameMs: number | null = null;
  private rafId: number | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private renderOptions: RenderOptions = DEFAULT_RENDER_OPTIONS;

  private readonly telemetryListeners = new Set<TelemetryListener>();
  private readonly statsListeners = new Set<StatsListener>();
  private lastTelemetryTick = -1;

  private frameCount = 0;
  private lastRateSampleMs = 0;
  private lastRateSampleTick = 0;
  private framesPerSecond = 0;
  private ticksPerSecond = 0;

  constructor(
    private robotConfig: RobotConfig,
    private readonly inputHub: InputHub,
    private readonly seed = 1,
  ) {
    this.field = createStandardField();
    this.world = this.createWorld();
  }

  private createWorld(): SimWorld {
    return new SimWorld({
      robots: [
        {
          config: this.robotConfig,
          controller: this.controller,
          alliance: 'red',
          startPose: { p: vec2(0, 0), theta: 0 },
        },
      ],
      field: this.field,
      seed: this.seed,
    });
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
    this.world = this.createWorld();
    this.stepper.reset();
    this.lastTelemetryTick = -1;
    this.emitTelemetry();
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

  private readonly frame = (nowMs: number): void => {
    this.rafId = requestAnimationFrame(this.frame);

    if (this.lastFrameMs === null) {
      this.lastFrameMs = nowMs;
      this.lastRateSampleMs = nowMs;
      this.lastRateSampleTick = this.world.tick;
    }

    const elapsed = (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;

    // Whole fixed steps only. The leftover carries into the next frame.
    const steps = this.stepper.advance(elapsed);
    for (let i = 0; i < steps; i++) {
      this.controller.set(this.inputHub.read() ?? NEUTRAL_INPUT);
      this.world.step();
    }

    this.render(this.stepper.alpha);

    if (this.world.tick - this.lastTelemetryTick >= TELEMETRY_TICK_INTERVAL) {
      this.emitTelemetry();
    }

    this.updateRates(nowMs);
  };

  private render(alpha: number): void {
    const canvas = this.canvas;
    if (canvas === null) return;

    syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    renderFrame(ctx, this.world.snapshot(), this.field, alpha, this.renderOptions);
    this.frameCount++;
  }

  private emitTelemetry(): void {
    this.lastTelemetryTick = this.world.tick;
    const sample = sampleTelemetry(this.world.snapshot());
    for (const listener of this.telemetryListeners) listener(sample);
  }

  private updateRates(nowMs: number): void {
    const windowMs = nowMs - this.lastRateSampleMs;
    if (windowMs < 500) return;

    this.framesPerSecond = (this.frameCount * 1000) / windowMs;
    this.ticksPerSecond = ((this.world.tick - this.lastRateSampleTick) * 1000) / windowMs;

    this.frameCount = 0;
    this.lastRateSampleMs = nowMs;
    this.lastRateSampleTick = this.world.tick;

    const stats: RunnerStats = {
      tick: this.world.tick,
      simTimeSec: this.world.timeSec,
      framesPerSecond: this.framesPerSecond,
      ticksPerSecond: this.ticksPerSecond,
      activeSource: this.inputHub.activeSource(),
    };
    for (const listener of this.statsListeners) listener(stats);
  }
}
