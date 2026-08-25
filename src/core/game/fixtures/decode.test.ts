import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_NOMINAL_DIAMETER_IN,
  DECODE_MATCH,
  DECODE_MOTIFS,
  DECODE_OBJECTIVES,
  DECODE_PIECES,
  DECODE_POINTS,
  DECODE_REGIONS,
  DECODE_SCORING_RULES,
  DECODE_TOTAL_ARTIFACTS,
  DECODE_ZONES,
  RAMP_SLOT_COUNT,
} from './decode.js';
import { MatchRunner } from '../matchRunner.js';
import { createDefaultRegistry } from '../predicates.js';
import { validateRuleSet } from '../rulesEngine.js';
import { scoreBreakdown } from '../effects.js';
import {
  endgameStartSec,
  matchStateAt,
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
    // The transition gap is not a scoring period.
    expect(matchStateAt(DECODE_MATCH, 30)).toBe('PRE');
    expect(matchStateAt(DECODE_MATCH, 37.9)).toBe('PRE');
    expect(matchStateAt(DECODE_MATCH, 38)).toBe('TELEOP');
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

  it('does not score artifacts during the AUTO-to-TELEOP gap', () => {
    // The gap is not a scoring phase; §10.5 notes such achievements are subject
    // to penalties rather than points.
    const runner = newRunner();
    runner.advanceTo(33);
    runner.ingest(enteredRegion('a1', 'G', DECODE_REGIONS.redRamp, 6600, 'red'));
    expect(runner.score.red).toBe(0);
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
    runner.ingest(robotZone('RobotExitedZone', 'r1', 'red', DECODE_ZONES.redLaunchLine, 100));
    runner.ingest(robotZone('RobotExitedZone', 'r2', 'red', DECODE_ZONES.redLaunchLine, 110));
    // A third robot cannot exist on an alliance; the cap must hold anyway.
    runner.ingest(robotZone('RobotExitedZone', 'r3', 'red', DECODE_ZONES.redLaunchLine, 120));

    expect(runner.score.red).toBe(2 * DECODE_POINTS.leaveAuto.value);
  });

  it('awards 10 for a fully returned robot and 5 for a partial one', () => {
    const runner = newRunner();
    runner.advanceTo(40);

    runner.ingest(robotZone('RobotOverlapsZone', 'r1', 'red', DECODE_ZONES.redBase, 8000, 1));
    expect(runner.score.red).toBe(DECODE_POINTS.baseFull.value);

    runner.ingest(robotZone('RobotOverlapsZone', 'r2', 'red', DECODE_ZONES.redBase, 8100, 0.5));
    expect(runner.score.red).toBe(
      DECODE_POINTS.baseFull.value + DECODE_POINTS.basePartial.value,
    );
  });

  /** §10.5.3: no support from the BASE tile means not returned at all. */
  it('awards nothing for a robot with no support in BASE', () => {
    const runner = newRunner();
    runner.advanceTo(40);
    runner.ingest(robotZone('RobotOverlapsZone', 'r1', 'red', DECODE_ZONES.redBase, 8000, 0));
    expect(runner.score.red).toBe(0);
  });

  it('awards the 10-point bonus only when both robots are fully returned', () => {
    const runner = newRunner();
    runner.advanceTo(40);
    runner.ingest(robotZone('RobotOverlapsZone', 'r1', 'red', DECODE_ZONES.redBase, 8000, 1));
    runner.ingest(robotZone('RobotOverlapsZone', 'r2', 'red', DECODE_ZONES.redBase, 8100, 1));
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

describe('DECODE — full match end to end', () => {
  /**
   * A complete scripted match, scored from simulated actions alone. Every number
   * below is traceable to Table 10-2.
   */
  it('scores a realistic match correctly', () => {
    const runner = newRunner('GPP');

    // --- AUTO -------------------------------------------------------------
    runner.advanceTo(1);
    // Both robots leave the launch line: 2 x 3 = 6.
    runner.ingest(robotZone('RobotExitedZone', 'r1', 'red', DECODE_ZONES.redLaunchLine, 200));
    runner.ingest(robotZone('RobotExitedZone', 'r2', 'red', DECODE_ZONES.redLaunchLine, 220));

    // Three CLASSIFIED artifacts landing in ramp slots 0-2: 3 x 3 = 9.
    ['G', 'P', 'P'].forEach((type, slot) => {
      runner.ingest(enteredRegion(`a${slot}`, type, DECODE_REGIONS.redRamp, 300 + slot, 'red'));
      runner.ingest(
        cameToRest(`a${slot}`, type, [DECODE_REGIONS.redRamp], 400 + slot, slot),
      );
    });

    // End of AUTO: PATTERN scores 3 matching slots x 2 = 6.
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
      runner.ingest(robotZone('RobotExitedZone', 'r1', 'red', DECODE_ZONES.redLaunchLine, 200));
      ['P', 'G', 'P'].forEach((type, slot) => {
        runner.ingest(enteredRegion(`a${slot}`, type, DECODE_REGIONS.redRamp, 300 + slot, 'red'));
        runner.ingest(cameToRest(`a${slot}`, type, [DECODE_REGIONS.redRamp], 400 + slot, slot));
      });
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
    runner.ingest(robotZone('RobotExitedZone', 'r1', 'red', DECODE_ZONES.redLaunchLine, 200));
    runner.ingest(enteredRegion('a1', 'G', DECODE_REGIONS.redRamp, 300, 'red'));
    runner.runToCompletion();

    const breakdown = scoreBreakdown(runner.score, 'red');
    const summed = Object.values(breakdown).reduce((a, b) => a + b, 0);
    expect(summed).toBe(runner.score.red);
    expect(breakdown['red-leave']).toBe(3);
    expect(breakdown['red-classified-auto']).toBe(3);
  });
});
