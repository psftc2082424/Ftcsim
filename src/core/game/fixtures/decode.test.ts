import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_NOMINAL_DIAMETER_IN,
  DECODE_FOULS_ASSESSED_BY_REFEREE,
  DECODE_MATCH,
  DECODE_MOTIFS,
  DECODE_OBJECTIVES,
  DECODE_PENALTIES,
  DECODE_PIECES,
  DECODE_POINTS,
  DECODE_RANKING_POINT_RULES,
  DECODE_REGIONS,
  DECODE_RP_THRESHOLDS,
  DECODE_RP_THRESHOLD_STABILITY,
  DECODE_SCORING_RULES,
  DECODE_SETUP,
  DECODE_TOTAL_ARTIFACTS,
  DECODE_ZONES,
  RAMP_SLOT_COUNT,
} from './decode.js';
import {
  collectProvenance,
  definitionErrors,
  rankingPointsFor,
  totalStagedPieces,
  validateGameDefinition,
} from '../gameDefinition.js';
import { DECODE_GAME } from './decodeGame.js';
import { MatchRunner } from '../matchRunner.js';
import { createDefaultRegistry } from '../predicates.js';
import { validateRuleSet } from '../rulesEngine.js';
import { scoreBreakdown } from '../effects.js';
import {
  endgameStartSec,
  matchStateAt,
  scoringStateAt,
  totalMatchDurationSec,
} from '../matchStructure.js';
import { needsReview } from '../sourced.js';
import type { SimEvent } from '../events.js';

const DT = 1 / 200;

function newRunner(motif: string = DECODE_MOTIFS.GPP.pattern): MatchRunner {
  const runner = new MatchRunner({
    structure: DECODE_MATCH,
    rules: DECODE_SCORING_RULES,
    registry: createDefaultRegistry(),
    dtSec: DT,
    variables: { motif },
  });
  runner.declareSlottedRegion(DECODE_REGIONS.redRamp, RAMP_SLOT_COUNT.value);
  runner.declareSlottedRegion(DECODE_REGIONS.blueRamp, RAMP_SLOT_COUNT.value);
  return runner;
}

const enteredRegion = (
  pieceId: string,
  pieceType: string,
  regionId: string,
  tick: number,
  alliance: 'red' | 'blue',
): SimEvent => ({
  kind: 'PieceEnteredRegion',
  tick,
  timeSec: tick * DT,
  pieceId,
  pieceType,
  regionId,
  byAlliance: alliance,
});

const cameToRest = (
  pieceId: string,
  pieceType: string,
  regionIds: readonly string[],
  tick: number,
  slotIndex?: number,
): SimEvent => ({
  kind: 'PieceCameToRest',
  tick,
  timeSec: tick * DT,
  pieceId,
  pieceType,
  regionIds,
  slotIndex,
});

const robotZone = (
  kind: 'RobotEnteredZone' | 'RobotExitedZone' | 'RobotOverlapsZone',
  robotId: string,
  alliance: 'red' | 'blue',
  zoneId: string,
  tick: number,
  supportFraction?: number,
): SimEvent => ({
  kind,
  tick,
  timeSec: tick * DT,
  robotId,
  alliance,
  zoneId,
  supportFraction,
});

/**
 * The end-of-period assessment.
 *
 * §10.5.3 assesses both LEAVE and BASE on where a robot *finished*, so every
 * ROBOT award below is triggered by this rather than by the moment a robot
 * crossed a boundary. Zone events are still ingested first, because they are
 * what tells the runner where each robot is.
 */
const robotAssessed = (
  robotId: string,
  alliance: 'red' | 'blue',
  tick: number,
): SimEvent => ({
  kind: 'RobotAssessed',
  tick,
  timeSec: tick * DT,
  robotId,
  alliance,
});

describe('DECODE fixture — manual provenance', () => {
  it('cites the manual for every point value', () => {
    for (const [name, value] of Object.entries(DECODE_POINTS)) {
      expect(value.confidence, name).toBe('explicit');
      expect(value.sourceQuote, name).toBeDefined();
    }
  });

  it('records the ARTIFACT specification as printed', () => {
    // §9.9: nominal 5 in, manufacturer spec 4.9 in +/- 0.25 in.
    expect(ARTIFACT_NOMINAL_DIAMETER_IN.value).toBe(5);
    expect(DECODE_PIECES.every((p) => p.diameterIn.value === 4.9)).toBe(true);
  });

  it('records the ARTIFACT counts from the manual', () => {
    const green = DECODE_PIECES.find((p) => p.id === 'G');
    const purple = DECODE_PIECES.find((p) => p.id === 'P');
    expect(green?.count.value).toBe(12);
    expect(purple?.count.value).toBe(24);
    expect(DECODE_TOTAL_ARTIFACTS.value).toBe(36);
    expect((green?.count.value ?? 0) + (purple?.count.value ?? 0)).toBe(
      DECODE_TOTAL_ARTIFACTS.value,
    );
  });

  it('marks cycle-time estimates as assumed, since the manual never states them', () => {
    for (const objective of DECODE_OBJECTIVES) {
      if (objective.estimatedCycleSec === undefined) continue;
      expect(objective.estimatedCycleSec.confidence, objective.id).toBe('assumed');
      expect(needsReview(objective.estimatedCycleSec), objective.id).toBe(true);
    }
  });
});

