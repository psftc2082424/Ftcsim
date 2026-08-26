/**
 * End-to-end match simulation.
 *
 * The whole Phase 3 pipeline in one place:
 *
 *     robot + mechanisms
 *       -> physics (SimWorld)
 *       -> WorldSnapshot
 *       -> observations           (observation.ts)
 *       -> game events            (membershipDetector.ts, MatchClock)
 *       -> rules                  (rulesEngine.ts, via MatchRunner)
 *       -> effects and score      (effects.ts)
 *
 * Every stage already existed and is unchanged; this owns the wiring and the
 * per-tick ordering, which is the part that has to be right for a score to mean
 * anything.
 *
 * ── Season-agnostic ────────────────────────────────────────────────────────
 *
 * Nothing here mentions DECODE. It takes a match structure, a rule set, regions,
 * zones and a piece layout, and runs them. Everything game-specific arrives as
 * data.
 *
 * ── Determinism ────────────────────────────────────────────────────────────
 *
 * Driven entirely by the integer tick. Physics is deterministic, the detector
 * sorts its output, and the rules engine is pure, so the same inputs produce the
 * same score and the same event log every run.
 */

import { DT_SECONDS, SimWorld, type GamePieceSpec, type RobotSpec } from '../sim/simWorld.js';
import { matchStateAt, periodOf, type MatchState, type MatchStructure } from './matchStructure.js';
import { MatchRunner } from './matchRunner.js';
import { RegionMembershipDetector } from './membershipDetector.js';
import { observationFrom, type PieceAttribution } from './observation.js';
import { createDefaultRegistry, type PredicateRegistry } from './predicates.js';
import type { FieldRegion, FieldZone } from './regions.js';
import type { ScoringRule, FilterValue } from './scoring.js';
import type { Effect, ScoreState } from './effects.js';
import type { FieldTemplate } from '../field/fieldTemplate.js';
import type { SimEvent } from './events.js';

/**
 * How a game assigns ordered slots within a region.
 *
 * Pattern scoring needs to know *which* slot a piece occupies, and that is a
 * property of the game's region layout rather than of the geometry — DECODE's
 * ramp is a queue, so position in the queue is what matters. Supplied by the
 * GameDefinition rather than guessed from coordinates.
 */
export type SlotAssignment = (pieceId: string, regionId: string) => number | undefined;

export interface MatchSimulationOptions {
  readonly structure: MatchStructure;
  readonly rules: readonly ScoringRule[];
  readonly regions: readonly FieldRegion[];
  readonly zones: readonly FieldZone[];

  readonly robots: readonly RobotSpec[];
  readonly pieces?: readonly GamePieceSpec[];
  readonly field?: FieldTemplate;

  readonly registry?: PredicateRegistry;
  /** Per-match values a game needs, e.g. a randomised pattern. */
  readonly variables?: Readonly<Record<string, FilterValue>>;
  readonly effectsForRule?: Readonly<Record<string, readonly Effect[]>>;
  readonly slotAssignment?: SlotAssignment;
  readonly attribution?: PieceAttribution;
  /** Ordered regions to pre-declare, so slots exist before anything lands. */
  readonly slottedRegions?: Readonly<Record<string, number>>;
  readonly seed?: number;
}

export interface MatchResult {
  readonly score: ScoreState;
  readonly ticks: number;
  readonly finalState: MatchState;
  /** Every event the match produced, in order. */
  readonly events: readonly SimEvent[];
}

export class MatchSimulation {
  readonly world: SimWorld;
  readonly runner: MatchRunner;
  readonly detector: RegionMembershipDetector;

  private readonly options: MatchSimulationOptions;
  private readonly structure: MatchStructure;
  private readonly eventLog: SimEvent[] = [];

