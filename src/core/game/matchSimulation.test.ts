import { describe, expect, it } from 'vitest';
import { MatchSimulation, type MatchSimulationOptions } from './matchSimulation.js';
import { createRectRegion, createRectZone } from './regions.js';
import { explicit } from './sourced.js';
import { observationFrom, robotIdOf } from './observation.js';
import type { MatchStructure } from './matchStructure.js';
import type { ScoringRule } from './scoring.js';
import { COMPETITION_ROBOT_CONFIG, DEFAULT_ROBOT_CONFIG } from '../robot/robotConfig.js';
import { constantController, createInputTrace, ScriptedController } from '../control/scripted.js';
import { createControlInput, NEUTRAL_INPUT } from '../control/controlInput.js';
import { NeutralController } from '../control/controller.js';
import { SimWorld } from '../sim/simWorld.js';
import { inchesToMeters } from '../units/convert.js';
import { vec2 } from '../math/vec2.js';
import { INTAKE_BUTTON, LAUNCH_BUTTON, SHOOTER_BUTTON } from '../sim/shooter.js';

/** A short match keeps end-to-end runs fast: 2 s AUTO, 1 s gap, 3 s TELEOP. */
const SHORT_MATCH: MatchStructure = {
  periods: [
    { id: 'AUTO', durationSec: explicit(2) },
    {
      id: 'TELEOP',
      durationSec: explicit(3),
      subPhases: [{ id: 'ENDGAME', startsAtRemainingSec: explicit(1) }],
    },
  ],
  transitionSec: explicit(1),
};

/** A goal directly ahead of a robot starting at the origin. */
const goal = createRectRegion({
  id: 'goal',
  centerXIn: 40,
  centerYIn: 0,
  widthIn: 30,
  lengthIn: 30,
});

const startZone = createRectZone({
  id: 'start',
  centerXIn: 0,
  centerYIn: 0,
  widthIn: 30,
  lengthIn: 30,
});

const scoreOnEntry = (phase: 'AUTO' | 'TELEOP' | 'ANY', points: number): ScoringRule => ({
  id: `goal-${phase.toLowerCase()}`,
  label: `Goal (${phase})`,
  phase,
  trigger: { event: 'PieceEnteredRegion', filters: [{ field: 'regionId', equals: 'goal' }] },
  award: { points: explicit(points), alliance: 'red' },
  oncePerPiece: true,
});

const leaveRule: ScoringRule = {
  id: 'leave',
  label: 'Leave the start zone',
  phase: 'AUTO',
  trigger: { event: 'RobotExitedZone', filters: [{ field: 'zoneId', equals: 'start' }] },
  award: { points: explicit(5), alliance: 'owner' },
  maxAwards: 2,
};

const parkRule: ScoringRule = {
  id: 'park',
  label: 'Parked in the goal at the end of TELEOP',
  phase: 'TELEOP',
  trigger: { event: 'RobotOverlapsZone', filters: [{ field: 'zoneId', equals: 'park' }] },
  condition: { predicateId: 'robotFullyInZone', params: { zoneId: 'park' } },
  award: { points: explicit(7), alliance: 'owner' },
  maxAwards: 2,
};

/**
 * The zone spans 20-70 in, so an 18 in robot counts as fully supported only
 * while its centre is between 29 and 61 in. The scripted drives below are timed
 * to land inside that window: this robot accelerates at over 1 g and reaches
 * 63 in within 1.5 s, so a longer push overshoots into partial support.
 */
const parkZone = createRectZone({
  id: 'park',
  centerXIn: 45,
  centerYIn: 0,
  widthIn: 50,
  lengthIn: 50,
});

const simulation = (patch: Partial<MatchSimulationOptions> = {}) =>
  new MatchSimulation({
    structure: SHORT_MATCH,
    rules: [scoreOnEntry('ANY', 3)],
    regions: [goal],
    zones: [startZone],
    robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: new NeutralController(), alliance: 'red' }],
    ...patch,
  });

