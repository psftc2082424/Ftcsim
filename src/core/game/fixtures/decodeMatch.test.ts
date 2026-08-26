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
import {
  MatchSimulation,
  simulationFromDefinition,
  type MatchSimulationOptions,
} from '../matchSimulation.js';
import { definitionErrors, validateGameDefinition } from '../gameDefinition.js';
import { DECODE_GAME } from './decodeGame.js';
import { validateRuleSet } from '../rulesEngine.js';
import { createDefaultRegistry } from '../predicates.js';
import { validateRegions } from '../regions.js';
import { totalMatchDurationSec } from '../matchStructure.js';
import {
  DECODE_MATCH,
  DECODE_MOTIFS,
  DECODE_POINTS,
  DECODE_REGIONS,
  DECODE_PENALTIES,
  DECODE_RULE_SET,
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
import { ScriptedController, constantController, createInputTrace } from '../../control/scripted.js';
import { NEUTRAL_INPUT, createControlInput } from '../../control/controlInput.js';
import { NeutralController } from '../../control/controller.js';
import { inchesToMeters } from '../../units/convert.js';
import { vec2 } from '../../math/vec2.js';

const at = (xIn: number, yIn: number) => vec2(inchesToMeters(xIn), inchesToMeters(yIn));

/**
 * Points from rules whose id contains a fragment.
 *
 * The BASE and DEPOT cases below assert on this rather than on the total,
 * because a robot parked anywhere clear of a LAUNCH LINE also earns LEAVE at
 * the end of AUTO (§10.5.3) — correctly, but it is not what those tests are
 * about. Filtering keeps each assertion aimed at the rule it names.
 */
const pointsFrom = (
  result: { readonly score: { readonly deltas: readonly { ruleId: string; points: number }[] } },
  fragment: string,
): number =>
  result.score.deltas
    .filter((delta) => delta.ruleId.includes(fragment))
    .reduce((sum, delta) => sum + delta.points, 0);

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

/**
 * Ticks a `driving` robot holds its command before releasing it — 1.3 s at the
 * 200 Hz fixed rate, enough to cross about five feet of field.
 *
 * A robot commanded for the whole 158 s match ends up pressed against the far
 * perimeter, and in this placeholder layout the far perimeter is inside the
 * *opposite* alliance's LAUNCH LINE. LEAVE is assessed on where a robot ends
 * AUTO (§10.5.3), so that setup would fail for a reason that has nothing to do
 * with the rule. Releasing mid-field parks the robot in open space instead.
 */
/**
 * Legal ROBOT starting positions, per G304 (p.102).
 *
 * G304 requires a ROBOT to be "over a LAUNCH LINE", "touching its own
 * ALLIANCE's GOAL or the FIELD perimeter", and "fully contained on its own
 * ALLIANCE's side of the FIELD". Now that the LAUNCH ZONES are built from §9.3
 * instead of guessed, those requirements bite: a robot placed anywhere
 * convenient has usually already LEFT before the MATCH starts, which makes a
 * LEAVE test assert nothing.
 *
 * The GOAL-side LAUNCH ZONE is a triangle whose base is the whole GOAL-side
 * wall, so `y = 63` puts an 18 in robot against that wall, and `|x| = 30` keeps
 * it inside both the triangle and its own half.
 */
const START_ON_LAUNCH_LINE = { red: [-30, 63], blue: [30, 63] } as const;

/** A second legal start on the same wall, far enough not to touch the first. */
const SECOND_START_ON_LAUNCH_LINE = { red: [-55, 63], blue: [55, 63] } as const;

/**
 * Toward the audience, which is how a robot leaves the GOAL-side LAUNCH ZONE.
 *
 * Headings are zero in these fixtures, so leaving the GOAL wall is a strafe:
 * body +y is the robot's left, and the robot's left at heading zero is world
 * +Y, so -1 drives toward -Y.
 */
const TOWARD_AUDIENCE = { x: 0, y: -1 } as const;

/**
 * Mid-field, clear of both LAUNCH ZONES and of every scoring zone.
 *
 * The GOAL-side triangle covers `y >= |x|`, and the audience-side one covers
 * `y <= -48`; this sits between them.
 */
const CLEAR_OF_LAUNCH_LINES = [-20, -20] as const;
const CLEAR_OF_LAUNCH_LINES_2 = [20, -20] as const;

/** Inside the audience-side LAUNCH ZONE — the one that belongs to no alliance. */
const ON_AUDIENCE_LAUNCH_ZONE = [0, -63] as const;

const DRIVE_TICKS = 260;

const driving = (
  alliance: 'red' | 'blue',
  xIn: number,
  yIn: number,
  drive: { x: number; y: number },
  config: RobotConfig = DEFAULT_ROBOT_CONFIG,
): RobotSpec => ({
  config,
  controller: new ScriptedController(
    createInputTrace(`drive-${drive.x}-${drive.y}`, [
      { tick: 0, input: createControlInput(drive.x, drive.y, 0) },
      { tick: DRIVE_TICKS, input: NEUTRAL_INPUT },
    ]),
  ),
  alliance,
  startPose: { p: at(xIn, yIn), theta: 0 },
});

function decodeMatch(patch: Partial<MatchSimulationOptions> = {}): MatchSimulation {
  const slots = createRampSlotAssignment();

  return new MatchSimulation({
    structure: DECODE_MATCH,
    rules: DECODE_RULE_SET,
    regions: DECODE_FIELD_REGIONS,
    zones: DECODE_FIELD_ZONES,
    slottedRegions: DECODE_SLOTTED_REGIONS,
    slotAssignment: slots.assign,
    variables: { motif: DECODE_MOTIFS.GPP.pattern },
    robots: [idle('red', ...START_ON_LAUNCH_LINE.red)],
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
      robots: [driving('red', ...START_ON_LAUNCH_LINE.red, TOWARD_AUDIENCE)],
    }).run();

    expect(result.score.red).toBe(DECODE_POINTS.leaveAuto.value);
    expect(result.score.red).toBe(3);
  });

  it('awards LEAVE once per robot, up to two robots', () => {
    const result = decodeMatch({
      robots: [
        driving('red', ...START_ON_LAUNCH_LINE.red, TOWARD_AUDIENCE),
        driving('red', ...SECOND_START_ON_LAUNCH_LINE.red, TOWARD_AUDIENCE),
      ],
    }).run();

    expect(result.score.red).toBe(2 * DECODE_POINTS.leaveAuto.value);
  });

  it('does not award LEAVE for a robot that stays put', () => {
    expect(
      decodeMatch({ robots: [idle('red', ...START_ON_LAUNCH_LINE.red)] }).run().score.red,
    ).toBe(0);
  });

  it('credits the alliance that owns the robot', () => {
    const result = decodeMatch({
      robots: [driving('blue', ...START_ON_LAUNCH_LINE.blue, TOWARD_AUDIENCE)],
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
      robots: [driving('red', -22, 0, { x: -1, y: 0 })],
      pieces: [artifact('a1', -34, 0)],
    }).run();

    const breakdown = result.score.deltas.filter((d) => d.ruleId.includes('classified'));
    expect(breakdown.length).toBeGreaterThan(0);
    expect(result.score.red).toBeGreaterThanOrEqual(DECODE_POINTS.classifiedAuto.value);
  });

  it('scores an artifact once however long it sits in the ramp', () => {
    const result = decodeMatch({
      robots: [driving('red', -22, 0, { x: -1, y: 0 })],
      pieces: [artifact('a1', -34, 0)],
    }).run();

    const classified = result.score.deltas.filter((d) => d.ruleId === 'red-classified-auto');
    expect(classified).toHaveLength(1);
  });

  it('does not award the blue alliance for a red ramp', () => {
    const result = decodeMatch({
      robots: [driving('red', -22, 0, { x: -1, y: 0 })],
      pieces: [artifact('a1', -34, 0)],
    }).run();
    expect(result.score.blue).toBe(0);
  });

  /**
   * The payoff of the possession model: `PieceEnteredRegion` has carried
   * `byRobotId` / `byAlliance` since the event model was written, and until
   * possession existed nothing could fill them in. A rule that awards "the
   * alliance that scored it" now has an answer derived from where the robot and
   * the artifact actually were.
   */
  it('credits the artifact to the robot that pushed it', () => {
    const sim = decodeMatch({
      robots: [driving('red', -22, 0, { x: -1, y: 0 })],
      pieces: [artifact('a1', -34, 0)],
    });
    sim.run();

    const entered = sim.events.filter(
      (event) => event.kind === 'PieceEnteredRegion' && event.pieceId === 'a1',
    );
    expect(entered.length).toBeGreaterThan(0);

    for (const event of entered) {
      if (event.kind !== 'PieceEnteredRegion') continue;
      expect(event.byRobotId).toBe('0');
      expect(event.byAlliance).toBe('red');
    }

    expect(sim.events.some((event) => event.kind === 'PiecePossessed')).toBe(true);
  });

  it('leaves an untouched artifact unattributed', () => {
    const sim = decodeMatch({
      robots: [idle('red', ...START_ON_LAUNCH_LINE.red)],
      pieces: [artifact('a1', -50, 0)],
    });
    sim.run();

    // Pre-placed pieces are a baseline; nobody put them there.
    expect(sim.possession.creditFor('a1')).toBeUndefined();
  });

  it('scores no CLASSIFIED for an artifact that starts in the ramp', () => {
    // Pre-placed pieces are a baseline, not a scoring transition. They can still
    // score PATTERN, which is assessed on what is on the RAMP at the end of a
    // period rather than on how it got there (§10.5.2).
    const result = decodeMatch({ pieces: [artifact('a1', -50, 0)] }).run();
    expect(result.score.deltas.filter((d) => d.ruleId.includes('classified'))).toEqual([]);
  });
});

