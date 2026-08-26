/**
 * Match runner — the end-to-end path from simulated actions to a score.
 *
 * Ties together the match clock, the event stream, the predicate registry and
 * the rules engine, and maintains the small amount of *logical* world state that
 * scoring needs but rigid-body physics does not express: which pieces occupy
 * which regions, which ordered slot each sits in, and which robots are supported
 * inside which zones.
 *
 * ── Where this sits ────────────────────────────────────────────────────────
 *
 * The runner consumes events and produces score. It never reads a body, never
 * integrates anything, and never emits an event itself except the clock's phase
 * transitions. That keeps the physics/game separation intact
 * (ARCHITECTURE.md §3.2): a simulation feeds it facts, and it feeds back a
 * closed set of effects.
 *
 * It is driven by ticks, not by wall time, so a match replays exactly.
 */

import { MatchClock } from './matchClock.js';
import { evaluateRules, createAwardState, type RuleAwardState } from './rulesEngine.js';
import {
  EMPTY_SCORE,
  applyScoreDeltas,
  assertNeverEffect,
  type Effect,
  type ScoreState,
} from './effects.js';
import type { PredicateContext, PredicateRegistry } from './predicates.js';
import type { FilterValue, ScoringRule } from './scoring.js';
import type { MatchState, MatchStructure } from './matchStructure.js';
import type { SimEvent } from './events.js';

export interface MatchRunnerOptions {
  readonly structure: MatchStructure;
  readonly rules: readonly ScoringRule[];
  readonly registry: PredicateRegistry;
  readonly dtSec: number;
  /** Per-match values, e.g. the randomised motif. */
  readonly variables?: Readonly<Record<string, FilterValue>> | undefined;
  /** Effects to apply when a given rule awards. */
  readonly effectsForRule?: Readonly<Record<string, readonly Effect[]>> | undefined;
}

/** Logical world state the rules need. Physics does not model any of it. */
interface WorldBookkeeping {
  regionSlots: Record<string, (string | null)[]>;
  regionContents: Record<string, string[]>;
  robotsFullyInZone: Record<string, string[]>;
  robotsPartiallyInZone: Record<string, string[]>;
  variables: Record<string, FilterValue>;
}

export class MatchRunner {
  private readonly clock: MatchClock;
  private readonly awards: RuleAwardState = createAwardState();
  private readonly world: WorldBookkeeping;
  private scoreState: ScoreState = EMPTY_SCORE;

  constructor(private readonly options: MatchRunnerOptions) {
    this.clock = new MatchClock({ structure: options.structure, dtSec: options.dtSec });
    this.world = {
      regionSlots: {},
      regionContents: {},
      robotsFullyInZone: {},
      robotsPartiallyInZone: {},
      variables: { ...(options.variables ?? {}) },
    };
  }

  get score(): ScoreState {
    return this.scoreState;
  }

  get tick(): number {
    return this.clock.tick;
  }

  get matchState() {
    return this.clock.currentState;
  }

  get isFinished(): boolean {
    return this.clock.isFinished;
  }

  /** Pre-declare an ordered region so slots exist before anything lands in them. */
  declareSlottedRegion(regionId: string, slotCount: number): void {
    this.world.regionSlots[regionId] = new Array<string | null>(slotCount).fill(null);
  }

  setVariable(name: string, value: FilterValue): void {
    this.world.variables[name] = value;
  }

  /**
   * Feed one fact into the match.
   *
   * World bookkeeping is updated *before* rules run, so a rule evaluating a
   * predicate sees the world as it is after the event it is reacting to.
   */
  ingest(event: SimEvent): void {
    this.applyEventToWorld(event);

    const matchState = this.scopeStateFor(event);

    const evaluation = evaluateRules({
      rules: this.options.rules,
      event,
      matchState,
      registry: this.options.registry,
      context: this.snapshotContext(event),
      awards: this.awards,
      effectsForRule: this.options.effectsForRule,
    });

    this.scoreState = applyScoreDeltas(this.scoreState, evaluation.deltas);
    for (const effect of evaluation.effects) this.applyEffect(effect);
  }

  /**
   * Advance the clock one tick, routing any phase transition through the rules.
   *
   * This is what makes end-of-period assessment ordinary: LEAVE, BASE, DEPOT and
   * PATTERN are rules triggered by `PhaseChanged`, not engine special cases.
   */
  step(): SimEvent | null {
    const transition = this.clock.advance();
    if (transition !== null) this.ingest(transition);
    // Returned as well as ingested so a caller keeping an event log sees the
    // transitions the runner generates internally, rather than having to
    // reconstruct them from the structure.
    return transition;
  }

  /** Run to the end of the match. */
  runToCompletion(): ScoreState {
    const total = this.clock.totalTicks();
    for (let i = 0; i < total && !this.clock.isFinished; i++) this.step();
    return this.scoreState;
  }