describe('pipeline wiring', () => {
  it('runs a whole match and finishes', () => {
    const result = simulation().run();
    expect(result.finalState).toBe('POST');
    expect(result.ticks).toBeGreaterThan(0);
  });

  it('scores nothing when nothing happens', () => {
    expect(simulation().run().score.red).toBe(0);
  });

  it('routes a functional launch through region events and the rules engine', () => {
    const controller = new ScriptedController(
      createInputTrace('intake then score', [
        { tick: 0, input: createControlInput(0, 0, 0, { [INTAKE_BUTTON]: true, [SHOOTER_BUTTON]: true }) },
        { tick: 1, input: createControlInput(0, 0, 0, { [SHOOTER_BUTTON]: true, [LAUNCH_BUTTON]: true }) },
      ]),
    );
    const sim = simulation({
      robots: [
        {
          config: COMPETITION_ROBOT_CONFIG,
          controller,
          alliance: 'red',
          startPose: { p: vec2(0, 0), theta: 0 },
        },
      ],
      pieces: [
        {
          pieceId: 'p',
          pieceType: 'P',
          diameterIn: 4.9,
          massLb: 0.165,
          startPositionM: vec2(inchesToMeters(11), 0),
        },
      ],
      mechanismActionRoutes: [
        {
          id: 'own-goal',
          action: 'launch',
          destinationRegionByAlliance: { red: 'goal', blue: 'goal' },
        },
      ],
    });

    sim.step();
    expect(sim.world.heldPieces(0)).toEqual(['p']);
    sim.step();

    expect(sim.score.red).toBe(3);
    expect(sim.events).toContainEqual(
      expect.objectContaining({ kind: 'PieceEnteredRegion', pieceId: 'p', regionId: 'goal' }),
    );
  });

  /** The point of the chunk: a score derived from real simulated positions. */
  it('scores a piece the robot physically pushed into a region', () => {
    const result = simulation({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(createControlInput(1, 0, 0)),
          alliance: 'red',
          startPose: { p: vec2(0, 0), theta: 0 },
        },
      ],
      pieces: [
        {
          pieceId: 'a1',
          pieceType: 'purple',
          diameterIn: 5,
          massLb: 0.3,
          startPositionM: vec2(inchesToMeters(14), 0),
        },
      ],
    }).run();

    expect(result.score.red).toBe(3);
    expect(result.events.some((e) => e.kind === 'PieceEnteredRegion')).toBe(true);
  });

  it('does not score a piece that starts inside a region', () => {
    // Priming makes the starting layout a baseline, not a scoring event.
    const result = simulation({
      pieces: [
        {
          pieceId: 'a1',
          pieceType: 'purple',
          diameterIn: 5,
          massLb: 0.3,
          startPositionM: vec2(inchesToMeters(40), 0),
        },
      ],
    }).run();

    expect(result.score.red).toBe(0);
  });

  it('awards the alliance that owns the robot for an owner-scoped rule', () => {
    const result = simulation({
      rules: [leaveRule],
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(createControlInput(1, 0, 0)),
          alliance: 'blue',
        },
      ],
    }).run();

    expect(result.score.blue).toBe(5);
    expect(result.score.red).toBe(0);
  });
});

describe('phase scoping through the whole pipeline', () => {
  /**
   * A rule scoped to AUTO must not fire in TELEOP, even though the physical
   * event is identical. This is the clock, the runner's scoping and the rules
   * engine all agreeing.
   */
  it('scores in AUTO only when the rule is AUTO-scoped', () => {
    // Robot leaves the start zone almost immediately, inside AUTO.
    const early = simulation({
      rules: [leaveRule],
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(createControlInput(1, 0, 0)),
          alliance: 'red',
        },
      ],
    }).run();
    expect(early.score.red).toBe(5);

    // The same departure delayed into TELEOP scores nothing.
    const late = simulation({
      rules: [leaveRule],
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          alliance: 'red',
          controller: new ScriptedController(
            createInputTrace('late', [
              { tick: 0, input: NEUTRAL_INPUT },
              { tick: 800, input: createControlInput(1, 0, 0) },
            ]),
          ),
        },
      ],
    }).run();
    expect(late.score.red).toBe(0);
  });

  it('emits phase transitions in order', () => {
    const transitions = simulation()
      .run()
      .events.filter((e) => e.kind === 'PhaseChanged')
      .map((e) => (e.kind === 'PhaseChanged' ? `${e.from}->${e.to}` : ''));

    expect(transitions).toEqual([
      'AUTO->TRANSITION',
      'TRANSITION->TELEOP',
      'TELEOP->ENDGAME',
      'ENDGAME->POST',
    ]);
  });
});

