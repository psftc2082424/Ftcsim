/**
 * End-to-end DECODE match scenarios.
 *
 * Runs the real DECODE rule set through the whole pipeline — physics,
 * observations, events, rules, effects — and asserts scores computed from the
 * manual's own point values.
 *
 * ── What these scores do and do not mean ───────────────────────────────────
 *
 * The *rules* are transcribed from the manual and cited. The *field layout* is a
 * placeholder (`decodeField.ts`): the manual defers element positions to the
 * CAD model. So each assertion below verifies that the engine applies DECODE's
 * rules correctly to the positions it was given. None of them predicts what a
 * real match would score, and correcting the layout will change the physical
 * setups here without changing the rules being tested.
 */

import { describe, expect, it } from 'vitest';
import { MatchSimulation, type MatchSimulationOptions } from '../matchSimulation.js';
import { validateRuleSet } from '../rulesEngine.js';
import { createDefaultRegistry } from '../predicates.js';
import { validateRegions } from '../regions.js';
import { totalMatchDurationSec } from '../matchStructure.js';
import {
  DECODE_MATCH,
  DECODE_MOTIFS,
  DECODE_POINTS,
  DECODE_REGIONS,
  DECODE_SCORING_RULES,
  DECODE_ZONES,
  RAMP_SLOT_COUNT,
} from './decode.js';
import {
  DECODE_FIELD_REGIONS,
  DECODE_FIELD_ZONES,
  DECODE_LAYOUT_PROVENANCE,
  DECODE_SLOTTED_REGIONS,
  createRampSlotAssignment,
  layoutFitsField,
} from './decodeField.js';
import { DEFAULT_ROBOT_CONFIG, type RobotConfig } from '../../robot/robotConfig.js';
import type { RobotSpec, GamePieceSpec } from '../../sim/simWorld.js';
import { constantController } from '../../control/scripted.js';
import { createControlInput } from '../../control/controlInput.js';
import { NeutralController } from '../../control/controller.js';
import { inchesToMeters } from '../../units/convert.js';
import { vec2 } from '../../math/vec2.js';

const at = (xIn: number, yIn: number) => vec2(inchesToMeters(xIn), inchesToMeters(yIn));

/** A small robot, so an 18 in BASE ZONE can contain it fully. See the gap note. */
const SMALL_ROBOT: RobotConfig = {
  ...DEFAULT_ROBOT_CONFIG,
  chassis: { ...DEFAULT_ROBOT_CONFIG.chassis, lengthIn: 12, widthIn: 12 },
};

/**
 * Smaller still, because two robots cannot both fit fully inside an 18 in zone
 * at any realistic size — two 12 in robots placed side by side inside it
 * overlap and shove each other out.
 *
 * These dimensions are a probe for the *rule*, not a model of a robot. They
 * exist only because the sourced 18 in BASE ZONE is the same size as a legal
 * robot; see the gap note on what "fully returned to BASE" means in practice.
 */
const TINY_ROBOT: RobotConfig = {
  ...DEFAULT_ROBOT_CONFIG,
  chassis: { ...DEFAULT_ROBOT_CONFIG.chassis, lengthIn: 8, widthIn: 8 },
};

const idle = (
  alliance: 'red' | 'blue',
  xIn: number,
  yIn: number,
  config: RobotConfig = DEFAULT_ROBOT_CONFIG,
): RobotSpec => ({
  config,
  controller: new NeutralController(),
  alliance,
  startPose: { p: at(xIn, yIn), theta: 0 },
});

const driving = (
  alliance: 'red' | 'blue',
  xIn: number,
  yIn: number,
  drive: { x: number; y: number },
  config: RobotConfig = DEFAULT_ROBOT_CONFIG,
): RobotSpec => ({
  config,
  controller: constantController(createControlInput(drive.x, drive.y, 0)),
  alliance,
  startPose: { p: at(xIn, yIn), theta: 0 },
});

function decodeMatch(patch: Partial<MatchSimulationOptions> = {}): MatchSimulation {
  const slots = createRampSlotAssignment();

  return new MatchSimulation({
    structure: DECODE_MATCH,
    rules: DECODE_SCORING_RULES,
    regions: DECODE_FIELD_REGIONS,
    zones: DECODE_FIELD_ZONES,
    slottedRegions: DECODE_SLOTTED_REGIONS,
    slotAssignment: slots.assign,
    variables: { motif: DECODE_MOTIFS.GPP.pattern },
    robots: [idle('red', -64, 20)],
    ...patch,
  });
}

