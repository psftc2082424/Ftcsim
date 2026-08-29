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
    let sawProtectedFunnel = false;
    let sawProtectedClassifierEntry = false;
    let sawPhysicalClassifier = false;
    for (let i = 0; i < 700; i++) {
      sim.step();
      const inBasin = sim.conveyors.inBasin('red-classifier').includes('a1');
      if (inBasin) sawCapturedBasin = true;
      const a1 = sim.world.snapshot().pieces.find((piece) => piece.pieceId === 'a1');
      if (a1 === undefined) continue;
      if (inBasin) {
        // Every valid shot follows the shared funnel without ball-to-ball
        // contact. This prevents a preceding accepted shot from knocking a
        // later one sideways into the GOAL basin.
        expect(a1.transferring).toBe(true);
        sawProtectedFunnel = true;
      }
      if (sim.conveyors.queued('red-classifier').includes('a1')) {
        // The protected shot must clear the ordered entry run before it
        // becomes a normal colliding classifier ball. This prevents a trailing
        // launch from clipping it sideways through the entrance rails.
        if (a1.transferring) sawProtectedClassifierEntry = true;
        else {
          // A classifier member is still an ordinary dynamic body: it is not
          // held, parked, or kinematic while the lane guide/collision solver
          // packs it below the GOAL throat.
          expect(a1.heldByRobotId).toBeNull();
          expect(Math.hypot(a1.vel.v.x, a1.vel.v.y)).toBeGreaterThan(0);
          sawPhysicalClassifier = true;
        }
      }
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
    expect(sawProtectedFunnel).toBe(true);
    expect(sawProtectedClassifierEntry).toBe(true);
    expect(sawPhysicalClassifier).toBe(true);
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
    // The barrier does not relocate the ball; it simply rejects its attempted
    // ground-level classifier entry. It remains loose and unscored.
    // The nearby physical arm/rail may resolve a fraction of an inch of
    // overlap, but the loose ball must stay local rather than being routed to
    // the GOAL or classifier state.
    // The complete raised-channel guard resolves it onto the public field
    // side; it is neither admitted nor left beneath the elevated classifier.
    expect(metersToInches(meters(loose.pose.p.x))).toBeLessThan(66);
    expect(sim.score.red).toBe(0);
  });

  it('keeps a loose ball physically outside an open raised GATE without a pose snap', () => {
    const gate = centreOf(DECODE_ZONES.redGateZone);
    const lane = centreOf(DECODE_REGIONS.redRamp);
    const sim = simulationFromDefinition(DECODE_GAME, {
      field: createDecodeField(),
      robots: [{
        config: DEFAULT_ROBOT_CONFIG,
        alliance: 'red',
        controller: constantController(NEUTRAL_INPUT),
        // Touch the release tape from its field side rather than spawning the
        // robot through the physical gate mouth.
        startPose: { p: vec2(inchesToMeters(gate[0] - 4.5), inchesToMeters(gate[1])), theta: 0 },
      }],
      pieces: [{
        pieceId: 'pushed-loose',
        pieceType: 'P',
        diameterIn: ARTIFACT.specifiedDiameterIn.value,
        massLb: 0.3,
        startPositionM: vec2(inchesToMeters(lane[0]), inchesToMeters(-12)),
      }],
    });

    // This is the same inbound motion a robot push supplies, isolated from
    // drivetrain tuning: a normal floor ball travels toward the open mouth.
    sim.world.releasePieceMoving('pushed-loose', vec2(inchesToMeters(lane[0]), inchesToMeters(-12)), vec2(0, inchesToMeters(48)));

    let previousY: number = inchesToMeters(-12);
    let largestStepM = 0;
    let furthestInM: number = previousY;
    for (let tick = 0; tick < 150; tick++) {
      sim.step();
      const piece = sim.world.snapshot().pieces.find((candidate) => candidate.pieceId === 'pushed-loose');
      if (piece === undefined) throw new Error('loose artifact missing');
      largestStepM = Math.max(largestStepM, Math.abs(piece.pose.p.y - previousY));
      previousY = piece.pose.p.y;
      furthestInM = Math.max(furthestInM, piece.pose.p.y);
      expect(piece.transferring).toBe(false);
      expect(piece.heightM).toBeCloseTo(piece.radiusM, 12);
    }

    expect(sim.conveyors.isOpen('red-classifier', sim.world.snapshot())).toBe(true);
    expect(sim.conveyors.queued('red-classifier')).toEqual([]);
    expect(sim.conveyors.inBasin('red-classifier')).toEqual([]);
    // The low physical threshold is at y=0.5 in. The ball never reaches the
    // elevated classifier side of that plane, and no step may resemble the
    // old coordinate rollback into the lane or human-player return.
    expect(furthestInM).toBeLessThan(inchesToMeters(0));
    expect(largestStepM).toBeLessThan(inchesToMeters(1));
  });

  it('never admits or guides randomized loose pushes against an open classifier', () => {
    // Fixed-seed samples keep this an entrance stress regression rather than
    // a flaky UI test. Each approaches a different public-side point/angle
    // while a robot holds the GATE open.
    let seed = 0xdec0de;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const gate = centreOf(DECODE_ZONES.redGateZone);
    const lane = centreOf(DECODE_REGIONS.redRamp);

    for (let sample = 0; sample < 12; sample++) {
      const start = vec2(inchesToMeters(lane[0] - 5 + next() * 3), inchesToMeters(-18 + next() * 14));
      const sim = simulationFromDefinition(DECODE_GAME, {
        field: createDecodeField(),
        robots: [{
          config: DEFAULT_ROBOT_CONFIG,
          alliance: 'red',
          controller: constantController(NEUTRAL_INPUT),
          startPose: { p: vec2(inchesToMeters(gate[0] - 4.5), inchesToMeters(gate[1])), theta: 0 },
        }],
        pieces: [{
          pieceId: `loose-${sample}`,
          pieceType: 'P',
          diameterIn: ARTIFACT.specifiedDiameterIn.value,
          massLb: 0.3,
          startPositionM: start,
        }],
      });
      const id = `loose-${sample}`;
      sim.world.releasePieceMoving(
        id,
        start,
        vec2(inchesToMeters(-8 + next() * 16), inchesToMeters(36 + next() * 24)),
      );

      for (let tick = 0; tick < 120; tick++) {
        sim.step();
        const during = sim.world.snapshot().pieces.find((candidate) => candidate.pieceId === id);
        if (during === undefined) throw new Error('stress artifact missing during run');
        // The check is per tick so a brief accidental entry followed by a
        // release cannot hide behind the final snapshot.
        expect(sim.conveyors.queued('red-classifier')).not.toContain(id);
        expect(sim.conveyors.inBasin('red-classifier')).not.toContain(id);
        expect(during.transferring).toBe(false);
        expect(during.heightM).toBeCloseTo(during.radiusM, 12);
      }
      const piece = sim.world.snapshot().pieces.find((candidate) => candidate.pieceId === id);
      if (piece === undefined) throw new Error('stress artifact missing');
      expect(sim.conveyors.isOpen('red-classifier', sim.world.snapshot())).toBe(true);
      expect(sim.conveyors.queued('red-classifier')).not.toContain(id);
      expect(sim.conveyors.inBasin('red-classifier')).not.toContain(id);
      expect(piece.transferring).toBe(false);
      expect(piece.heightM).toBeCloseTo(piece.radiusM, 12);
    }
  });

  it('keeps an open GATE one-way at the field-facing SECRET TUNNEL edge', () => {
    const gate = centreOf(DECODE_ZONES.redGateZone);
    const tunnel = DECODE_FIELD_ZONES.find((zone) => zone.id === DECODE_ZONES.blueSecretTunnel);
    if (tunnel?.shape.kind !== 'poly') throw new Error('blue SECRET TUNNEL missing');
    const minX = Math.min(...tunnel.shape.vertices.map((vertex) => vertex.x));
    const maxX = Math.max(...tunnel.shape.vertices.map((vertex) => vertex.x));
    const downstreamY = Math.min(...tunnel.shape.vertices.map((vertex) => vertex.y));
    const gateSideY = Math.max(...tunnel.shape.vertices.map((vertex) => vertex.y));
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
    // It is held locally on the public side of the GATE—not teleported to the
    // human-player end of the SECRET TUNNEL—and cannot reverse into the lane.
    expect(intruder.pose.p.y).toBeLessThan(gateSideY - intruder.radiusM * 2);
    expect(intruder.pose.p.y).toBeGreaterThan(downstreamY + intruder.radiusM * 2);
    expect(sim.score.red).toBe(0);
  });
});
