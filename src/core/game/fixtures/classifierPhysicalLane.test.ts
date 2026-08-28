import { describe, expect, it } from 'vitest';
import { simulationFromDefinition } from '../matchSimulation.js';
import { DECODE_GAME } from './decodeGame.js';
import { createDecodeField } from './decodeCollision.js';
import { DECODE_REGIONS, DECODE_ZONES } from './decode.js';
import { ARTIFACT } from './decodeDimensions.js';
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

describe('classifier storage integration', () => {
  it('takes a scored shot through the GOAL into classifier storage', () => {
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
        pieceId, pieceType: 'P', diameterIn: ARTIFACT.specifiedDiameterIn.value, massLb: 0.3,
        startPositionM: vec2(inchesToMeters(goal[0]), inchesToMeters(startY + (index - 1) * 4)),
      })),
    });

    let sawCapturedBasin = false;
    let sawRollingDownClassifier = false;
    for (let i = 0; i < 700; i++) {
      sim.step();
      if (sim.conveyors.inBasin('red-classifier').includes('a1')) sawCapturedBasin = true;
      const a1 = sim.world.snapshot().pieces.find((piece) => piece.pieceId === 'a1');
      if (a1 === undefined) continue;
      const yIn = metersToInches(meters(a1.pose.p.y));
      const speedInPerSec = metersToInches(meters(Math.hypot(a1.vel.v.x, a1.vel.v.y)));
      // This is below the GOAL arch and above the GATE, so observing a
      // non-zero-speed ball here proves it is rolling the visible classifier
      // run rather than appearing directly in storage or at the tunnel exit.
      if (yIn > 8 && yIn < 48 && speedInPerSec > 1) sawRollingDownClassifier = true;
    }

    // Keep the former diagnostic as a small, deterministic integration check:
    // a real launch enters the GOAL under its own flight, then transitions
    // into the declared classifier storage mechanism.
    // The first normal membership transition for each held-button launch
    // scores. While either physical ball settles through the high GOAL basin
    // it can touch that volume again, but that cannot create another
    // CLASSIFIED award.
    const launches = sim.events.filter((event) => event.kind === 'PieceLaunched');
    expect(sim.score.deltas.filter((delta) => delta.ruleId.includes('classified'))).toHaveLength(launches.length);
    expect(sawCapturedBasin).toBe(true);
    expect(sim.world.snapshot().pieces.some((piece) => piece.heldByRobotId === null)).toBe(true);
    expect(sawRollingDownClassifier).toBe(true);
    // A receiving basin is a short physical funnel, never a second storage
    // area at the top of the GOAL. Every accepted launch must have reached the
    // single-file classifier by the end of this controlled run.
    expect(sim.conveyors.inBasin('red-classifier')).toEqual([]);
  });

  it('does not admit an unaccepted loose ground ball into an open classifier', () => {
    const gate = centreOf(DECODE_ZONES.redGateZone);
    const sim = simulationFromDefinition(DECODE_GAME, {
      field: createDecodeField(),
      robots: [{
        config: DEFAULT_ROBOT_CONFIG,
        alliance: 'red',
        controller: constantController(NEUTRAL_INPUT),
        // The robot opens the live gate, proving that this is an elevated
        // admission guard rather than a closed-gate collision artifact.
        startPose: { p: vec2(inchesToMeters(gate[0]), inchesToMeters(gate[1])), theta: 0 },
      }],
      // This overlaps the top-down channel footprint, but it did not enter
      // through the raised GOAL opening. Height-gated GOAL membership, not a
      // plan-view overlap, is the only way into classifier storage.
      pieces: [{
        pieceId: 'loose',
        pieceType: 'P',
        diameterIn: ARTIFACT.specifiedDiameterIn.value,
        massLb: 0.3,
        startPositionM: vec2(inchesToMeters(69), inchesToMeters(57)),
      }],
    });

    for (let tick = 0; tick < 80; tick++) sim.step();

    const loose = sim.world.snapshot().pieces.find((piece) => piece.pieceId === 'loose');
    if (loose === undefined) throw new Error('loose artifact missing');
    expect(sim.conveyors.queued('red-classifier')).toEqual([]);
    expect(sim.conveyors.inBasin('red-classifier')).toEqual([]);
    expect(sim.conveyors.isOpen('red-classifier', sim.world.snapshot())).toBe(true);
    expect(loose.heldByRobotId).toBeNull();
    // The guard clears the ball beyond the channel wall instead of assigning a
    // fixed point beside the GOAL where future balls could pile up.
    expect(metersToInches(meters(loose.pose.p.x))).toBeLessThan(66);
    expect(sim.score.red).toBe(0);
  });

  it('keeps an open GATE one-way at the field-facing SECRET TUNNEL edge', () => {
    const gate = centreOf(DECODE_ZONES.redGateZone);
    const tunnel = DECODE_FIELD_ZONES.find((zone) => zone.id === DECODE_ZONES.blueSecretTunnel);
    if (tunnel?.shape.kind !== 'poly') throw new Error('blue SECRET TUNNEL missing');
    const minX = Math.min(...tunnel.shape.vertices.map((vertex) => vertex.x));
    const maxX = Math.max(...tunnel.shape.vertices.map((vertex) => vertex.x));
    const fieldFacingX = Math.abs(minX) < Math.abs(maxX) ? minX : maxX;
    const fieldDirection = Math.sign(fieldFacingX);

    const sim = simulationFromDefinition(DECODE_GAME, {
      field: createDecodeField(),
      robots: [{
        config: DEFAULT_ROBOT_CONFIG,
        alliance: 'red',
        controller: constantController(NEUTRAL_INPUT),
        startPose: { p: vec2(inchesToMeters(gate[0]), inchesToMeters(gate[1])), theta: 0 },
      }],
      pieces: [{
        pieceId: 'intruder',
        pieceType: 'P',
        diameterIn: ARTIFACT.specifiedDiameterIn.value,
        massLb: 0.3,
        // Start just inside the long edge a robot can reach from the field.
        startPositionM: vec2(fieldFacingX + fieldDirection * inchesToMeters(0.5), tunnel.centerM.y),
      }],
    });

    sim.step();

    const intruder = sim.world.snapshot().pieces.find((piece) => piece.pieceId === 'intruder');
    if (intruder === undefined) throw new Error('intruder missing');
    expect(sim.conveyors.isOpen('red-classifier', sim.world.snapshot())).toBe(true);
    // It is returned to the field side rather than allowed to use the open
    // GATE/tunnel as a reverse entrance.
    expect(fieldDirection * intruder.pose.p.x).toBeLessThan(fieldDirection * fieldFacingX);
    expect(sim.score.red).toBe(0);
  });
});