describe('DECODE match timing', () => {
  /** §10.4: 30 s AUTO, 8 s transition, 2:00 TELEOP. */
  it('is 158 seconds long, not 150', () => {
    expect(totalMatchDurationSec(DECODE_MATCH)).toBe(158);
  });

  it('models the 8-second AUTO-to-TELEOP delay', () => {
    expect(matchStateAt(DECODE_MATCH, 29.9)).toBe('AUTO');
    // Its own state, not "before the match" — see the scoring test below.
    expect(matchStateAt(DECODE_MATCH, 30)).toBe('TRANSITION');
    expect(matchStateAt(DECODE_MATCH, 37.9)).toBe('TRANSITION');
    expect(matchStateAt(DECODE_MATCH, 38)).toBe('TELEOP');
  });

  /**
   * §10.5 A: "ARTIFACTS that meet scoring criteria prior to the start of TELEOP
   * are assessed as part of AUTO."
   *
   * The gap is dead time for the robots but not for the score: an artifact
   * launched at 0:29 and still rolling at 0:31 scores, and scores as AUTO. The
   * gap was previously reported as `PRE`, so anything settling in it scored
   * nothing at all.
   */
  it('scores the transition gap as AUTO', () => {
    expect(DECODE_MATCH.transitionScoresAs?.value).toBe('AUTO');
    expect(scoringStateAt(DECODE_MATCH, 30)).toBe('AUTO');
    expect(scoringStateAt(DECODE_MATCH, 37.9)).toBe('AUTO');
    expect(scoringStateAt(DECODE_MATCH, 38)).toBe('TELEOP');
  });

  it('scores nothing in a gap the game has not attributed', () => {
    // The safe default: a structure that does not say gets no points rather
    // than points attributed to a period it never named.
    const { transitionScoresAs: _unused, ...silent } = DECODE_MATCH;
    expect(scoringStateAt(silent, 33)).toBeNull();
  });

  /**
   * The word ENDGAME does not appear anywhere in the DECODE manual. BASE is
   * assessed at the end of TELEOP, so the sub-phase never opens — which is
   * exactly what a zero threshold means.
   */
  it('has no endgame at all', () => {
    expect(DECODE_MATCH.periods[1].subPhases[0].startsAtRemainingSec.value).toBe(0);
    expect(endgameStartSec(DECODE_MATCH)).toBe(totalMatchDurationSec(DECODE_MATCH));
    expect(matchStateAt(DECODE_MATCH, 157.9)).toBe('TELEOP');
    expect(matchStateAt(DECODE_MATCH, 158)).toBe('POST');
  });
});