describe('end-of-period assessment', () => {
  /**
   * A robot that parked long before the buzzer must still score: end-of-period
   * rules read final position, and the arrival transition is long gone by then.
   */
  it('scores a robot parked well before the period ends', () => {
    const result = simulation({
      rules: [parkRule],
      zones: [startZone, parkZone],
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          alliance: 'red',
          // Drive into the park zone, then stop and sit there.
          controller: new ScriptedController(
            createInputTrace('park', [
              { tick: 0, input: createControlInput(1, 0, 0) },
              { tick: 150, input: NEUTRAL_INPUT },
            ]),
          ),
        },
      ],
    }).run();

    expect(result.score.red).toBe(7);
  });

  it('does not score a robot that left before the period ended', () => {
    const result = simulation({
      rules: [parkRule],
      zones: [startZone, parkZone],
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          alliance: 'red',
          controller: new ScriptedController(
            createInputTrace('leave-again', [
              { tick: 0, input: createControlInput(1, 0, 0) },
              { tick: 150, input: NEUTRAL_INPUT },
              { tick: 700, input: createControlInput(-1, 0, 0) },
            ]),
          ),
        },
      ],
    }).run();

    expect(result.score.red).toBe(0);
  });
});

describe('determinism end to end', () => {
  const build = () =>
    simulation({
      seed: 7,
      rules: [scoreOnEntry('ANY', 3), leaveRule],
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(createControlInput(1, 0.2, 0)),
          alliance: 'red',
        },
      ],
      pieces: [
        {
          pieceId: 'a1',
          pieceType: 'purple',
          diameterIn: 5,
          massLb: 0.3,
          startPositionM: vec2(inchesToMeters(14), 0),
        },
      ],
    });

  it('produces the same score and event log every run', () => {
    const a = build().run();
    const b = build().run();

    expect(a.score.red).toBe(b.score.red);
    expect(a.events.length).toBe(b.events.length);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('leaves the physics digest identical across runs', () => {
    const a = build();
    const b = build();
    a.run();
    b.run();
    expect(a.world.stateHash()).toBe(b.world.stateHash());
  });
});

describe('observation bridge', () => {
  it('maps a snapshot onto observations for every entity', () => {
    const world = new SimWorld({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: new NeutralController() }],
      pieces: [
        { pieceId: 'a1', pieceType: 'purple', diameterIn: 5, massLb: 0.3 },
        { pieceId: 'b1', pieceType: 'green', diameterIn: 5, massLb: 0.3 },
      ],
    });

    const observation = observationFrom(world.snapshot());
    expect(observation.robots).toHaveLength(1);
    expect(observation.pieces).toHaveLength(2);
    expect(observation.pieces?.map((p) => p.pieceId)).toEqual(['a1', 'b1']);
    expect(observation.pieces?.[0]?.pieceType).toBe('purple');
  });

  it('names robots the way events will', () => {
    const world = new SimWorld({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: new NeutralController() }],
    });
    const [robot] = observationFrom(world.snapshot()).robots ?? [];
    expect(robot?.robotId).toBe(robotIdOf(0));
  });

  it('carries attribution when the caller supplies it', () => {
    const world = new SimWorld({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: new NeutralController() }],
      pieces: [{ pieceId: 'a1', pieceType: 'purple', diameterIn: 5, massLb: 0.3 }],
    });

    const observation = observationFrom(world.snapshot(), {
      attribution: (pieceId) => (pieceId === 'a1' ? { robotId: '0', alliance: 'blue' } : undefined),
    });

    expect(observation.pieces?.[0]?.byAlliance).toBe('blue');
  });

  it('omits attribution when none is known', () => {
    const world = new SimWorld({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: new NeutralController() }],
      pieces: [{ pieceId: 'a1', pieceType: 'purple', diameterIn: 5, massLb: 0.3 }],
    });
    expect(observationFrom(world.snapshot()).pieces?.[0]?.byAlliance).toBeUndefined();
  });
});