describe('DECODE definition integrity', () => {
  it('is honest that the layout is a placeholder', () => {
    expect(DECODE_LAYOUT_PROVENANCE.confidence).toBe('assumed');
    expect(DECODE_LAYOUT_PROVENANCE.note).toMatch(/invented/i);
  });

  it('keeps every placed element inside the field', () => {
    expect(layoutFitsField()).toBe(true);
  });

  it('has valid geometry', () => {
    expect(validateRegions(DECODE_FIELD_REGIONS)).toEqual([]);
    expect(validateRegions(DECODE_FIELD_ZONES.map((z) => ({ ...z })))).toEqual([]);
  });

  /** A rule citing a predicate this build lacks would silently never score. */
  it('resolves every rule against the default registry', () => {
    expect(validateRuleSet(DECODE_SCORING_RULES, createDefaultRegistry())).toEqual([]);
  });

  it('provides geometry for every region and zone the rules reference', () => {
    const placed = new Set([
      ...DECODE_FIELD_REGIONS.map((r) => r.id),
      ...DECODE_FIELD_ZONES.map((z) => z.id),
    ]);
    for (const id of [...Object.values(DECODE_REGIONS), ...Object.values(DECODE_ZONES)]) {
      expect(placed.has(id), `no geometry for ${id}`).toBe(true);
    }
  });

  it('runs a full 158 s match to POST', () => {
    // 30 s AUTO + 8 s transition + 120 s TELEOP, with no endgame.
    expect(totalMatchDurationSec(DECODE_MATCH)).toBe(158);

    const result = decodeMatch().run();
    expect(result.finalState).toBe('POST');
    expect(result.score.red).toBe(0);
    expect(result.score.blue).toBe(0);
  });
});

describe('LEAVE (§10.5, E)', () => {
  /** A robot that departs its LAUNCH LINE zone during AUTO scores LEAVE. */
  it('awards LEAVE when a robot exits the launch line in AUTO', () => {
    const result = decodeMatch({
      robots: [driving('red', -64, 20, { x: 1, y: 0 })],
    }).run();

    expect(result.score.red).toBe(DECODE_POINTS.leaveAuto.value);
    expect(result.score.red).toBe(3);
  });

  it('awards LEAVE once per robot, up to two robots', () => {
    const result = decodeMatch({
      robots: [driving('red', -64, 10, { x: 1, y: 0 }), driving('red', -64, 34, { x: 1, y: 0 })],
    }).run();

    expect(result.score.red).toBe(2 * DECODE_POINTS.leaveAuto.value);
  });

  it('does not award LEAVE for a robot that stays put', () => {
    expect(decodeMatch({ robots: [idle('red', -64, 20)] }).run().score.red).toBe(0);
  });

  it('credits the alliance that owns the robot', () => {
    const result = decodeMatch({
      robots: [driving('blue', 64, 20, { x: -1, y: 0 })],
    }).run();

    expect(result.score.blue).toBe(DECODE_POINTS.leaveAuto.value);
    expect(result.score.red).toBe(0);
  });
});

