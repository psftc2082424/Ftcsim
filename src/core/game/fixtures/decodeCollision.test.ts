import { describe, expect, it } from 'vitest';
import { vec2 } from '../../math/vec2.js';
import { DEFAULT_ROBOT_CONFIG } from '../../robot/robotConfig.js';
import { constantController } from '../../control/scripted.js';
import { NEUTRAL_INPUT } from '../../control/controlInput.js';
import { SimWorld } from '../../sim/simWorld.js';
import { inchesToMeters } from '../../units/convert.js';
import { DECODE_REGIONS, DECODE_ZONES } from './decode.js';
import {
  createDecodeField,
  CLASSIFIER_CHANNEL_WIDTH_IN,
  DECODE_FIELD_COLLISION_CLASSIFICATION,
  DECODE_GAME_LOGIC_REGION_IDS,
} from './decodeCollision.js';
import { createDecodeAssemblies } from './decodeAssemblies.js';
import { ARTIFACT, CLASSIFIER_SINGLE_FILE_CLEAR_WIDTH_IN, FIELD, GOAL } from './decodeDimensions.js';

const classified = (id: string) => {
  const entry = DECODE_FIELD_COLLISION_CLASSIFICATION.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`missing classification for ${id}`);
  return entry;
};

describe('DECODE collision classification', () => {
  it('keeps tape and rule geometry out of static collision bodies', () => {
    for (const id of [
      'red-gate-zone',
      'blue-gate-zone',
      'red-base-zone',
      'blue-base-zone',
      'audience-launch-zone',
      'goal-launch-zone',
      'spike-marks',
    ]) {
      expect(classified(id).hasCollisionBody).toBe(false);
    }

    // The scoring destinations are membership ids, not obstacle identifiers.
    expect([...DECODE_GAME_LOGIC_REGION_IDS]).toEqual(
      expect.arrayContaining([
        DECODE_REGIONS.redGoal,
        DECODE_REGIONS.blueGoal,
        DECODE_REGIONS.redRamp,
        DECODE_REGIONS.blueRamp,
        DECODE_ZONES.redSecretTunnel,
        DECODE_ZONES.blueSecretTunnel,
      ]),
    );
  });

  it('models a hollow GOAL, physical classifier rails, and live gate colliders', () => {
    const field = createDecodeField();

    // Four perimeter walls, a complete low GOAL face, a continuous
    // outer rail, two inner-rail segments, a low elevated-arch guard per
    // alliance, two live gates, and a low raised-platform threshold per gate.
    // The taped tunnel itself has no wall bodies.
    expect(field.bodies).toHaveLength(22);
    expect(classified('red-goal-shell').hasCollisionBody).toBe(true);
    expect(classified('blue-goal-shell').hasCollisionBody).toBe(true);
    expect(classified('red-ramp-assembly').hasCollisionBody).toBe(true);
    expect(classified('red-goal-opening').classification).toBe('PASSABLE');
    expect(classified('red-goal-opening').hasCollisionBody).toBe(false);
    expect(field.colliderTags?.['red-classifier-gate']).toEqual([2112]);
    expect(field.colliderTags?.['blue-classifier-gate']).toEqual([2113]);
  });

  it('mirrors the classifier rails and sole GOAL arch across alliances', () => {
    const field = createDecodeField();
    // Three red rails (2106–2108) and their blue mirror (2109–2111): the
    // perimeter rail is continuous and the field-facing rail alone is split
    // at the same elevated GOAL arch on both sides.
    for (let offset = 0; offset < 3; offset++) {
      const red = field.bodies.find((body) => body.id === 2106 + offset);
      const blue = field.bodies.find((body) => body.id === 2109 + offset);
      if (red === undefined || blue === undefined) throw new Error('classifier rail missing');
      expect(red.pose.p.x).toBeCloseTo(-blue.pose.p.x, 9);
      expect(red.pose.p.y).toBeCloseTo(blue.pose.p.y, 9);
    }
  });

  it('derives every DECODE fixture collider from the matching canonical assembly part', () => {
    const field = createDecodeField();
    const colliderParts = createDecodeAssemblies(2100)
      .flatMap((assembly) => assembly.parts)
      .filter((part) => part.collider !== undefined && part.geometry.kind === 'obb');

    expect(colliderParts).toHaveLength(18);
    for (const part of colliderParts) {
      const body = field.bodies.find((candidate) => candidate.id === part.collider?.id);
      expect(body).toBeDefined();
      if (body === undefined || part.geometry.kind !== 'obb') continue;
      expect(body.pose).toEqual(part.geometry.pose);
      expect(body.span).toEqual(part.collider?.span);
      expect(body.shape.kind).toBe('obb');
      if (body.shape.kind !== 'obb') continue;
      expect(body.shape.halfExtents.x * 2).toBeCloseTo(part.geometry.widthM, 12);
      expect(body.shape.halfExtents.y * 2).toBeCloseTo(part.geometry.lengthM, 12);
    }
  });

  it('makes the physical classifier exactly one ARTIFACT wide, not a six-inch parking area', () => {
    // 4.9 in specified ball diameter plus only the 0.1 in dSim running
    // clearance: two ARTIFACTS cannot occupy a cross-section side-by-side.
    expect(CLASSIFIER_CHANNEL_WIDTH_IN).toBe(ARTIFACT.specifiedDiameterIn.value + 0.1);
    expect(CLASSIFIER_CHANNEL_WIDTH_IN).toBe(CLASSIFIER_SINGLE_FILE_CLEAR_WIDTH_IN.value);
  });

  /** Points inside the red GOAL footprint, in the fixture's own frame. */
  function redGoalPoints() {
    const half = FIELD.sideIn.value / 2;
    const openingWidthIn = GOAL.openingWidthIn.value;
    const openingDepthIn = GOAL.openingDepthIn.value;
    // Red's GOAL is cross-court at +X; red's staging/alliance half remains -X.
    const backLegCenter = vec2(inchesToMeters(half - openingWidthIn / 2), inchesToMeters(half));
    const sideLegCenter = vec2(inchesToMeters(half), inchesToMeters(half - openingDepthIn / 2));
    // Well inside the hollow basin and away from every boundary wall.
    const interior = vec2(
      inchesToMeters(half - openingWidthIn / 3),
      inchesToMeters(half - 3),
    );
    return { backLegCenter, sideLegCenter, interior };
  }

  it('blocks a robot at every GOAL boundary, including the field-facing face', () => {
    const field = createDecodeField();
    const { backLegCenter, sideLegCenter } = redGoalPoints();
    const faceCenter = vec2(inchesToMeters(72 - GOAL.openingWidthIn.value / 2), inchesToMeters(72 - GOAL.openingDepthIn.value / 2));

    for (const start of [backLegCenter, sideLegCenter, faceCenter]) {
      const world = new SimWorld({
        field,
        robots: [{
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(NEUTRAL_INPUT),
          startPose: { p: start, theta: 0 },
        }],
      });

      world.stepMany(10);
      const robot = world.snapshot().robots[0];
      if (robot === undefined) throw new Error('robot missing');
      expect(Math.hypot(robot.pose.p.x - start.x, robot.pose.p.y - start.y)).toBeGreaterThan(0.01);
    }
  });

  /**
   * The bug this fixture used to have: a filled triangle has no "inside" —
   * a piece placed in the GOAL's own interior, clear of both backstop legs,
   * was in deep collision with the fill and got shoved out. The legs alone
   * leave that interior genuinely empty, so a piece resting there — exactly
   * where an ARTIFACT lands after arcing over the opening lip — stays put.
   */
  it('keeps a scored artifact constrained inside the hollow GOAL basin', () => {
    const field = createDecodeField();
    const { interior } = redGoalPoints();

    const world = new SimWorld({
      field,
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: constantController(NEUTRAL_INPUT) }],
      pieces: [{ pieceId: 'artifact', pieceType: 'P', diameterIn: 4.9, massLb: 0.165, startPositionM: interior }],
    });

    world.stepMany(30);
    const artifact = world.snapshot().pieces[0];
    if (artifact === undefined) throw new Error('artifact missing');
    // The thin boundary walls may settle a ball a little away from its authored
    // starting point, but must not eject it across the field-facing face.
    expect(Math.hypot(artifact.pose.p.x - interior.x, artifact.pose.p.y - interior.y)).toBeLessThan(inchesToMeters(2));
  });

  it('blocks a loose ground ARTIFACT at the GOAL/classifier arch while preserving the raised path', () => {
    const field = createDecodeField();
    const world = new SimWorld({
      field,
      robots: [{
        config: DEFAULT_ROBOT_CONFIG,
        controller: constantController(NEUTRAL_INPUT),
        startPose: { p: vec2(inchesToMeters(-50), inchesToMeters(-50)), theta: 0 },
      }],
      pieces: [{
        pieceId: 'loose',
        pieceType: 'P',
        diameterIn: ARTIFACT.specifiedDiameterIn.value,
        massLb: 0.165,
        // The field-facing side of the red Goal Archway. A 2D-only gap here
        // used to let a robot shove floor balls into the raised classifier.
        startPositionM: vec2(inchesToMeters(63), inchesToMeters(57)),
      }],
    });

    world.setPieceVelocity('loose', vec2(inchesToMeters(80), 0));
    world.stepMany(100);

    const loose = world.snapshot().pieces[0];
    if (loose === undefined) throw new Error('loose artifact missing');
    // The low Archway guard is a real fixture collider: the ball cannot cross
    // the 66 in field rail into the elevated single-file channel.
    expect(loose.pose.p.x).toBeLessThan(inchesToMeters(66));
    expect(loose.heightM).toBeCloseTo(loose.radiusM, 12);
  });

  it('keeps the SECRET TUNNEL as passable tape, not a collider corridor', () => {
    const field = createDecodeField();
    expect(classified('red-secret-tunnel').classification).toBe('PASSABLE');
    expect(classified('red-secret-tunnel').hasCollisionBody).toBe(false);
    // 2114/2115 are low Goal Archway guards, 2116/2117 are full front-face
    // low guards, and 2118/2119 are low GATE thresholds—not tunnel walls.
    // The tunnel itself remains a passable tape surface with no bodies.
    expect(field.bodies.filter((body) => body.id >= 2118).map((body) => body.id)).toEqual([2118, 2119]);
  });

  it('declares the physical gate collider rather than turning its zone into a wall', () => {
    for (const id of ['red-gate', 'blue-gate']) {
      expect(classified(id).classification).toBe('SOLID / COLLIDABLE');
      expect(classified(id).hasCollisionBody).toBe(true);
    }
  });
});
