/** Functional mechanism chain: field -> intake -> storage -> shoot -> score. */

import { describe, expect, it } from 'vitest';
import { SimWorld, type GamePieceSpec, type RobotSpec } from './simWorld.js';
import {
  INTAKE_BUTTON,
  LAUNCH_BUTTON,
  OUTTAKE_BUTTON,
} from './shooter.js';
import { COMPETITION_ROBOT_CONFIG, type RobotConfig } from '../robot/robotConfig.js';
import { ScriptedController, constantController, createInputTrace } from '../control/scripted.js';
import { NEUTRAL_INPUT, createControlInput } from '../control/controlInput.js';
import { inchesToMeters } from '../units/convert.js';
import { vec2 } from '../math/vec2.js';
import type { FieldTemplate } from '../field/fieldTemplate.js';

const OPEN_FIELD: FieldTemplate = { id: 'open', name: 'Open', widthM: 1000, lengthM: 1000, bodies: [] };

const artifact = (pieceId: string, xIn: number, yIn: number): GamePieceSpec => ({
  pieceId,
  pieceType: 'P',
  diameterIn: 4.9,
  massLb: 0.165,
  startPositionM: vec2(inchesToMeters(xIn), inchesToMeters(yIn)),
});

const input = (...buttons: string[]) =>
  createControlInput(0, 0, 0, Object.fromEntries(buttons.map((button) => [button, true])));

function world(
  pieces: readonly GamePieceSpec[],
  controller = constantController(NEUTRAL_INPUT),
  config: RobotConfig = COMPETITION_ROBOT_CONFIG,
): SimWorld {
  const robot: RobotSpec = {
    config,
    controller,
    startPose: { p: vec2(0, 0), theta: 0 },
  };
  return new SimWorld({ robots: [robot], pieces, field: OPEN_FIELD, seed: 11 });
}

describe('functional intake and storage', () => {
  it('acquires an eligible ball when intake is active', () => {
    const sim = world([artifact('a', 11, 0)], constantController(input(INTAKE_BUTTON)));
    sim.step();
    expect(sim.heldPieces(0)).toEqual(['a']);
    expect(sim.snapshot().pieces[0]?.heldByRobotId).toBe(0);
  });

  it('stops at capacity three and leaves the fourth ball on the field', () => {
    const sim = world(
      [artifact('a', 11, 0), artifact('b', 11, 4), artifact('c', 11, -4), artifact('d', 11, 2)],
      constantController(input(INTAKE_BUTTON)),
    );
    sim.step();
    expect(sim.heldPieces(0)).toHaveLength(3);
    expect(sim.snapshot().pieces.filter((piece) => piece.heldByRobotId === null).map((piece) => piece.pieceId)).toEqual(['d']);
  });

  it('ejects the oldest stored ball when outtake is active', () => {
    const controller = new ScriptedController(createInputTrace('collect then outtake', [
      { tick: 0, input: input(INTAKE_BUTTON) },
      { tick: 1, input: input(OUTTAKE_BUTTON) },
    ]));
    const sim = world([artifact('a', 11, 0)], controller);
    sim.stepMany(2);
    expect(sim.heldPieces(0)).toEqual([]);
    expect(sim.snapshot().pieces[0]?.heldByRobotId).toBeNull();
  });
});

describe('functional shooting', () => {
  const threeBalls = [artifact('a', 11, 0), artifact('b', 11, 4), artifact('c', 11, -4)];

  it('fires a stored ball on one shot command', () => {
    const controller = new ScriptedController(createInputTrace('single shot', [
      { tick: 0, input: input(INTAKE_BUTTON) },
      { tick: 1, input: input(LAUNCH_BUTTON) },
    ]));
    const sim = world(threeBalls, controller);
    sim.stepMany(2);
    expect(sim.heldPieces(0)).toEqual(['b', 'c']);
    expect(sim.drainPieceActions()).toMatchObject([{ kind: 'launch', pieceId: 'a' }]);
  });

  it('fires all three sequentially, one rising-edge command at a time', () => {
    const controller = new ScriptedController(createInputTrace('three shots', [
      { tick: 0, input: input(INTAKE_BUTTON) },
      { tick: 1, input: input(LAUNCH_BUTTON) },
      { tick: 2, input: input() },
      { tick: 3, input: input(LAUNCH_BUTTON) },
      { tick: 4, input: input() },
      { tick: 5, input: input(LAUNCH_BUTTON) },
    ]));
    const sim = world(threeBalls, controller);
    sim.stepMany(6);
    expect(sim.heldPieces(0)).toEqual([]);
    expect(sim.drainPieceActions().map((action) => action.pieceId)).toEqual(['a', 'b', 'c']);
  });
});
