/**
 * Intake and shooter, end to end in the world.
 *
 * The chain the product depends on: a button in a `ControlInput` reaches a
 * mechanism, the mechanism puts it in a hopper, and firing it emits a
 * deterministic action for the game layer to route. Everything here drives the
 * simulation the way a person does — through named buttons on the control
 * input — so nothing is asserted through a back door the UI does not have.
 */

import { describe, expect, it } from 'vitest';
import { SimWorld, type GamePieceSpec, type RobotSpec } from './simWorld.js';
import { INTAKE_BUTTON, LAUNCH_BUTTON, OUTTAKE_BUTTON, SHOOTER_BUTTON } from './shooter.js';
import { COMPETITION_ROBOT_CONFIG, type RobotConfig } from '../robot/robotConfig.js';
import { ScriptedController, constantController, createInputTrace } from '../control/scripted.js';
import { NEUTRAL_INPUT, createControlInput } from '../control/controlInput.js';
import { inchesToMeters } from '../units/convert.js';
import { vec2 } from '../math/vec2.js';
import type { FieldTemplate } from '../field/fieldTemplate.js';

/** No perimeter, so a shot measures a trajectory rather than a wall. */
const OPEN_FIELD: FieldTemplate = {
  id: 'open',
  name: 'No perimeter',
  widthM: 1000,
  lengthM: 1000,
  bodies: [],
};

const ARTIFACT_DIAMETER_IN = 4.9;

const artifact = (pieceId: string, xIn: number, yIn: number): GamePieceSpec => ({
  pieceId,
  pieceType: 'P',
  diameterIn: ARTIFACT_DIAMETER_IN,
  massLb: 0.165,
  startPositionM: vec2(inchesToMeters(xIn), inchesToMeters(yIn)),
});

const button = (...names: string[]) =>
  createControlInput(0, 0, 0, Object.fromEntries(names.map((name) => [name, true])));

const INTAKING = button(INTAKE_BUTTON);
const OUTTAKING = button(OUTTAKE_BUTTON);
const SPINNING = button(SHOOTER_BUTTON);
const SPIN_AND_FIRE = button(SHOOTER_BUTTON, LAUNCH_BUTTON);

interface Setup {
  readonly pieces: readonly GamePieceSpec[];
  readonly config?: RobotConfig;
  readonly robot?: Partial<RobotSpec>;
}

function world({ pieces, config = COMPETITION_ROBOT_CONFIG, robot = {} }: Setup): SimWorld {
  return new SimWorld({
    robots: [
      {
        config,
        controller: constantController(NEUTRAL_INPUT),
        startPose: { p: vec2(0, 0), theta: 0 },
        ...robot,
      },
    ],
    pieces,
    field: OPEN_FIELD,
    seed: 11,
  });
}

/** A robot sitting still with a ball in its mouth, running the intake. */
function collecting(pieces: readonly GamePieceSpec[] = [artifact('a', 11, 0)]): SimWorld {
  return world({ pieces, robot: { controller: constantController(INTAKING) } });
}