describe('LEAVE (§10.5, E and §10.5.3)', () => {
  /**
   * "To qualify for LEAVE points, a ROBOT must move such that it is no longer
   * over any LAUNCH LINE at the end of AUTO." (p.87)
   *
   * A final position, not a crossing — and "any" LAUNCH LINE, because there are
   * two LAUNCH ZONES and both belong to the FIELD rather than to an alliance
   * (§9.3). Their outlines come from the manual's TILE extents, so these cases
   * are about the real geometry rather than a placeholder.
   */
  it('awards LEAVE to a robot clear of every LAUNCH LINE at the end of AUTO', () => {
    const result = decodeMatch({ robots: [idle('red', ...CLEAR_OF_LAUNCH_LINES)] }).run();
    expect(pointsFrom(result, '-leave')).toBe(DECODE_POINTS.leaveAuto.value);
  });

  it('awards LEAVE once per robot', () => {
    const result = decodeMatch({
      robots: [
        idle('red', ...CLEAR_OF_LAUNCH_LINES),
        idle('red', ...CLEAR_OF_LAUNCH_LINES_2),
      ],
    }).run();
    expect(pointsFrom(result, '-leave')).toBe(2 * DECODE_POINTS.leaveAuto.value);
  });

  it('withholds LEAVE from a robot still on its own LAUNCH LINE', () => {
    const result = decodeMatch({ robots: [idle('red', ...START_ON_LAUNCH_LINE.red)] }).run();
    expect(pointsFrom(result, '-leave')).toBe(0);
  });

  /** "any LAUNCH LINE" includes the one at the other end of the field. */
  it('withholds LEAVE from a red robot parked on the audience LAUNCH ZONE', () => {
    const result = decodeMatch({ robots: [idle('red', ...ON_AUDIENCE_LAUNCH_ZONE)] }).run();
    expect(pointsFrom(result, '-leave')).toBe(0);
  });

  it('assesses LEAVE at the end of AUTO, not at the end of the match', () => {
    const result = decodeMatch({ robots: [idle('red', ...CLEAR_OF_LAUNCH_LINES)] }).run();
    const leave = result.score.deltas.filter((d) => d.ruleId.includes('-leave'));

    expect(leave).toHaveLength(1);
    // AUTO is 30 s at 200 Hz; the award lands on the boundary, not at the buzzer.
    expect(leave[0]?.tick).toBeLessThanOrEqual(30 / 0.005);
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
    expect(pointsFrom(result, '-base')).toBe(DECODE_POINTS.baseFull.value);
    expect(pointsFrom(result, '-base')).toBe(10);
  });

  it('awards the two-robot bonus on top of both full returns', () => {
    // Base spans -69..-51 in. Two 8 in robots at -65 and -55 are each entirely
    // inside it with a gap between them.
    const result = decodeMatch({
      robots: [idle('red', -65, -60, TINY_ROBOT), idle('red', -55, -60, TINY_ROBOT)],
    }).run();

    // 10 + 10 for the robots, plus the 10 bonus for both being fully in.
    expect(pointsFrom(result, '-base')).toBe(
      2 * DECODE_POINTS.baseFull.value + DECODE_POINTS.baseBothBonus.value,
    );
    expect(pointsFrom(result, '-base')).toBe(30);
  });

  it('awards a partial return for a robot only half inside', () => {
    // Straddling the -51 in edge of the base zone.
    const result = decodeMatch({ robots: [idle('red', -51, -60, SMALL_ROBOT)] }).run();
    expect(pointsFrom(result, '-base')).toBe(DECODE_POINTS.basePartial.value);
    expect(pointsFrom(result, '-base')).toBe(5);
  });

  it('awards no bonus when only one robot is fully in', () => {
    const result = decodeMatch({
      // One entirely inside, one straddling the -51 in edge.
      robots: [idle('red', -60, -60, TINY_ROBOT), idle('red', -50, -60, TINY_ROBOT)],
    }).run();

    // One full (10) plus one partial (5); no bonus.
    expect(pointsFrom(result, '-base')).toBe(
      DECODE_POINTS.baseFull.value + DECODE_POINTS.basePartial.value,
    );
  });

  it('awards nothing for a robot nowhere near BASE', () => {
    const result = decodeMatch({ robots: [idle('red', 0, 0, SMALL_ROBOT)] }).run();
    expect(pointsFrom(result, '-base')).toBe(0);
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
      startPositionM: at(-50, -12 + i * 8),
    }));

    const slots = createRampSlotAssignment();
    // Pre-seed arrival order so slot i holds piece i, matching the motif.
    for (let i = 0; i < pieces.length; i++) {
      slots.assign(`a${i}`, DECODE_REGIONS.redRamp);
    }

    const result = new MatchSimulation({
      structure: DECODE_MATCH,
      rules: DECODE_RULE_SET,
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
      robots: [
        driving('red', ...START_ON_LAUNCH_LINE.red, TOWARD_AUDIENCE),
        idle('blue', 60, -60, SMALL_ROBOT),
      ],
      pieces: [
        {
          pieceId: 'a1',
          pieceType: 'P',
          diameterIn: 5,
          massLb: 0.3,
          startPositionM: at(-50, 20),
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

describe('running DECODE from the GameDefinition alone', () => {
  /**
   * The architecture's central claim, exercised: adding a season means writing a
   * GameDefinition, and running it takes no season-specific wiring. Everything
   * below comes off `DECODE_GAME`; the caller supplies only what varies per
   * match.
   */
  it('validates and runs a match with no season-specific setup', () => {
    expect(definitionErrors(validateGameDefinition(DECODE_GAME, createDefaultRegistry()))).toEqual(
      [],
    );

    const slots = createRampSlotAssignment();
    const result = simulationFromDefinition(DECODE_GAME, {
      robots: [driving('red', ...START_ON_LAUNCH_LINE.red, TOWARD_AUDIENCE)],
      slotAssignment: slots.assign,
    }).run();

    expect(result.finalState).toBe('POST');
    expect(result.score.red).toBe(DECODE_POINTS.leaveAuto.value);
  });

  it('takes match timing, geometry and rules from the definition', () => {
    const sim = simulationFromDefinition(DECODE_GAME, { robots: [idle('red', 0, 0)] });

    expect(sim.detector.occupancyOfRobot('0', DECODE_ZONES.redBase)).toBe('outside');
    expect(sim.runner.matchState).toBe('AUTO');
  });

  it('lets a match override the definition default motif', () => {
    const sim = simulationFromDefinition(DECODE_GAME, {
      robots: [idle('red', 0, 0)],
      variables: { motif: DECODE_MOTIFS.PGP.pattern },
    });

    // The draw is per match, so a definition can only carry a placeholder.
    expect(DECODE_GAME.variables?.['motif']).toBe(DECODE_MOTIFS.GPP.pattern);
    expect(sim.matchState).toBe('AUTO');
  });

  it('supplies a cited mass for artifacts even though the manual gives none', () => {
    const artifact = DECODE_GAME.pieces[0];
    expect(artifact?.massLb?.value).toBe(0.165);
    // Sourced from the vendor spec for the part §9.9 names, so `inferred`
    // rather than `explicit` — and no longer an estimate.
    expect(artifact?.massLb?.confidence).toBe('inferred');
    expect(artifact?.massLb?.note ?? '').toContain('am-3376a');
  });
});

describe('DEPOT (§10.5, D)', () => {
  /**
   * DEPOT is assessed on artifacts resting in the depot at the end of TELEOP, so
   * it is reached through end-of-period restatement rather than through an entry
   * transition. An artifact placed there at the start and left alone must score.
   */
  it('awards DEPOT for an artifact resting in the depot at the end', () => {
    // Red depot spans x -60..-44, y -50..-30 in the placeholder layout.
    const result = decodeMatch({
      robots: [idle('red', 0, 0)],
      pieces: [
        {
          pieceId: 'd1',
          pieceType: 'P',
          diameterIn: 5,
          massLb: 0.3,
          startPositionM: at(-40, -40),
        },
      ],
    }).run();

    const depot = result.score.deltas.filter((d) => d.ruleId === 'red-depot');
    expect(depot).toHaveLength(1);
    expect(pointsFrom(result, '-depot')).toBe(DECODE_POINTS.depotTeleop.value);
    expect(pointsFrom(result, '-depot')).toBe(1);
  });

  it('awards DEPOT once per artifact, not once per period boundary', () => {
    const result = decodeMatch({
      robots: [idle('red', 0, 0)],
      pieces: [
        { pieceId: 'd1', pieceType: 'P', diameterIn: 5, massLb: 0.3, startPositionM: at(-40, -40) },
        { pieceId: 'd2', pieceType: 'G', diameterIn: 5, massLb: 0.3, startPositionM: at(-40, -36) },
      ],
    }).run();

    expect(result.score.deltas.filter((d) => d.ruleId === 'red-depot')).toHaveLength(2);
    expect(pointsFrom(result, '-depot')).toBe(2 * DECODE_POINTS.depotTeleop.value);
  });

  it('does not award DEPOT to the opposing alliance', () => {
    const result = decodeMatch({
      robots: [idle('red', 0, 0)],
      pieces: [
        { pieceId: 'd1', pieceType: 'P', diameterIn: 5, massLb: 0.3, startPositionM: at(-40, -40) },
      ],
    }).run();
    expect(result.score.blue).toBe(0);
  });
});

describe('CONTROL limit (G408)', () => {
  /**
   * Wider than a legal robot, so five 4.9 in artifacts fit across its face.
   * A probe for the rule, not a model of a robot — the same reason `SMALL_ROBOT`
   * and `TINY_ROBOT` exist above.
   */
  const WIDE_ROBOT: RobotConfig = {
    ...DEFAULT_ROBOT_CONFIG,
    chassis: { ...DEFAULT_ROBOT_CONFIG.chassis, widthIn: 30 },
  };

  /** Spaced wider than an artifact so they do not shove each other apart. */
  const ARTIFACT_ROW = [-11, -5.5, 0, 5.5, 11];

  const held = (pieceId: string, xIn: number, yIn: number): GamePieceSpec => ({
    pieceId,
    pieceType: 'P',
    diameterIn: 4.9,
    massLb: 0.165,
    startPositionM: at(xIn, yIn),
  });

  const hoarding = (count: number) =>
    decodeMatch({
      robots: [
        {
          config: WIDE_ROBOT,
          alliance: 'red',
          // Gently, so the push lasts past MOMENTARY before anything reaches a
          // wall. A full-throttle robot crosses the field in about two seconds.
          controller: constantController(createControlInput(0.25, 0, 0)),
          startPose: { p: at(-62, 0), theta: 0 },
        },
      ],
      pieces: ARTIFACT_ROW.slice(0, count).map((yIn, index) => held(`h${index}`, -48, yIn)),
    });

  const controlDeltas = (sim: MatchSimulation) =>
    sim.score.deltas.filter((delta) => delta.ruleId.includes('control-limit'));

  it('charges one MINOR FOUL per artifact over the limit', () => {
    const sim = hoarding(5);
    for (let i = 0; i < 2000; i++) sim.step();

    // Five held, limit is three, so two fouls: counts four and five.
    const ids = controlDeltas(sim).map((delta) => delta.ruleId).sort();
    expect(ids).toEqual(['red-control-limit-4', 'red-control-limit-5']);
  });

  it('credits the opponent and leaves the offender total alone', () => {
    const sim = hoarding(5);
    for (let i = 0; i < 2000; i++) sim.step();

    for (const delta of controlDeltas(sim)) {
      expect(delta.alliance).toBe('blue');
      expect(delta.points).toBe(DECODE_PENALTIES.minorToOpponent.value);
    }
    // "a credit of 5 points towards the opponent's MATCH point total" — a
    // credit, not a deduction, so red's own score is untouched by the foul.
    expect(controlDeltas(sim).every((delta) => delta.alliance !== 'red')).toBe(true);
  });

  it('charges nothing for holding exactly the limit', () => {
    const sim = hoarding(3);
    for (let i = 0; i < 2000; i++) sim.step();
    expect(controlDeltas(sim)).toEqual([]);
  });

  /**
   * The guard against fining a robot that merely drove through a cluster:
   * bulldozing and herding look identical, so the rule needs possession that
   * outlasted MOMENTARY (§16: "fewer than approximately 3 seconds").
   */
  it('charges nothing for a momentary sweep through a cluster', () => {
    const sim = hoarding(5);
    // 2.5 s of contact, inside the MOMENTARY window.
    for (let i = 0; i < 500; i++) sim.step();

    expect(sim.events.some((event) => event.kind === 'PiecePossessed')).toBe(true);
    expect(sim.events.some((event) => event.kind === 'PossessionSustained')).toBe(false);
    expect(controlDeltas(sim)).toEqual([]);
  });

  it('reports each count once, cumulatively', () => {
    const sim = hoarding(5);
    for (let i = 0; i < 2000; i++) sim.step();

    const counts = sim.events
      .filter((event) => event.kind === 'PossessionSustained')
      .map((event) => (event.kind === 'PossessionSustained' ? event.possessedCount : 0));

    expect(counts).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps the foul rules out of the scoring rule set', () => {
    // The manual separates what an alliance earns from what it concedes, and so
    // does the fixture; `DECODE_RULE_SET` is the join.
    expect(DECODE_SCORING_RULES.some((rule) => rule.id.includes('control-limit'))).toBe(false);
    expect(DECODE_RULE_SET.length).toBeGreaterThan(DECODE_SCORING_RULES.length);
  });
});
