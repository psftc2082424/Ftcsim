import { describe, expect, it } from 'vitest';
import { simulationFromDefinition } from '../matchSimulation.js';
import { DECODE_GAME } from './decodeGame.js';
import { createDecodeField } from './decodeCollision.js';
import { DECODE_REGIONS } from './decode.js';
import { DECODE_FIELD_REGIONS, DECODE_FIELD_ZONES } from './decodeField.js';
import { DEFAULT_ROBOT_CONFIG, type RobotConfig } from '../../robot/robotConfig.js';
import { ScriptedController, constantController, createInputTrace } from '../../control/scripted.js';
import { createControlInput } from '../../control/controlInput.js';
import { INTAKE_BUTTON, LAUNCH_BUTTON } from '../../sim/shooter.js';
import { inchesToMeters, metersToInches } from '../../units/convert.js';
import { meters } from '../../units/si.js';
import { vec2 } from '../../math/vec2.js';
import { NEUTRAL_INPUT } from '../../control/controlInput.js';

const centreOf = (id: string): readonly [number, number] => {
  const shaped = DECODE_FIELD_ZONES.find((z) => z.id === id) ?? DECODE_FIELD_REGIONS.find((r) => r.id === id);
  if (shaped === undefined) throw new Error(`no region or zone "${id}"`);
  return [metersToInches(meters(shaped.centerM.x)), metersToInches(meters(shaped.centerM.y))];
};

const TUNNEL_SHOOTER: RobotConfig = {
  ...DEFAULT_ROBOT_CONFIG,
  mechanisms: [
    { id: 'intake', name: 'Intake', preset: 'intake', massLb: 4, mount: { xIn: 8, yIn: 0, facingDeg: 0 },
      actuation: { motorId: 'gobilda-5203-435', motorCount: 1, gearRatio: 1, efficiency: 0.9 },
      capabilities: [{ kind: 'acquire', pieceTypes: [], capacity: 3, reachIn: 6, mouthWidthIn: 14, acquisitionRatePerSec: 2 }] },
    { id: 'shooter', name: 'Shooter', preset: 'shooter', massLb: 6, mount: { xIn: 4, yIn: 0, facingDeg: 0 },
      actuation: { motorId: 'gobilda-5203-6000', motorCount: 1, gearRatio: 1, efficiency: 0.92 },
      capabilities: [{ kind: 'launch', pieceTypes: [], shotsPerSecond: 2 }] },
  ],
};

describe('physical classifier lane smoke test', () => {
  it('keeps a scored shot physical while it enters the GOAL and classifier', () => {
    const goal = centreOf(DECODE_REGIONS.redGoal);
    const standoffIn = 48;
    const startY = goal[1] - standoffIn + 11;

    const sim = simulationFromDefinition(DECODE_GAME, {
      field: createDecodeField(),
      robots: [{
        config: TUNNEL_SHOOTER,
        alliance: 'red',
        controller: new ScriptedController(createInputTrace('load and fire three', [
          { tick: 0, input: createControlInput(0, 0, 0, { [INTAKE_BUTTON]: true }) },
          { tick: 210, input: createControlInput(0, 0, 0, { [LAUNCH_BUTTON]: true }) },
          { tick: 420, input: createControlInput(-1, 0, 0) },
        ])),
        startPose: { p: vec2(inchesToMeters(goal[0]), inchesToMeters(goal[1] - standoffIn)), theta: Math.PI / 2 },
      }],
      pieces: ['a1', 'a2', 'a3'].map((pieceId, index) => ({
        pieceId, pieceType: 'P', diameterIn: 5, massLb: 0.3,
        startPositionM: vec2(inchesToMeters(goal[0]), inchesToMeters(startY + (index - 1) * 4)),
      })),
    });

    for (let i = 0; i < 700; i++) sim.step();

    // Keep the former diagnostic as a small, deterministic integration check:
    // a real launch enters the GOAL under its own flight, then remains a
    // normal body as it is guided through the classifier.
    expect(sim.score.red).toBeGreaterThan(0);
    expect(sim.world.snapshot().pieces.some((piece) => piece.heldByRobotId === null)).toBe(true);
  });

  it('rejects an unaccepted loose ball from the protected classifier lane', () => {
    const sim = simulationFromDefinition(DECODE_GAME, {
      field: createDecodeField(),
      robots: [{
        config: DEFAULT_ROBOT_CONFIG,
        alliance: 'red',
        controller: constantController(NEUTRAL_INPUT),
        startPose: { p: vec2(inchesToMeters(-40), inchesToMeters(-40)), theta: 0 },
      }],
      // This is physically inside the channel, but it did not enter through
      // the raised GOAL opening. The lane boundary must return it to the field
      // side rather than treating it as a classifier arrival.
      pieces: [{
        pieceId: 'loose',
        pieceType: 'P',
        diameterIn: 5,
        massLb: 0.3,
        startPositionM: vec2(inchesToMeters(69), inchesToMeters(57)),
      }],
    });

    for (let tick = 0; tick < 80; tick++) sim.step();

    const loose = sim.world.snapshot().pieces.find((piece) => piece.pieceId === 'loose');
    if (loose === undefined) throw new Error('loose artifact missing');
    expect(sim.conveyors.queued('red-classifier')).toEqual([]);
    expect(sim.conveyors.inBasin('red-classifier')).toEqual([]);
    // The declared public-side correction point is x=63 in, outside the
    // six-inch channel whose field-side edge is x=66 in.
    expect(metersToInches(meters(loose.pose.p.x))).toBeLessThan(66);
    expect(sim.score.red).toBe(0);
  });
});