describe('the intake collects', () => {
  it('takes a piece out of the mouth and into the hopper', () => {
    const sim = collecting();
    expect(sim.heldPieces(0)).toEqual([]);

    sim.stepMany(100);
    expect(sim.heldPieces(0)).toEqual(['a']);
    expect(sim.snapshot().pieces[0]?.heldByRobotId).toBe(0);
  });

  it('leaves a piece alone with the roller off', () => {
    const sim = world({ pieces: [artifact('a', 11, 0)] });
    sim.stepMany(200);

    expect(sim.heldPieces(0)).toEqual([]);
    expect(sim.snapshot().pieces[0]?.heldByRobotId).toBeNull();
  });

  it('ignores a piece outside the mouth', () => {
    const sim = collecting([artifact('far', 30, 0)]);
    sim.stepMany(200);
    expect(sim.heldPieces(0)).toEqual([]);
  });

  it('ignores a piece beside the robot rather than in front of it', () => {
    const sim = collecting([artifact('side', 0, 14)]);
    sim.stepMany(200);
    expect(sim.heldPieces(0)).toEqual([]);
  });

  /** The mouth is a floor-level opening; a shot passes over it. */
  it('ignores a piece in flight over the mouth', () => {
    const sim = collecting();
    sim.launchPiece('a', { speedMps: 6, elevationRad: 1.2, headingRad: 0, fromHeightM: 1 });
    sim.stepMany(20);

    expect(sim.heldPieces(0)).toEqual([]);
  });

  it('acquires an eligible piece immediately when it enters the mouth', () => {
    const sim = collecting([artifact('a', 13.5, 0)]);
    sim.step();

    expect(sim.heldPieces(0)).toEqual(['a']);
  });

  it('fills up to capacity and no further', () => {
    const three = [artifact('a', 11, 0), artifact('b', 11, 5), artifact('c', 11, -5)];
    const sim = collecting([...three, artifact('d', 12, 2)]);
    sim.stepMany(400);

    const capacity = sim.mechanismSpecs(0).intake?.capacity ?? 0;
    expect(capacity).toBe(3);
    expect(sim.heldPieces(0)).toHaveLength(3);
    expect(sim.snapshot().pieces.filter((p) => p.heldByRobotId === null)).toHaveLength(1);
  });

  it('does not depend on motor gearing once a piece is inside the mouth', () => {
    const geared = (gearRatio: number): RobotConfig => ({
      ...COMPETITION_ROBOT_CONFIG,
      mechanisms: COMPETITION_ROBOT_CONFIG.mechanisms.map((mechanism) =>
        mechanism.actuation === undefined || mechanism.id !== 'intake-1'
          ? mechanism
          : { ...mechanism, actuation: { ...mechanism.actuation, gearRatio } },
      ),
    });

    const collects = (gearRatio: number): boolean => {
      const sim = world({
        pieces: [artifact('a', 13, 0)],
        config: geared(gearRatio),
        robot: { controller: constantController(INTAKING) },
      });
      sim.step();
      return sim.heldPieces(0).length === 1;
    };

    expect(collects(1)).toBe(true);
    expect(collects(6)).toBe(true);
  });

  it('does not collect for a robot with no intake at all', () => {
    const noMechanisms: RobotConfig = { ...COMPETITION_ROBOT_CONFIG, mechanisms: [] };
    const sim = world({
      pieces: [artifact('a', 11, 0)],
      config: noMechanisms,
      robot: { controller: constantController(INTAKING) },
    });
    sim.stepMany(200);

    expect(sim.heldPieces(0)).toEqual([]);
  });
});

describe('a carried piece', () => {
  it('travels with the robot instead of being left behind', () => {
    const sim = world({
      pieces: [artifact('a', 11, 0)],
      robot: {
        controller: new ScriptedController(
          createInputTrace('collect then drive', [
            { tick: 0, input: INTAKING },
            { tick: 100, input: createControlInput(1, 0, 0, { [INTAKE_BUTTON]: true }) },
          ]),
        ),
      },
    });
    sim.stepMany(400);

    const snapshot = sim.snapshot();
    const robot = snapshot.robots[0];
    const piece = snapshot.pieces[0];

    expect(sim.heldPieces(0)).toEqual(['a']);
    expect(robot?.pose.p.x ?? 0).toBeGreaterThan(0.5);
    expect(
      Math.hypot(
        (piece?.pose.p.x ?? 0) - (robot?.pose.p.x ?? 0),
        (piece?.pose.p.y ?? 0) - (robot?.pose.p.y ?? 0),
      ),
    ).toBeLessThan(inchesToMeters(12));
  });

  it('is still counted as a body in the world', () => {
    const sim = collecting();
    sim.stepMany(100);
    expect(sim.pieceCount).toBe(1);
    expect(sim.snapshot().pieces).toHaveLength(1);
  });
});

