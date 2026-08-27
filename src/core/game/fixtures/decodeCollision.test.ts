import { describe, expect, it } from 'vitest';
import { createCircle } from '../../physics/shapes.js';
import { collide } from '../../physics/sat.js';
import { vec2 } from '../../math/vec2.js';
import { DEFAULT_ROBOT_CONFIG } from '../../robot/robotConfig.js';
import { constantController } from '../../control/scripted.js';
import { NEUTRAL_INPUT } from '../../control/controlInput.js';
import { SimWorld } from '../../sim/simWorld.js';
import { inchesToMeters } from '../../units/convert.js';
import { DECODE_REGIONS, DECODE_ZONES } from './decode.js';
import {
  createDecodeField,
  DECODE_FIELD_COLLISION_CLASSIFICATION,
  DECODE_GAME_LOGIC_REGION_IDS,
} from './decodeCollision.js';
import { GOAL } from './decodeDimensions.js';

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
      'red-secret-tunnel',
      'blue-secret-tunnel',
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

  it('models the documented goal shell but leaves its opening passable', () => {
    const field = createDecodeField();

    // Four standard perimeter walls plus a three-sided shell per GOAL.
    expect(field.bodies).toHaveLength(10);
    expect(classified('red-goal-shell').hasCollisionBody).toBe(true);
    expect(classified('blue-goal-shell').hasCollisionBody).toBe(true);
    expect(classified('red-goal-opening').classification).toBe('PASSABLE');
    expect(classified('red-goal-opening').hasCollisionBody).toBe(false);
  });

  it('blocks an artifact at a solid GOAL shell', () => {
    const field = createDecodeField();
    const blueBackPanel = field.bodies[9];
    if (blueBackPanel === undefined) throw new Error('blue GOAL back panel missing');

    const artifact = createCircle(inchesToMeters(4.9) / 2);
    const contact = collide(artifact, { p: blueBackPanel.pose.p, theta: 0 }, blueBackPanel.shape, blueBackPanel.pose);

    expect(contact).not.toBeNull();
    expect(contact?.depth ?? 0).toBeGreaterThan(0);
    expect(blueBackPanel.span.top).toBeCloseTo(inchesToMeters(GOAL.heightIn.value), 12);
  });

  it('resolves a loose artifact out of the solid shell in the live world', () => {
    const field = createDecodeField();
    const blueBackPanel = field.bodies[9];
    if (blueBackPanel === undefined || blueBackPanel.shape.kind !== 'obb') {
      throw new Error('blue GOAL back panel missing');
    }

    // Start deliberately overlapping the panel's south face.  The world must
    // use the same static fixture body for a piece as it does for a robot.
    const start = vec2(blueBackPanel.pose.p.x, blueBackPanel.pose.p.y - 0.04);
    const world = new SimWorld({
      field,
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: constantController(NEUTRAL_INPUT) }],
      pieces: [{ pieceId: 'artifact', pieceType: 'P', diameterIn: 4.9, massLb: 0.165, startPositionM: start }],
    });

    world.stepMany(10);
    const artifact = world.snapshot().pieces[0];
    if (artifact === undefined) throw new Error('artifact missing');

    const residual = collide(
      createCircle(artifact.radiusM),
      artifact.pose,
      blueBackPanel.shape,
      blueBackPanel.pose,
    );
    expect(residual?.depth ?? 0).toBeLessThanOrEqual(0.0011);
  });

  it('does not invent a collision body for CAD-only ramp or gate parts', () => {
    for (const id of ['red-ramp-assembly', 'blue-ramp-assembly', 'red-gate', 'blue-gate']) {
      expect(classified(id).classification).toBe('SOLID / COLLIDABLE');
      expect(classified(id).hasCollisionBody).toBe(false);
    }
  });
});