describe('DECODE rule set integrity', () => {
  it('is fully resolvable by the default predicate registry', () => {
    expect(validateRuleSet(DECODE_SCORING_RULES, createDefaultRegistry())).toEqual([]);
  });

  it('contains no executable content', () => {
    const serialised = JSON.stringify(DECODE_SCORING_RULES);
    expect(serialised).not.toMatch(/function|=>|eval\(|require\(/);
  });

  it('generates nine PATTERN rules per alliance per phase', () => {
    const patternRules = DECODE_SCORING_RULES.filter((r) => r.id.includes('-pattern-'));
    // 9 slots x 2 alliances x 2 phases.
    expect(patternRules).toHaveLength(RAMP_SLOT_COUNT.value * 4);
  });
});

describe('DECODE scoring — ARTIFACTS', () => {
  it('awards 3 for a CLASSIFIED artifact in AUTO', () => {
    const runner = newRunner();
    runner.ingest(enteredRegion('a1', 'G', DECODE_REGIONS.redRamp, 10, 'red'));
    expect(runner.score.red).toBe(DECODE_POINTS.classifiedAuto.value);
  });

  it('awards 1 for an OVERFLOW artifact', () => {
    const runner = newRunner();
    runner.ingest(enteredRegion('a1', 'P', DECODE_REGIONS.redOverflow, 10, 'red'));
    expect(runner.score.red).toBe(DECODE_POINTS.overflowAuto.value);
  });

  /** §10.5.1: a piece scores once, however many times it re-enters. */
  it('does not score the same artifact twice', () => {
    const runner = newRunner();
    runner.ingest(enteredRegion('a1', 'G', DECODE_REGIONS.redRamp, 10, 'red'));
    runner.ingest(enteredRegion('a1', 'G', DECODE_REGIONS.redRamp, 20, 'red'));
    expect(runner.score.red).toBe(3);
  });

  it('scores distinct artifacts separately', () => {
    const runner = newRunner();
    runner.ingest(enteredRegion('a1', 'G', DECODE_REGIONS.redRamp, 10, 'red'));
    runner.ingest(enteredRegion('a2', 'P', DECODE_REGIONS.redRamp, 20, 'red'));
    expect(runner.score.red).toBe(6);
  });

  it('keeps alliances separate', () => {
    const runner = newRunner();
    runner.ingest(enteredRegion('a1', 'G', DECODE_REGIONS.redRamp, 10, 'red'));
    runner.ingest(enteredRegion('b1', 'G', DECODE_REGIONS.blueRamp, 11, 'blue'));
    expect(runner.score.red).toBe(3);
    expect(runner.score.blue).toBe(3);
  });

  it('scores CLASSIFIED at the same value in TELEOP', () => {
    const runner = newRunner();
    runner.advanceTo(40); // into TELEOP
    runner.ingest(enteredRegion('a1', 'G', DECODE_REGIONS.redRamp, 8000, 'red'));
    expect(runner.score.red).toBe(DECODE_POINTS.classifiedTeleop.value);
  });

  /**
   * §10.5 A: "ARTIFACTS that meet scoring criteria prior to the start of TELEOP
   * are assessed as part of AUTO."
   *
   * An earlier version of this test asserted the gap scored nothing, reading
   * §10.5's "achievements scored ... during the AUTO-to-TELEOP transition ...
   * are subject to penalties" as "are worth no points". It says the opposite:
   * the achievement counts, and a referee may *also* assess a penalty — which
   * this simulator does not model (ASSUMPTIONS.md §10.13). The 8 seconds exist
   * precisely so an artifact still in the air at 0:30 lands and scores.
   */
  it('scores an artifact settling in the AUTO-to-TELEOP gap as AUTO', () => {
    const runner = newRunner();
    runner.advanceTo(33);
    runner.ingest(enteredRegion('a1', 'G', DECODE_REGIONS.redRamp, 6600, 'red'));

    const breakdown = scoreBreakdown(runner.score, 'red');
    expect(breakdown['red-classified-auto']).toBe(DECODE_POINTS.classifiedAuto.value);
    expect(breakdown['red-classified-teleop']).toBeUndefined();
  });
});

describe('DECODE scoring — PATTERN', () => {
  /**
   * §10.5.2: the MOTIF repeats three times across nine RAMP indices. With motif
   * GPP, a perfect ramp is G P P G P P G P P and every slot scores 2.
   */
  it('scores every slot when the ramp matches the motif exactly', () => {
    const runner = newRunner('GPP');
    const perfect = 'GPPGPPGPP';

    for (let slot = 0; slot < 9; slot++) {
      runner.ingest(
        cameToRest(`a${slot}`, perfect[slot] as string, [DECODE_REGIONS.redRamp], 10 + slot, slot),
      );
    }
    runner.advanceTo(31); // end of AUTO

    const patternPoints = scoreBreakdown(runner.score, 'red');
    const total = Object.entries(patternPoints)
      .filter(([id]) => id.includes('-pattern-auto-'))
      .reduce((sum, [, points]) => sum + points, 0);

    expect(total).toBe(9 * DECODE_POINTS.patternAuto.value);
  });

  it('scores only the matching slots when the ramp is wrong', () => {
    const runner = newRunner('GPP');
    // Slots 0 and 1 correct (G, P); slot 2 should be P but holds G.
    const ramp = ['G', 'P', 'G'];

    ramp.forEach((type, slot) => {
      runner.ingest(cameToRest(`a${slot}`, type, [DECODE_REGIONS.redRamp], 10 + slot, slot));
    });
    runner.advanceTo(31);

    const awarded = Object.entries(scoreBreakdown(runner.score, 'red')).filter(([id]) =>
      id.includes('-pattern-auto-'),
    );
    expect(awarded).toHaveLength(2);
  });

  it('follows the motif, so a different motif scores a different ramp', () => {
    const runner = newRunner('PGP');
    // Correct for PGP, wrong for GPP.
    ['P', 'G', 'P'].forEach((type, slot) => {
      runner.ingest(cameToRest(`a${slot}`, type, [DECODE_REGIONS.redRamp], 10 + slot, slot));
    });
    runner.advanceTo(31);

    const awarded = Object.entries(scoreBreakdown(runner.score, 'red')).filter(([id]) =>
      id.includes('-pattern-auto-'),
    );
    expect(awarded).toHaveLength(3);
  });

  it('scores nothing for an empty ramp', () => {
    const runner = newRunner('GPP');
    runner.advanceTo(31);
    expect(runner.score.red).toBe(0);
  });
});

describe('DECODE scoring — ROBOT criteria', () => {
  it('awards 3 per robot for LEAVE, capped at two robots', () => {
    const runner = newRunner();
    // No zone events, so no robot has support on any LAUNCH LINE.
    runner.ingest(robotAssessed('r1', 'red', 100));
    runner.ingest(robotAssessed('r2', 'red', 100));
    // A third robot cannot exist on an alliance; the cap must hold anyway.
    runner.ingest(robotAssessed('r3', 'red', 100));

    expect(runner.score.red).toBe(2 * DECODE_POINTS.leaveAuto.value);
  });

  /**
   * §10.5.3 asks where the robot is at the end of AUTO, not whether it ever
   * left. The earlier implementation triggered on the exit itself, so a robot
   * that drove out and came back still scored.
   */
  it('withholds LEAVE from a robot that returned to a LAUNCH LINE', () => {
    const runner = newRunner();
    runner.ingest(robotZone('RobotEnteredZone', 'r1', 'red', DECODE_ZONES.goalLaunchZone, 50, 1));
    runner.ingest(robotZone('RobotExitedZone', 'r1', 'red', DECODE_ZONES.goalLaunchZone, 100));
    runner.ingest(robotZone('RobotEnteredZone', 'r1', 'red', DECODE_ZONES.goalLaunchZone, 150, 1));
    runner.ingest(robotAssessed('r1', 'red', 200));

    expect(runner.score.red).toBe(0);
  });

  /**
   * "no longer over **any** LAUNCH LINE" — there are two LAUNCH ZONES and both
   * belong to the FIELD rather than to an alliance (§9.3), so a red robot
   * parked on the audience-side one has not left either.
   */
  it('withholds LEAVE from a robot sitting on the other LAUNCH LINE', () => {
    const runner = newRunner();
    runner.ingest(robotZone('RobotEnteredZone', 'r1', 'red', DECODE_ZONES.audienceLaunchZone, 50, 1));
    runner.ingest(robotAssessed('r1', 'red', 200));

    expect(runner.score.red).toBe(0);
  });

  /** Partial support still counts as "over" the line. */
  it('withholds LEAVE from a robot only partly over a LAUNCH LINE', () => {
    const runner = newRunner();
    runner.ingest(
      robotZone('RobotOverlapsZone', 'r1', 'red', DECODE_ZONES.goalLaunchZone, 50, 0.25),
    );
    runner.ingest(robotAssessed('r1', 'red', 200));

    expect(runner.score.red).toBe(0);
  });

  it('awards 10 for a fully returned robot and 5 for a partial one', () => {
    const runner = newRunner();
    runner.advanceTo(40);

    // "If all of the support of the ROBOT in the BASE ZONE is from the TILE in
    // the BASE ZONE, the ROBOT is fully returned to BASE." (§10.5.3)
    runner.ingest(robotZone('RobotOverlapsZone', 'r1', 'red', DECODE_ZONES.redBase, 8000, 1));
    runner.ingest(robotAssessed('r1', 'red', 8000));
    expect(runner.score.red).toBe(DECODE_POINTS.baseFull.value);

    runner.ingest(robotZone('RobotOverlapsZone', 'r2', 'red', DECODE_ZONES.redBase, 8100, 0.5));
    runner.ingest(robotAssessed('r2', 'red', 8100));
    expect(runner.score.red).toBe(
      DECODE_POINTS.baseFull.value + DECODE_POINTS.basePartial.value,
    );
  });

  /** §10.5.3: no support from the BASE tile means not returned at all. */
  it('awards nothing for a robot with no support in BASE', () => {
    const runner = newRunner();
    runner.advanceTo(40);
    runner.ingest(robotZone('RobotOverlapsZone', 'r1', 'red', DECODE_ZONES.redBase, 8000, 0));
    runner.ingest(robotAssessed('r1', 'red', 8000));
    expect(runner.score.red).toBe(0);
  });

  /**
   * BASE is assessed on the final position, so touching it mid-match earns
   * nothing. The earlier implementation triggered on the crossing itself.
   */
  it('awards nothing for a robot that visited BASE and drove away', () => {
    const runner = newRunner();
    runner.advanceTo(40);
    runner.ingest(robotZone('RobotOverlapsZone', 'r1', 'red', DECODE_ZONES.redBase, 8000, 1));
    runner.ingest(robotZone('RobotExitedZone', 'r1', 'red', DECODE_ZONES.redBase, 8200));
    runner.ingest(robotAssessed('r1', 'red', 8400));

    expect(runner.score.red).toBe(0);
  });

  it('awards the 10-point bonus only when both robots are fully returned', () => {
    const runner = newRunner();
    runner.advanceTo(40);
    runner.ingest(robotZone('RobotOverlapsZone', 'r1', 'red', DECODE_ZONES.redBase, 8000, 1));
    runner.ingest(robotZone('RobotOverlapsZone', 'r2', 'red', DECODE_ZONES.redBase, 8100, 1));
    runner.ingest(robotAssessed('r1', 'red', 8200));
    runner.ingest(robotAssessed('r2', 'red', 8200));
    runner.runToCompletion();

    const breakdown = scoreBreakdown(runner.score, 'red');
    expect(breakdown['red-base-bonus']).toBe(DECODE_POINTS.baseBothBonus.value);
    // 10 + 10 + 10 bonus.
    expect(runner.score.red).toBe(30);
  });

  it('withholds the bonus when only one robot is fully returned', () => {
    const runner = newRunner();
    runner.advanceTo(40);
    runner.ingest(robotZone('RobotOverlapsZone', 'r1', 'red', DECODE_ZONES.redBase, 8000, 1));
    runner.ingest(robotZone('RobotOverlapsZone', 'r2', 'red', DECODE_ZONES.redBase, 8100, 0.4));
    runner.ingest(robotAssessed('r1', 'red', 8200));
    runner.ingest(robotAssessed('r2', 'red', 8200));
    runner.runToCompletion();

    expect(scoreBreakdown(runner.score, 'red')['red-base-bonus']).toBeUndefined();
    expect(runner.score.red).toBe(15);
  });

  it('drops the award if a robot leaves BASE before the match ends', () => {
    const runner = newRunner();
    runner.advanceTo(40);
    runner.ingest(robotZone('RobotOverlapsZone', 'r1', 'red', DECODE_ZONES.redBase, 8000, 1));
    runner.ingest(robotZone('RobotOverlapsZone', 'r2', 'red', DECODE_ZONES.redBase, 8100, 1));
    // r2 drives away before the buzzer, so the bonus condition fails at assessment.
    runner.ingest(robotZone('RobotExitedZone', 'r2', 'red', DECODE_ZONES.redBase, 8200));
    runner.runToCompletion();

    expect(scoreBreakdown(runner.score, 'red')['red-base-bonus']).toBeUndefined();
  });
});

describe('DECODE scoring — DEPOT', () => {
  it('awards 1 per artifact resting over the DEPOT', () => {
    const runner = newRunner();
    runner.advanceTo(40);
    runner.ingest(cameToRest('a1', 'G', [DECODE_REGIONS.redDepot], 8000));
    runner.ingest(cameToRest('a2', 'P', [DECODE_REGIONS.redDepot], 8010));

    expect(runner.score.red).toBe(2 * DECODE_POINTS.depotTeleop.value);
  });

  /** §10.5.1: DEPOT points go to the owning alliance regardless of who placed them. */
  it('credits the owning alliance regardless of who placed the artifact', () => {
    const runner = newRunner();
    runner.advanceTo(40);
    runner.ingest(cameToRest('a1', 'G', [DECODE_REGIONS.blueDepot], 8000));

    expect(runner.score.blue).toBe(DECODE_POINTS.depotTeleop.value);
    expect(runner.score.red).toBe(0);
  });
});

describe('match staging (§10.3.1)', () => {
  /**
   * The reconciliation that makes the transcription trustworthy: staging is
   * given per location, piece counts are given in §9.9, and the two were
   * transcribed from different pages. They add up exactly.
   */
  it('stages exactly the 24 purple and 12 green the manual declares', () => {
    expect(totalStagedPieces(DECODE_SETUP)).toEqual({ P: 24, G: 12 });
  });

  it('is accepted by the definition cross-check', () => {
    const problems = validateGameDefinition(DECODE_GAME, createDefaultRegistry());
    expect(problems.filter((p) => p.where.startsWith('setup'))).toEqual([]);
  });

  /** A dropped group is exactly the error the cross-check exists to catch. */
  it('rejects a definition whose staging does not add up', () => {
    const short = {
      ...DECODE_GAME,
      setup: { ...DECODE_SETUP, staging: DECODE_SETUP.staging.slice(1) },
    };
    const errors = definitionErrors(validateGameDefinition(short, createDefaultRegistry()));
    expect(errors.some((p) => p.where === 'setup')).toBe(true);
  });

  it('puts the three MOTIFS on the three SPIKE MARK rows', () => {
    const rows = DECODE_SETUP.staging.filter((g) => g.id.startsWith('spike-'));
    expect(rows.map((g) => g.arrangement?.value.join(''))).toEqual(['GPP', 'PGP', 'PPG']);
    // Six marks in three rows of two — §9.3 gives six, §10.3.1 gives the rows.
    expect(rows.map((g) => g.locationCount.value)).toEqual([2, 2, 2]);
  });

  /** "with no set order" is a fact, so the ALLIANCE AREA has no arrangement. */
  it('records the ALLIANCE AREA as a composition, not an order', () => {
    const area = DECODE_SETUP.staging.find((g) => g.id === 'alliance-area');
    expect(area?.arrangement).toBeUndefined();
    expect(area?.composition?.value).toEqual({ P: 4, G: 2 });
  });

  it('records the pre-load allowance', () => {
    expect(DECODE_SETUP.maxPreloadPerRobot?.value).toBe(3);
  });
});

describe('citation contract', () => {
  /**
   * What a *test* can check without the PDF.
   *
   * `tools/verify-citations.mjs` checks each quote against the manual itself,
   * but it needs a 188-page PDF and an extractor, so it is a tool a human runs
   * after transcribing. These assertions guard the shape a citation must have,
   * which is what makes that tool able to check it at all — and they encode the
   * conventions the first run of that tool established.
   */
  const cited = collectProvenance(DECODE_GAME).filter((e) => e.confidence === 'explicit');

  it('gives every explicit value a page or a rule', () => {
    const uncited = cited.filter((e) => e.sourcePage === undefined && e.sourceRule === undefined);
    expect(uncited.map((e) => e.path)).toEqual([]);
  });

  it('gives every explicit value a quote to check', () => {
    const unquoted = cited.filter((e) => (e.sourceQuote ?? '').trim().length === 0);
    expect(unquoted.map((e) => e.path)).toEqual([]);
  });

  /**
   * A reconstructed table row reads like a quotation but is not one, and no
   * verifier can find it in the source. Values read out of a table quote the
   * row as printed and name the column in `note` instead.
   */
  it('has no quote that reconstructs a table row', () => {
    const reconstructed = cited.filter((e) => (e.sourceQuote ?? '').includes(' | '));
    expect(reconstructed.map((e) => e.path)).toEqual([]);
  });

  /** Cited pages must exist in the document that was transcribed. */
  it('cites pages inside the manual', () => {
    const outOfRange = cited.filter(
      (e) => e.sourcePage !== undefined && (e.sourcePage < 1 || e.sourcePage > 188),
    );
    expect(outOfRange.map((e) => e.path)).toEqual([]);
  });
});

describe('DECODE ranking points (Tables 10-2 and 10-3)', () => {
  it('transcribes every threshold in Table 10-3', () => {
    // Read straight off p.88: three criteria x three event tiers.
    expect(DECODE_RP_THRESHOLDS.firstChampionship.movement.value).toBe(21);
    expect(DECODE_RP_THRESHOLDS.firstChampionship.goal.value).toBe(67);
    expect(DECODE_RP_THRESHOLDS.firstChampionship.pattern.value).toBe(22);

    expect(DECODE_RP_THRESHOLDS.regionalChampionship.movement.value).toBe(21);
    expect(DECODE_RP_THRESHOLDS.regionalChampionship.goal.value).toBe(42);
    expect(DECODE_RP_THRESHOLDS.regionalChampionship.pattern.value).toBe(22);

    expect(DECODE_RP_THRESHOLDS.other.movement.value).toBe(16);
    expect(DECODE_RP_THRESHOLDS.other.goal.value).toBe(36);
    expect(DECODE_RP_THRESHOLDS.other.pattern.value).toBe(18);
  });

  it('cites the manual for every threshold', () => {
    for (const [tier, criteria] of Object.entries(DECODE_RP_THRESHOLDS)) {
      for (const [name, value] of Object.entries(criteria)) {
        expect(value.confidence, `${tier}.${name}`).toBe('explicit');
        expect(value.sourcePage, `${tier}.${name}`).toBe(88);
      }
    }
  });

  it('awards nothing below every threshold', () => {
    const rp = rankingPointsFor(
      DECODE_RANKING_POINT_RULES,
      'other',
      { movement: 15, goal: 35, pattern: 17 },
      'loss',
    );
    expect(rp).toBe(0);
  });

  it('awards at the threshold, which is inclusive', () => {
    const rp = rankingPointsFor(
      DECODE_RANKING_POINT_RULES,
      'other',
      { movement: 16, goal: 36, pattern: 18 },
    );
    expect(rp).toBe(3);
  });

  /** The same performance is worth fewer RP at a Championship. */
  it('scores the same match differently by event tier', () => {
    const totals = { movement: 20, goal: 50, pattern: 20 };

    expect(rankingPointsFor(DECODE_RANKING_POINT_RULES, 'other', totals)).toBe(3);
    expect(rankingPointsFor(DECODE_RANKING_POINT_RULES, 'regionalChampionship', totals)).toBe(1);
    expect(rankingPointsFor(DECODE_RANKING_POINT_RULES, 'firstChampionship', totals)).toBe(0);
  });

  it('adds the outcome ranking points', () => {
    const none = { movement: 0, goal: 0, pattern: 0 };
    expect(rankingPointsFor(DECODE_RANKING_POINT_RULES, 'other', none, 'win')).toBe(3);
    expect(rankingPointsFor(DECODE_RANKING_POINT_RULES, 'other', none, 'tie')).toBe(1);
    expect(rankingPointsFor(DECODE_RANKING_POINT_RULES, 'other', none, 'loss')).toBe(0);
  });

  /** A default tier would quietly score a Championship against the low bar. */
  it('throws on an unknown event tier rather than defaulting', () => {
    expect(() =>
      rankingPointsFor(DECODE_RANKING_POINT_RULES, 'premier', { movement: 99 }),
    ).toThrow(/no threshold for tier "premier"/);
  });

  it('records that two of the three tiers are provisional', () => {
    expect(DECODE_RP_THRESHOLD_STABILITY.value).toBe(false);
    expect(DECODE_RP_THRESHOLD_STABILITY.sourceQuote).toContain('announced in Team Updates');
  });
});

describe('DECODE penalties (Table 10-4)', () => {
  it('transcribes the foul values', () => {
    expect(DECODE_PENALTIES.minorToOpponent.value).toBe(5);
    expect(DECODE_PENALTIES.majorToOpponent.value).toBe(15);
  });

  it('states the fouls credit the opponent rather than deducting', () => {
    expect(DECODE_PENALTIES.minorToOpponent.sourceQuote).toContain("opponent's MATCH point total");
    expect(DECODE_PENALTIES.majorToOpponent.sourceQuote).toContain("opponent's MATCH point total");
  });

  /**
   * No rule in the set assesses a foul, and that is a deliberate limit: every
   * DECODE violation is a referee's call, not a geometric fact.
   */
  it('has no rule that assesses a foul', () => {
    const penalising = DECODE_SCORING_RULES.filter(
      (rule) => rule.id.includes('foul') || rule.id.includes('penalty'),
    );
    expect(penalising).toEqual([]);
    expect(DECODE_FOULS_ASSESSED_BY_REFEREE.value).toBe(true);
  });
});

describe('DECODE — full match end to end', () => {
  /**
   * A complete scripted match, scored from simulated actions alone. Every number
   * below is traceable to Table 10-2.
   */
  it('scores a realistic match correctly', () => {
    const runner = newRunner('GPP');

    // --- AUTO -------------------------------------------------------------
    runner.advanceTo(1);
    // Both robots start on the launch line and drive off it: 2 x 3 = 6, awarded
    // at the end-of-AUTO assessment rather than at the crossing (§10.5.3).
    runner.ingest(robotZone('RobotEnteredZone', 'r1', 'red', DECODE_ZONES.goalLaunchZone, 10, 1));
    runner.ingest(robotZone('RobotEnteredZone', 'r2', 'red', DECODE_ZONES.goalLaunchZone, 10, 1));
    runner.ingest(robotZone('RobotExitedZone', 'r1', 'red', DECODE_ZONES.goalLaunchZone, 200));
    runner.ingest(robotZone('RobotExitedZone', 'r2', 'red', DECODE_ZONES.goalLaunchZone, 220));

    // Three CLASSIFIED artifacts landing in ramp slots 0-2: 3 x 3 = 9.
    ['G', 'P', 'P'].forEach((type, slot) => {
      runner.ingest(enteredRegion(`a${slot}`, type, DECODE_REGIONS.redRamp, 300 + slot, 'red'));
      runner.ingest(
        cameToRest(`a${slot}`, type, [DECODE_REGIONS.redRamp], 400 + slot, slot),
      );
    });

    // End of AUTO: LEAVE is assessed here, and PATTERN scores 3 slots x 2 = 6.
    runner.ingest(robotAssessed('r1', 'red', 5900));
    runner.ingest(robotAssessed('r2', 'red', 5900));
    runner.advanceTo(31);

    const afterAuto = runner.score.red;
    expect(afterAuto).toBe(6 + 9 + 6);

    // --- TELEOP -----------------------------------------------------------
    runner.advanceTo(40);

    // Two more CLASSIFIED into slots 3-4: 2 x 3 = 6.
    ['G', 'P'].forEach((type, index) => {
      const slot = 3 + index;
      runner.ingest(enteredRegion(`b${slot}`, type, DECODE_REGIONS.redRamp, 8000 + slot, 'red'));
      runner.ingest(cameToRest(`b${slot}`, type, [DECODE_REGIONS.redRamp], 8100 + slot, slot));
    });

    // One OVERFLOW: 1.
    runner.ingest(enteredRegion('c1', 'P', DECODE_REGIONS.redOverflow, 8200, 'red'));

    // Two artifacts in the DEPOT: 2 x 1 = 2.
    runner.ingest(cameToRest('d1', 'G', [DECODE_REGIONS.redDepot], 8300));
    runner.ingest(cameToRest('d2', 'P', [DECODE_REGIONS.redDepot], 8310));

    // Both robots return fully to BASE: 10 + 10, plus the 10 bonus.
    runner.ingest(robotZone('RobotOverlapsZone', 'r1', 'red', DECODE_ZONES.redBase, 31000, 1));
    runner.ingest(robotZone('RobotOverlapsZone', 'r2', 'red', DECODE_ZONES.redBase, 31100, 1));
    runner.ingest(robotAssessed('r1', 'red', 31200));
    runner.ingest(robotAssessed('r2', 'red', 31200));

    runner.runToCompletion();

    // End of TELEOP: ramp holds G P P G P against motif GPPGP -> all 5 match.
    // PATTERN teleop = 5 x 2 = 10.
    const breakdown = scoreBreakdown(runner.score, 'red');
    const teleopPattern = Object.entries(breakdown)
      .filter(([id]) => id.includes('-pattern-teleop-'))
      .reduce((sum, [, points]) => sum + points, 0);
    expect(teleopPattern).toBe(10);

    // 21 (auto) + 6 classified + 1 overflow + 2 depot + 30 base + 10 pattern.
    expect(runner.score.red).toBe(21 + 6 + 1 + 2 + 30 + 10);
    expect(runner.score.blue).toBe(0);
    expect(runner.isFinished).toBe(true);
  });

  /** Deterministic replay: the same script must produce the same score. */
  it('replays deterministically', () => {
    const play = (): number => {
      const runner = newRunner('PGP');
      runner.advanceTo(1);
      runner.ingest(robotZone('RobotExitedZone', 'r1', 'red', DECODE_ZONES.goalLaunchZone, 200));
      ['P', 'G', 'P'].forEach((type, slot) => {
        runner.ingest(enteredRegion(`a${slot}`, type, DECODE_REGIONS.redRamp, 300 + slot, 'red'));
        runner.ingest(cameToRest(`a${slot}`, type, [DECODE_REGIONS.redRamp], 400 + slot, slot));
      });
      runner.ingest(robotAssessed('r1', 'red', 5900));
      runner.runToCompletion();
      return runner.score.red;
    };

    const first = play();
    for (let i = 0; i < 5; i++) expect(play()).toBe(first);
    // 3 leave + 9 classified + 6 auto pattern + 6 teleop pattern.
    expect(first).toBe(24);
  });

  it('produces an auditable breakdown that sums to the score', () => {
    const runner = newRunner();
    runner.advanceTo(1);
    runner.ingest(robotZone('RobotExitedZone', 'r1', 'red', DECODE_ZONES.goalLaunchZone, 200));
    runner.ingest(enteredRegion('a1', 'G', DECODE_REGIONS.redRamp, 300, 'red'));
    runner.ingest(robotAssessed('r1', 'red', 5900));
    runner.runToCompletion();

    const breakdown = scoreBreakdown(runner.score, 'red');
    const summed = Object.values(breakdown).reduce((a, b) => a + b, 0);
    expect(summed).toBe(runner.score.red);
    expect(breakdown['red-leave']).toBe(3);
    expect(breakdown['red-classified-auto']).toBe(3);
  });
});