describe('the outtake', () => {
  const collectThenEject = (ejectAt: number) =>
    world({
      pieces: [artifact('a', 11, 0)],
      robot: {
        controller: new ScriptedController(
          createInputTrace('collect then eject', [
            { tick: 0, input: INTAKING },
            { tick: ejectAt, input: OUTTAKING },
          ]),
        ),
      },
    });

  it('puts a held piece back on the field in front of the robot', () => {
    const sim = collectThenEject(100);
    sim.stepMany(120);

    expect(sim.heldPieces(0)).toEqual([]);
    const piece = sim.snapshot().pieces[0];
    expect(piece?.heldByRobotId).toBeNull();
    expect(piece?.pose.p.x ?? 0).toBeGreaterThan(0);
  });

  it('returns it at rest rather than injecting a physical roller impulse', () => {
    const sim = collectThenEject(100);
    sim.stepMany(102);

    const piece = sim.snapshot().pieces[0];
    expect(piece?.vel.v.x ?? 0).toBeCloseTo(0, 12);
  });

  it('does nothing with an empty hopper', () => {
    const sim = world({
      pieces: [artifact('a', 40, 0)],
      robot: { controller: constantController(OUTTAKING) },
    });
    expect(() => sim.stepMany(100)).not.toThrow();
    expect(sim.heldPieces(0)).toEqual([]);
  });
});

describe('the shooter', () => {
  const collectAndShoot = (spinUpTicks: number) =>
    world({
      pieces: [artifact('a', 11, 0)],
      robot: {
        controller: new ScriptedController(
          createInputTrace('collect, spin, fire', [
            { tick: 0, input: button(INTAKE_BUTTON, SHOOTER_BUTTON) },
            { tick: spinUpTicks, input: SPIN_AND_FIRE },
          ]),
        ),
      },
    });

  it('is ready at its configured setting when enabled', () => {
    const sim = world({ pieces: [], robot: { controller: constantController(SPINNING) } });

    sim.step();
    const shooter = sim.snapshot().robots[0]?.mechanisms;

    expect(shooter?.shooterRunning).toBe(true);
    expect(shooter?.flywheelRadPerSec).toBeCloseTo(shooter?.flywheelTargetRadPerSec ?? 0, 12);
  });

  it('does not create a hidden battery-load model for a functional shooter', () => {
    const spinning = world({ pieces: [], robot: { controller: constantController(SPINNING) } });
    const idle = world({ pieces: [] });
    spinning.stepMany(50);
    idle.stepMany(50);

    expect(spinning.snapshot().robots[0]?.mechanisms.shooterCurrentA ?? 0).toBe(0);
    expect(spinning.batteryVolts).toBeCloseTo(idle.batteryVolts, 12);
  });

  it('queues a launch action instead of creating a projectile', () => {
    const sim = collectAndShoot(500);
    sim.stepMany(520);

    expect(sim.heldPieces(0)).toEqual([]);
    expect(sim.drainPieceActions()).toMatchObject([{ kind: 'launch', pieceId: 'a', alliance: 'red' }]);
  });

  it('keeps the enabled setting after an action', () => {
    const sim = collectAndShoot(600);
    sim.stepMany(600);
    const before = sim.snapshot().robots[0]?.mechanisms.flywheelRadPerSec ?? 0;
    sim.step();
    const after = sim.snapshot().robots[0]?.mechanisms.flywheelRadPerSec ?? 0;

    expect(after).toBeCloseTo(before, 12);
  });

  it('fires nothing at all with an empty hopper', () => {
    const sim = world({
      pieces: [artifact('a', 40, 0)],
      robot: { controller: constantController(SPIN_AND_FIRE) },
    });
    sim.stepMany(400);

    expect(sim.drainPieceActions()).toEqual([]);
  });

  it('does not apply artificial recoil for a functional action', () => {
    const sim = collectAndShoot(600);
    sim.stepMany(600);
    const before = sim.snapshot().robots[0]?.vel.v.x ?? 0;
    sim.step();
    const after = sim.snapshot().robots[0]?.vel.v.x ?? 0;

    expect(after).toBeCloseTo(before, 12);
  });
});