  /** Advance until the clock reaches `timeSec`, ingesting transitions on the way. */
  advanceTo(timeSec: number): void {
    while (this.clock.timeSec < timeSec && !this.clock.isFinished) this.step();
  }

  /**
   * Which phase a rule is scoped against for this event.
   *
   * For an ordinary event that is simply the current state. For a phase
   * *transition* it is the phase that just **ended**, because end-of-period
   * assessment belongs to the period being assessed — the DECODE manual says so
   * directly (§10.5 A: "ARTIFACTS that meet scoring criteria prior to the start
   * of TELEOP are assessed as part of AUTO").
   *
   * Without this, a rule assessing the end of AUTO would be evaluated against
   * whatever comes next and would never fire.
   */
  private scopeStateFor(event: SimEvent): MatchState {
    if (event.kind !== 'PhaseChanged') return this.clock.currentState;

    const from = event.from as MatchState;
    return from === 'AUTO' || from === 'TELEOP' || from === 'ENDGAME'
      ? from
      : this.clock.currentState;
  }

  private snapshotContext(event: SimEvent): PredicateContext {
    return {
      event,
      matchState: this.clock.currentState,
      regionSlots: this.world.regionSlots,
      regionContents: this.world.regionContents,
      variables: this.world.variables,
      robotsFullyInZone: this.world.robotsFullyInZone,
      robotsPartiallyInZone: this.world.robotsPartiallyInZone,
    };
  }

  private applyEventToWorld(event: SimEvent): void {
    switch (event.kind) {
      case 'PieceEnteredRegion':
        this.addToRegion(event.regionId, event.pieceType);
        break;

      case 'PieceExitedRegion':
        this.removeFromRegion(event.regionId, event.pieceType);
        break;

      case 'PieceCameToRest':
        for (const regionId of event.regionIds) this.addToRegion(regionId, event.pieceType);
        // A resting piece may occupy an ordered slot, which is what pattern
        // scoring reads.
        if (event.slotIndex !== undefined && event.regionIds.length > 0) {
          const regionId = event.regionIds[0] as string;
          this.setSlot(regionId, event.slotIndex, event.pieceType);
        }
        break;

      case 'RobotEnteredZone':
      case 'RobotOverlapsZone':
        this.setZoneOccupancy(event.zoneId, event.robotId, event.supportFraction ?? 1);
        break;

      case 'RobotExitedZone':
        this.clearZoneOccupancy(event.zoneId, event.robotId);
        break;

      case 'PieceReleasedBy':
      case 'RobotHeightExceeded':
      case 'MechanismStateChanged':
      case 'PhaseChanged':
        break;
    }
  }

  private applyEffect(effect: Effect): void {
    switch (effect.kind) {
      case 'consumePiece':
        for (const contents of Object.values(this.world.regionContents)) {
          const index = contents.indexOf(effect.pieceId);
          if (index >= 0) contents.splice(index, 1);
        }
        break;

      case 'setPieceRegion':
        this.addToRegion(effect.regionId, effect.pieceId);
        if (effect.slotIndex !== undefined) {
          this.setSlot(effect.regionId, effect.slotIndex, effect.pieceId);
        }
        break;

      case 'setVariable':
        this.world.variables[effect.name] = effect.value;
        break;

      // Possession and position are the simulation's business, not the score
      // bookkeeping's; the runner records nothing for these.
      case 'attachPiece':
      case 'detachPiece':
      case 'teleportPiece':
        break;

      default:
        assertNeverEffect(effect);
    }
  }

  private addToRegion(regionId: string, value: string): void {
    (this.world.regionContents[regionId] ??= []).push(value);
  }

  private removeFromRegion(regionId: string, value: string): void {
    const contents = this.world.regionContents[regionId];
    if (contents === undefined) return;
    const index = contents.indexOf(value);
    if (index >= 0) contents.splice(index, 1);
  }

  private setSlot(regionId: string, slotIndex: number, value: string): void {
    const slots = (this.world.regionSlots[regionId] ??= []);
    while (slots.length <= slotIndex) slots.push(null);
    slots[slotIndex] = value;
  }

  /**
   * A robot is "fully" in a zone when all of its support is inside, and
   * "partially" when only some is — the distinction DECODE draws for BASE
   * (§10.5.3) and a common shape in other games.
   */
  private setZoneOccupancy(zoneId: string, robotId: string, supportFraction: number): void {
    this.clearZoneOccupancy(zoneId, robotId);

    if (supportFraction >= 1) {
      (this.world.robotsFullyInZone[zoneId] ??= []).push(robotId);
    } else if (supportFraction > 0) {
      (this.world.robotsPartiallyInZone[zoneId] ??= []).push(robotId);
    }
  }

  private clearZoneOccupancy(zoneId: string, robotId: string): void {
    for (const map of [this.world.robotsFullyInZone, this.world.robotsPartiallyInZone]) {
      const list = map[zoneId];
      if (list === undefined) continue;
      const index = list.indexOf(robotId);
      if (index >= 0) list.splice(index, 1);
    }
  }
}