  constructor(options: MatchSimulationOptions) {
    this.options = options;
    this.structure = options.structure;

    this.world = new SimWorld({
      robots: options.robots,
      pieces: options.pieces,
      field: options.field,
      seed: options.seed,
    });

    this.detector = new RegionMembershipDetector({
      regions: options.regions,
      zones: options.zones,
      dtSec: DT_SECONDS,
    });

    this.runner = new MatchRunner({
      structure: options.structure,
      rules: options.rules,
      registry: options.registry ?? createDefaultRegistry(),
      dtSec: DT_SECONDS,
      variables: options.variables,
      effectsForRule: options.effectsForRule,
    });

    for (const [regionId, slots] of Object.entries(options.slottedRegions ?? {})) {
      this.runner.declareSlottedRegion(regionId, slots);
    }

    // Pieces and robots start where the game placed them. Priming means the
    // starting layout is a baseline, not a flurry of scoring events on tick 0.
    this.detector.prime(observationFrom(this.world.snapshot(), { attribution: options.attribution }));
  }

  get score(): ScoreState {
    return this.runner.score;
  }

  get tick(): number {
    return this.world.tick;
  }

  get matchState(): MatchState {
    return this.runner.matchState;
  }

  get events(): readonly SimEvent[] {
    return this.eventLog;
  }

  /**
   * Advance one tick through the whole pipeline.
   *
   * Order matters and is the reason this class exists:
   *
   *   1. Physics moves the world.
   *   2. The snapshot becomes observations, and membership changes become
   *      events. These are ingested while the clock still reads the *current*
   *      phase, so a piece scored in the last moment of AUTO scores as AUTO.
   *   3. If this tick ends a period, current occupancy and resting pieces are
   *      restated as facts — end-of-period assessment needs the final position,
   *      not the long-past moment of arrival — again before the clock moves.
   *   4. The clock advances, and any `PhaseChanged` runs through the rules.
   */
  step(): void {
    this.world.step();

    const observation = observationFrom(this.world.snapshot(), {
      attribution: this.options.attribution,
    });
    this.ingestAll(this.detector.update(observation, this.world.tick));

    if (this.endsAPeriod(this.world.tick)) {
      this.ingestAll(this.detector.restateRestingPieces(this.world.tick, this.options.slotAssignment));
      this.ingestAll(this.detector.restateOccupancy(this.world.tick));
    }

    // The runner ingests its own transition; logging the returned event keeps
    // the log complete without ingesting it twice.
    const transition = this.runner.step();
    if (transition !== null) this.eventLog.push(transition);
  }

  /** Run the whole match and return the result. */
  run(): MatchResult {
    const total = Math.ceil(totalTicks(this.structure));
    for (let i = 0; i < total && !this.runner.isFinished; i++) this.step();

    return {
      score: this.runner.score,
      ticks: this.world.tick,
      finalState: this.runner.matchState,
      events: this.eventLog,
    };
  }

  /** Advance to a match time, in seconds. */
  advanceTo(timeSec: number): void {
    while (this.world.tick * DT_SECONDS < timeSec && !this.runner.isFinished) this.step();
  }

  private ingestAll(events: readonly SimEvent[]): void {
    for (const event of events) {
      this.eventLog.push(event);
      this.runner.ingest(event);
    }
  }

  /**
   * Does a scoring *period* end between this tick and the next?
   *
   * Deliberately keyed on the period rather than the phase. Crossing
   * TELEOP → ENDGAME changes phase but does not end teleop, because endgame is
   * a sub-phase inside it — restating occupancy there would assess the same
   * robots twice and double every end-of-period award.
   *
   * Computed from the structure rather than read off the runner, so no private
   * state is exposed and the answer is available *before* the transition rather
   * than after it.
   */
  private endsAPeriod(tick: number): boolean {
    const now = periodOf(matchStateAt(this.structure, tick * DT_SECONDS));
    const next = periodOf(matchStateAt(this.structure, (tick + 1) * DT_SECONDS));
    return now !== null && now !== next;
  }
}

function totalTicks(structure: MatchStructure): number {
  const auto = structure.periods[0].durationSec.value;
  const teleop = structure.periods[1].durationSec.value;
  const transition = structure.transitionSec?.value ?? 0;
  return (auto + transition + teleop) / DT_SECONDS + 1;
}