describe('the whole sequence, the way a driver runs it', () => {
  /**
   * Drive at a ball with the intake running, collect it, enable and fire. This
   * is the loop the product promises, asserted through the control input alone.
   */
  it('drives, collects, enables and produces a launch action', () => {
    const sim = world({
      pieces: [artifact('a', 30, 0)],
      robot: {
        controller: new ScriptedController(
          createInputTrace('drive and shoot', [
            {
              tick: 0,
              input: createControlInput(0.5, 0, 0, {
                [INTAKE_BUTTON]: true,
                [SHOOTER_BUTTON]: true,
              }),
            },
            { tick: 200, input: button(INTAKE_BUTTON, SHOOTER_BUTTON) },
            { tick: 700, input: SPIN_AND_FIRE },
          ]),
        ),
      },
    });

    sim.stepMany(200);
    expect(sim.heldPieces(0)).toEqual(['a']);

    sim.stepMany(520);
    expect(sim.drainPieceActions()).toMatchObject([{ kind: 'launch', pieceId: 'a' }]);
  });

  it('reproduces the same state hash from the same seed and inputs', () => {
    const run = (): string => {
      const sim = world({
        pieces: [artifact('a', 11, 0)],
        robot: {
          controller: new ScriptedController(
            createInputTrace('collect and fire', [
              { tick: 0, input: button(INTAKE_BUTTON, SHOOTER_BUTTON) },
              { tick: 400, input: SPIN_AND_FIRE },
            ]),
          ),
        },
      });
      sim.stepMany(600);
      return sim.stateHash();
    };

    const first = run();
    for (let i = 0; i < 3; i++) expect(run()).toBe(first);
  });

  it('puts the flywheel into the state hash, so a shot cannot diverge unnoticed', () => {
    const idle = world({ pieces: [] });
    const spun = world({ pieces: [], robot: { controller: constantController(SPINNING) } });
    idle.stepMany(50);
    spun.stepMany(50);

    expect(spun.stateHash()).not.toBe(idle.stateHash());
  });
});

describe('the shoot control', () => {
  it('releases one piece for each fire-button press', () => {
    const sim = world({
      pieces: [artifact('a', 11, 0), artifact('b', 11, 5), artifact('c', 11, -5)],
      robot: {
        controller: new ScriptedController(
          createInputTrace('collect three then hold fire', [
            { tick: 0, input: button(INTAKE_BUTTON, SHOOTER_BUTTON) },
            { tick: 600, input: SPIN_AND_FIRE },
            { tick: 601, input: SPINNING },
            { tick: 602, input: SPIN_AND_FIRE },
          ]),
        ),
      },
    });

    sim.stepMany(600);
    expect(sim.heldPieces(0)).toHaveLength(3);

    sim.stepMany(3);
    expect(sim.heldPieces(0)).toEqual(['c']);
    expect(sim.drainPieceActions()).toHaveLength(2);
  });

  it('does not empty the hopper while the fire button remains held', () => {
    const sim = world({
      pieces: [artifact('a', 11, 0), artifact('b', 11, 5)],
      robot: {
        controller: new ScriptedController(
          createInputTrace('collect two then hold fire', [
            { tick: 0, input: button(INTAKE_BUTTON, SHOOTER_BUTTON) },
            { tick: 600, input: SPIN_AND_FIRE },
          ]),
        ),
      },
    });

    sim.stepMany(601);
    expect(sim.heldPieces(0)).toHaveLength(1);
    expect(sim.drainPieceActions()).toHaveLength(1);
  });
});
