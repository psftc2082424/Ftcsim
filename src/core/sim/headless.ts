/**
 * Headless simulation runner — the canonical simulation path.
 *
 * This is the entry point the test suite uses, and it is the entry point future
 * metric probes, archetype measurement and replay verification will use
 * (ARCHITECTURE.md §9.2). It constructs the same `SimWorld` the UI drives; the
 * only difference is what advances the clock — a plain loop here, a
 * `requestAnimationFrame` accumulator there.
 *
 * There is deliberately no second simulation implementation for the UI.
 */

import { SimWorld, TELEMETRY_TICK_INTERVAL, type SimWorldOptions } from './simWorld.js';
import { sampleTelemetry, type TelemetrySample } from '../telemetry/sampler.js';
import type { WorldSnapshot } from './snapshot.js';

export interface HeadlessOptions extends SimWorldOptions {
  readonly ticks: number;
  /**
   * Ticks between telemetry samples. Defaults to the same 10 Hz the UI uses, so
   * a headless measurement sees exactly what a user would.
   */
  readonly telemetryInterval?: number;
  /** Collect a telemetry series. Off by default to keep probe runs allocation-light. */
  readonly recordTelemetry?: boolean;
}

export interface HeadlessResult {
  readonly world: SimWorld;
  readonly finalSnapshot: WorldSnapshot;
  readonly telemetry: readonly TelemetrySample[];
  readonly stateHash: string;
  readonly ticks: number;
}

export function runHeadless(options: HeadlessOptions): HeadlessResult {
  if (!Number.isInteger(options.ticks) || options.ticks < 0) {
    throw new Error(`Tick count must be a non-negative integer, got ${options.ticks}.`);
  }

  const world = new SimWorld(options);
  const interval = options.telemetryInterval ?? TELEMETRY_TICK_INTERVAL;
  const record = options.recordTelemetry ?? false;
  const telemetry: TelemetrySample[] = [];

  if (record) telemetry.push(sampleTelemetry(world.snapshot()));

  for (let i = 0; i < options.ticks; i++) {
    world.step();
    if (record && world.tick % interval === 0) {
      telemetry.push(sampleTelemetry(world.snapshot()));
    }
  }

  return {
    world,
    finalSnapshot: world.snapshot(),
    telemetry,
    stateHash: world.stateHash(),
    ticks: options.ticks,
  };
}

/** Seconds converted to whole ticks. Rounds up so a duration is never truncated. */
export function secondsToTicks(seconds: number, dt: number): number {
  return Math.ceil(seconds / dt);
}
