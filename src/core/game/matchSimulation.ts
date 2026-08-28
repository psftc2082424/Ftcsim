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
import type { WorldSnapshot } from '../sim/snapshot.js';
import { matchStateAt, periodOf, type MatchState, type MatchStructure } from './matchStructure.js';
import { MatchRunner } from './matchRunner.js';
import { RegionMembershipDetector } from './membershipDetector.js';
import { observationFrom, type PieceAttribution } from './observation.js';
import { PossessionTracker, attributionFrom, type PossessionOptions } from './possession.js';
import {
  PieceConveyors,
  resolveConveyorPlaces,
  type PieceConveyorSpec,
} from './conveyor.js';
import { createDefaultRegistry, type PredicateRegistry } from './predicates.js';
import type { FieldRegion, FieldZone } from './regions.js';
import type { ScoringRule, FilterValue } from './scoring.js';
import type { Effect, ScoreState } from './effects.js';
import type { FieldTemplate } from '../field/fieldTemplate.js';
import type { SimEvent } from './events.js';
import type { GameDefinition } from './gameDefinition.js';
import type { MechanismActionRoute } from './gameDefinition.js';

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
  /** Field mechanisms that move pieces about (`conveyor.ts`). */
  readonly conveyors?: readonly PieceConveyorSpec[] | undefined;
  /** Deterministic destinations for actions emitted by robot mechanisms. */
  readonly mechanismActionRoutes?: readonly MechanismActionRoute[] | undefined;

  readonly robots: readonly RobotSpec[];
  readonly pieces?: readonly GamePieceSpec[] | undefined;
  readonly field?: FieldTemplate | undefined;

  readonly registry?: PredicateRegistry | undefined;
  /** Per-match values a game needs, e.g. a randomised pattern. */
  readonly variables?: Readonly<Record<string, FilterValue>> | undefined;
  readonly effectsForRule?: Readonly<Record<string, readonly Effect[]>> | undefined;
  readonly slotAssignment?: SlotAssignment | undefined;
  /**
   * Overrides the built-in possession tracker.
   *
   * The default credits a piece to whichever robot last pushed it, decided from
   * the snapshot (`possession.ts`). A caller supplying its own attribution —
   * a test asserting a specific credit, say — replaces that entirely.
   */
  readonly attribution?: PieceAttribution | undefined;
  /** Tuning for the built-in possession tracker. Ignored if `attribution` is set. */
  readonly possession?: PossessionOptions | undefined;
  /** Ordered regions to pre-declare, so slots exist before anything lands. */
  readonly slottedRegions?: Readonly<Record<string, number>> | undefined;
  readonly seed?: number | undefined;
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
  readonly possession: PossessionTracker;
  readonly conveyors: PieceConveyors;

  private readonly options: MatchSimulationOptions;
  private readonly attribution: PieceAttribution;
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

    this.possession = new PossessionTracker(options.possession);
    this.attribution = options.attribution ?? attributionFrom(this.possession);

    const conveyorSpecs = options.conveyors ?? [];
    this.conveyors = new PieceConveyors(
      conveyorSpecs,
      resolveConveyorPlaces(conveyorSpecs, options.regions, options.zones),
      DT_SECONDS,
    );

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
    this.detector.prime(observationFrom(this.world.snapshot(), { attribution: this.attribution }));
    // Membership baselines do not become scoring events, but rule predicates
    // still need initial robot zone support for a first-tick action such as a
    // launch-zone foul. Seed runner bookkeeping without evaluating rules.
    this.runner.primeZoneOccupancy(this.detector.restateOccupancy(this.world.tick));
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
   *   1b. Possession is decided from the new snapshot, so attribution is
   *      current before anything asks who is responsible for a piece.
   *   2. The snapshot becomes observations, and membership changes become
   *      events. These are ingested while the clock still reads the *current*
   *      phase, so a piece scored in the last moment of AUTO scores as AUTO.
   *   3. If this tick ends a period, current occupancy and resting pieces are
   *      restated as facts — end-of-period assessment needs the final position,
   *      not the long-past moment of arrival — again before the clock moves.
   *   3a. Mechanism actions resolve through the game's declared destinations.
   *      A functional shot becomes an ordinary region entry; it does not
   *      synthesize a score or a projectile.
   *   3b. Field mechanisms take and release pieces. **After** the detector, so
   *      a piece that entered a scoring region this tick has already produced
   *      its event and been judged against the state before it arrived. Moving
   *      it first would delete the arrival the rules exist to score.
   *   4. The clock advances, and any `PhaseChanged` runs through the rules.
   */
  step(): void {
    this.world.step();

    const snapshot = this.world.snapshot();

    // Possession first: a piece that enters a region on the same tick it is
    // pushed must be credited to the robot that pushed it, so the tracker has
    // to have seen this tick before the observation asks it who is responsible.
    this.ingestAll(this.possession.update(snapshot, this.world.tick));

    const observation = observationFrom(snapshot, { attribution: this.attribution });
    this.ingestAll(this.detector.update(observation, this.world.tick));

    this.routeMechanismActions(this.options.mechanismActionRoutes ?? [], snapshot);

    // Action routing moved one or more pieces. A second diff on the same tick
    // emits only those transitions and preserves the event -> rules boundary.
    const routedSnapshot = this.world.snapshot();
    this.ingestAll(
      this.detector.update(observationFrom(routedSnapshot, { attribution: this.attribution }), this.world.tick),
    );

    this.conveyors.update(routedSnapshot, this.world.tick, this.world);

    if (this.endsAPeriod(this.world.tick)) {
      this.ingestAll(this.detector.restateRestingPieces(this.world.tick, this.options.slotAssignment));
      this.ingestAll(this.detector.restateOccupancy(this.world.tick));
      // Robots last: an assessment rule asks where a robot is *not*, so the
      // zone bookkeeping above must already be current when it runs.
      this.ingestAll(this.detector.restateRobots(this.world.tick));
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
      if (event.kind === 'PieceLaunched') this.conveyors.rearmPiece(event.pieceId);
      // A legitimate elevated entry is scored through its first ordinary
      // membership transition. Once the conveyor has captured that physical
      // body, a later overlap with the same high GOAL volume is settling
      // noise, not another shot. A later real `PieceLaunched` re-arms it.
      if (
        event.kind === 'PieceEnteredRegion' &&
        this.conveyors.hasAcceptedEntry(event.pieceId, event.regionId)
      ) {
        continue;
      }
      this.runner.ingest(event);
    }
  }

  /**
   * Resolve a pending robot action only through data on the GameDefinition.
   *
   * @param snapshotBeforeRouting Read for the firing robot's height, so the
   *   piece launches from where it actually left the mechanism rather than
   *   from an assumed height.
   */
  private routeMechanismActions(
    routes: readonly MechanismActionRoute[],
    snapshotBeforeRouting: WorldSnapshot,
  ): void {
    for (const action of this.world.drainPieceActions()) {
      const route = routes.find((candidate) => candidate.action === action.kind);
      if (route === undefined) {
        // A generic world has no promise that every launch scores. An action
        // without a declared route simply returns its piece to the field.
        this.world.releasePiece(action.pieceId, action.originM);
        continue;
      }

      const destinationId = route.destinationRegionByAlliance[action.alliance];
      const destination = this.options.regions.find((region) => region.id === destinationId);
      if (destination === undefined) {
        // Definition validation catches this before a normal match begins; the
        // guard keeps direct MatchSimulation construction fail-safe as well.
        throw new Error(
          `Mechanism action route "${route.id}" needs region "${destinationId}" for ${action.alliance}.`,
        );
      }

      // Leaves at the mechanism's own height, not the floor — a shooter sits on
      // top of a chassis, and a piece launched from the ground could never
      // clear a raised goal's near wall on the way up. The firing robot always
      // exists in this same tick's snapshot; it only just released the piece.
      const firingRobot = snapshotBeforeRouting.robots.find((robot) => robot.id === action.robotId);
      if (firingRobot === undefined) {
        throw new Error(`Launch action from unknown robot id ${action.robotId}.`);
      }
      const launchHeightM = firingRobot.heightM;

      this.world.launchPieceTowards(
        action.pieceId,
        destination.centerM,
        route.arcApexHeightM,
        launchHeightM,
      );
      const launchedPiece = snapshotBeforeRouting.pieces.find((piece) => piece.pieceId === action.pieceId);
      this.ingestAll([
        {
          kind: 'PieceLaunched',
          tick: this.world.tick,
          timeSec: snapshotBeforeRouting.timeSec,
          pieceId: action.pieceId,
          pieceType: launchedPiece?.pieceType ?? '',
          // The game/event layer uses stable string identities; physics uses
          // numeric entity ids. Keep this action fact consistent with zone and
          // possession events so predicates can correlate the firing robot.
          robotId: String(action.robotId),
          alliance: action.alliance,
        },
      ]);
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

/** What a caller supplies on top of a season definition to run one match. */
export interface MatchSetup {
  readonly robots: readonly RobotSpec[];
  readonly pieces?: readonly GamePieceSpec[] | undefined;
  readonly field?: FieldTemplate | undefined;
  readonly registry?: PredicateRegistry | undefined;
  readonly slotAssignment?: SlotAssignment | undefined;
  readonly attribution?: PieceAttribution | undefined;
  readonly possession?: PossessionOptions | undefined;
  /** Overrides the definition's defaults, e.g. this match's randomised motif. */
  readonly variables?: Readonly<Record<string, FilterValue>> | undefined;
  readonly effectsForRule?: Readonly<Record<string, readonly Effect[]>> | undefined;
  readonly seed?: number | undefined;
}

/**
 * Build a match from a season definition plus the setup for one match.
 *
 * This is the shape the architecture's central claim takes in code: a season is
 * data, and running it takes no season-specific wiring. Everything about the
 * game — timing, geometry, rules, slots, defaults — comes off the definition,
 * and the caller supplies only what varies per match.
 *
 * Validate the definition first (`validateGameDefinition`); this trusts what it
 * is given.
 */
export function simulationFromDefinition(
  definition: GameDefinition,
  setup: MatchSetup,
): MatchSimulation {
  return new MatchSimulation({
    structure: definition.match,
    rules: definition.rules,
    regions: definition.regions,
    zones: definition.zones,
    slottedRegions: definition.slottedRegions,

    conveyors: definition.conveyors,
    mechanismActionRoutes: definition.mechanismActionRoutes,

    robots: setup.robots,
    pieces: setup.pieces,
    field: setup.field,
    registry: setup.registry,
    slotAssignment: setup.slotAssignment,
    attribution: setup.attribution,
    possession: setup.possession,
    effectsForRule: setup.effectsForRule,
    seed: setup.seed,

    // A match's own variables win over the definition's defaults: the motif is
    // drawn per match, so a definition can only carry a placeholder.
    variables: { ...definition.variables, ...setup.variables },
  });
}

function totalTicks(structure: MatchStructure): number {
  const auto = structure.periods[0].durationSec.value;
  const teleop = structure.periods[1].durationSec.value;
  const transition = structure.transitionSec?.value ?? 0;
  return (auto + transition + teleop) / DT_SECONDS + 1;
}