describe('CLASSIFIED and OVERFLOW (§10.5.1)', () => {
  const artifact = (pieceId: string, xIn: number, yIn: number, type = 'P'): GamePieceSpec => ({
    pieceId,
    pieceType: type,
    diameterIn: 5,
    massLb: 0.3,
    startPositionM: at(xIn, yIn),
  });

  /**
   * A robot pushes an artifact into the red RAMP: CLASSIFIED.
   *
   * The push runs *west*, away from blue's half. Pieces have no damping
   * (ASSUMPTIONS.md §5.5), so an artifact shoved east keeps sliding until it
   * reaches the far wall — passing through blue's ramp on the way and scoring
   * for blue, which is correct rule behaviour but not what this test is about.
   */
  it('awards CLASSIFIED when an artifact enters the ramp', () => {
    const result = decodeMatch({
      // Red ramp spans x -60..-44. Robot pushes the artifact west into it.
      robots: [driving('red', -30, 0, { x: -1, y: 0 })],
      pieces: [artifact('a1', -42, 0)],
    }).run();

    const breakdown = result.score.deltas.filter((d) => d.ruleId.includes('classified'));
    expect(breakdown.length).toBeGreaterThan(0);
    expect(result.score.red).toBeGreaterThanOrEqual(DECODE_POINTS.classifiedAuto.value);
  });

  it('scores an artifact once however long it sits in the ramp', () => {
    const result = decodeMatch({
      robots: [driving('red', -30, 0, { x: -1, y: 0 })],
      pieces: [artifact('a1', -42, 0)],
    }).run();

    const classified = result.score.deltas.filter((d) => d.ruleId === 'red-classified-auto');
    expect(classified).toHaveLength(1);
  });

  it('does not award the blue alliance for a red ramp', () => {
    const result = decodeMatch({
      robots: [driving('red', -30, 0, { x: -1, y: 0 })],
      pieces: [artifact('a1', -42, 0)],
    }).run();
    expect(result.score.blue).toBe(0);
  });

  it('scores nothing for an artifact that starts in the ramp', () => {
    // Pre-placed pieces are a baseline, not a scoring transition.
    const result = decodeMatch({ pieces: [artifact('a1', -52, 0)] }).run();
    expect(result.score.red).toBe(0);
  });
});

describe('BASE (§10.5, F and §10.5.3)', () => {
  /**
   * The 18 in BASE ZONE (§9.3) is the same size as a legal 18 in robot, so a
   * full-size robot can essentially never be *fully* inside it under corner
   * sampling. These use a 12 in robot to exercise both branches; see the gap
   * note about what "fully returned to BASE" means for a full-size robot.
   */
  const inBase = (alliance: 'red' | 'blue') =>
    idle(alliance, alliance === 'red' ? -60 : 60, -60, SMALL_ROBOT);

  it('awards a full BASE return for a robot finishing inside', () => {
    const result = decodeMatch({ robots: [inBase('red')] }).run();
    expect(result.score.red).toBe(DECODE_POINTS.baseFull.value);
    expect(result.score.red).toBe(10);
  });

  it('awards the two-robot bonus on top of both full returns', () => {
    // Base spans -69..-51 in. Two 8 in robots at -65 and -55 are each entirely
    // inside it with a gap between them.
    const result = decodeMatch({
      robots: [idle('red', -65, -60, TINY_ROBOT), idle('red', -55, -60, TINY_ROBOT)],
    }).run();

    // 10 + 10 for the robots, plus the 10 bonus for both being fully in.
    expect(result.score.red).toBe(
      2 * DECODE_POINTS.baseFull.value + DECODE_POINTS.baseBothBonus.value,
    );
    expect(result.score.red).toBe(30);
  });

  it('awards a partial return for a robot only half inside', () => {
    // Straddling the -51 in edge of the base zone.
    const result = decodeMatch({ robots: [idle('red', -51, -60, SMALL_ROBOT)] }).run();
    expect(result.score.red).toBe(DECODE_POINTS.basePartial.value);
    expect(result.score.red).toBe(5);
  });

  it('awards no bonus when only one robot is fully in', () => {
    const result = decodeMatch({
      // One entirely inside, one straddling the -51 in edge.
      robots: [idle('red', -60, -60, TINY_ROBOT), idle('red', -50, -60, TINY_ROBOT)],
    }).run();

    // One full (10) plus one partial (5); no bonus.
    expect(result.score.red).toBe(
      DECODE_POINTS.baseFull.value + DECODE_POINTS.basePartial.value,
    );
  });

  it('awards nothing for a robot nowhere near BASE', () => {
    expect(decodeMatch({ robots: [idle('red', 0, 0, SMALL_ROBOT)] }).run().score.red).toBe(0);
  });

  it('assesses BASE at the end of the match, not on arrival', () => {
    // A robot that starts in BASE and never moves still scores: the award comes
    // from end-of-period restatement, not from an entry transition.
    const result = decodeMatch({ robots: [inBase('red')] }).run();
    const baseAwards = result.score.deltas.filter((d) => d.ruleId.includes('base'));
    expect(baseAwards).toHaveLength(1);
    expect(baseAwards[0]?.tick).toBeGreaterThan(30 / 0.005);
  });
});

describe('PATTERN (§10.5.2)', () => {
  /**
   * The motif repeats across nine ramp slots. Slot assignment is arrival order,
   * so seeding the ramp in motif order should match every slot filled.
   */
  it('awards PATTERN for slots matching the motif', () => {
    const motif = DECODE_MOTIFS.GPP.pattern;
    const pieces: GamePieceSpec[] = Array.from({ length: 3 }, (_unused, i) => ({
      pieceId: `a${i}`,
      pieceType: motif[i] as string,
      diameterIn: 5,
      massLb: 0.3,
      // Spread along the ramp, which spans y -27..27 at x -52.
      startPositionM: at(-52, -12 + i * 8),
    }));

    const slots = createRampSlotAssignment();
    // Pre-seed arrival order so slot i holds piece i, matching the motif.
    for (let i = 0; i < pieces.length; i++) {
      slots.assign(`a${i}`, DECODE_REGIONS.redRamp);
    }

    const result = new MatchSimulation({
      structure: DECODE_MATCH,
      rules: DECODE_SCORING_RULES,
      regions: DECODE_FIELD_REGIONS,
      zones: DECODE_FIELD_ZONES,
      slottedRegions: DECODE_SLOTTED_REGIONS,
      slotAssignment: slots.assign,
      variables: { motif },
      robots: [idle('red', 0, 0)],
      pieces,
    }).run();

    const pattern = result.score.deltas.filter((d) => d.ruleId.includes('pattern'));
    expect(pattern.length).toBeGreaterThan(0);
    for (const award of pattern) {
      expect(award.points).toBe(DECODE_POINTS.patternAuto.value);
    }
  });

  it('awards no PATTERN when the ramp is empty', () => {
    const result = decodeMatch({ robots: [idle('red', 0, 0)] }).run();
    expect(result.score.deltas.filter((d) => d.ruleId.includes('pattern'))).toEqual([]);
  });

  it('has one PATTERN rule per ramp slot per alliance per phase', () => {
    const patternRules = DECODE_SCORING_RULES.filter((r) => r.id.includes('pattern'));
    // 9 slots x 2 alliances x 2 phases.
    expect(patternRules).toHaveLength(RAMP_SLOT_COUNT.value * 4);
  });
});

describe('DECODE match determinism', () => {
  const build = () =>
    decodeMatch({
      seed: 2026,
      robots: [driving('red', -64, 20, { x: 1, y: 0 }), idle('blue', 60, -60, SMALL_ROBOT)],
      pieces: [
        {
          pieceId: 'a1',
          pieceType: 'P',
          diameterIn: 5,
          massLb: 0.3,
          startPositionM: at(-58, 20),
        },
      ],
    });

  it('produces the same score and event log every run', () => {
    const a = build().run();
    const b = build().run();

    expect(a.score.red).toBe(b.score.red);
    expect(a.score.blue).toBe(b.score.blue);
    expect(a.events.length).toBe(b.events.length);
    expect(JSON.stringify(a.score.deltas)).toBe(JSON.stringify(b.score.deltas));
  });

  it('keeps a per-rule breakdown that sums to the total', () => {
    const result = build().run();
    const redTotal = result.score.deltas
      .filter((d) => d.alliance === 'red')
      .reduce((sum, d) => sum + d.points, 0);

    expect(redTotal).toBe(result.score.red);
  });

  it('scores both alliances independently in one match', () => {
    const result = build().run();
    expect(result.score.red).toBeGreaterThan(0);
    expect(result.score.blue).toBeGreaterThan(0);
  });
});

describe('DECODE has no endgame', () => {
  /**
   * The word ENDGAME does not appear in the DECODE manual; BASE is assessed at
   * the end of TELEOP. The fixture encodes that as a zero-length sub-phase, and
   * the structure model already reads zero as "never opens".
   */
  it('never enters an ENDGAME phase', () => {
    const sim = decodeMatch({ robots: [idle('red', 0, 0)] });
    const states = new Set<string>();

    while (sim.matchState !== 'POST') {
      sim.step();
      states.add(sim.matchState);
    }

    expect(states.has('ENDGAME')).toBe(false);
    expect(states.has('AUTO')).toBe(true);
    expect(states.has('TELEOP')).toBe(true);
  });
});
