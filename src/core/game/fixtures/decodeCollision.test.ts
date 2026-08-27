import { describe, expect, it } from 'vitest';
import { createCircle } from '../../physics/shapes.js';
import { collide } from '../../physics/sat.js';
import { bodyAabb } from '../../physics/body.js';
import { vec2 } from '../../math/vec2.js';
import { DEFAULT_ROBOT_CONFIG } from '../../robot/robotConfig.js';
import { constantController } from '../../control/scripted.js';
import { NEUTRAL_INPUT } from '../../control/controlInput.js';
import { SimWorld } from '../../sim/simWorld.js';
import { inchesToMeters } from '../../units/convert.js';
import { DECODE_REGIONS, DECODE_ZONES } from './decode.js';
import { DECODE_FIELD_ZONES } from './decodeField.js';
import {
  createDecodeField,
  DECODE_FIELD_COLLISION_CLASSIFICATION,
  DECODE_GAME_LOGIC_REGION_IDS,
} from './decodeCollision.js';
import { FIELD, GOAL, ZONES } from './decodeDimensions.js';

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

  it('models the GOAL as two solid backstop legs around an open interior', () => {
    const field = createDecodeField();

    // Four standard perimeter walls, two GOAL backstop legs per alliance
    // (back + side), two raised classifier channels and two side-railed
    // SECRET TUNNEL corridors (two rails each). The GOAL used to be one
    // filled triangle; it is now hollow, because a filled shape gave a
    // scored ARTIFACT nowhere to rest — see `goalWallBodies`.
    expect(field.bodies).toHaveLength(14);
    expect(classified('red-goal-shell').hasCollisionBody).toBe(true);
    expect(classified('blue-goal-shell').hasCollisionBody).toBe(true);
    expect(classified('red-ramp-assembly').hasCollisionBody).toBe(true);
    expect(classified('red-goal-opening').classification).toBe('PASSABLE');
    expect(classified('red-goal-opening').hasCollisionBody).toBe(false);
    expect(field.bodies[4]?.shape.kind).toBe('obb');
    expect(field.bodies[5]?.shape.kind).toBe('obb');
  });

  /** Points inside the red GOAL footprint, in the fixture's own frame. */
  function redGoalPoints() {
    const half = FIELD.sideIn.value / 2;
    const openingWidthIn = GOAL.openingWidthIn.value;
    const openingDepthIn = GOAL.openingDepthIn.value;
    // Red occupies -X (`goalSide`).
    const backLegCenter = vec2(inchesToMeters(-(half - openingWidthIn / 2)), inchesToMeters(half));
    const sideLegCenter = vec2(inchesToMeters(-half), inchesToMeters(half - openingDepthIn / 2));
    // Well inside both legs and off the open (diagonal) face: nothing should
    // be there to collide with.
    const interior = vec2(
      inchesToMeters(-(half - openingWidthIn / 3)),
      inchesToMeters(half - openingDepthIn / 3),
    );
    return { backLegCenter, sideLegCenter, interior };
  }

  it('blocks a robot at either GOAL backstop leg', () => {
    const field = createDecodeField();
    const { backLegCenter, sideLegCenter } = redGoalPoints();

    for (const start of [backLegCenter, sideLegCenter]) {
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
  it('leaves the GOAL interior empty so a scored artifact can rest there', () => {
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
    expect(Math.hypot(artifact.pose.p.x - interior.x, artifact.pose.p.y - interior.y)).toBeLessThan(0.001);
  });

  it('keeps the physical tunnel opening passable below the raised classifier', () => {
    const field = createDecodeField();
    const classifier = field.bodies.find((body) => body.id === 2104);
    if (classifier === undefined) throw new Error('red classifier missing');
    const bounds = bodyAabb(classifier);

    // The classifier starts at the GATE line.  The 46.5 in SECRET TUNNEL is
    // south of it, so no static fixture closes that floor-level passage.
    expect(bounds.minY).toBeCloseTo(inchesToMeters(2), 12);
    expect(classifier.span.bottom).toBeCloseTo(inchesToMeters(5.5), 12);
  });

  it('gives the SECRET TUNNEL a real, side-railed corridor', () => {
    expect(classified('red-secret-tunnel').hasCollisionBody).toBe(true);
    expect(classified('blue-secret-tunnel').hasCollisionBody).toBe(true);

    const field = createDecodeField();
    const redTunnel = field.bodies.find((body) => body.id === 2106);
    const otherRail = field.bodies.find((body) => body.id === 2107);
    if (redTunnel === undefined || otherRail === undefined) {
      throw new Error('SECRET TUNNEL rails missing');
    }

    const zone = DECODE_FIELD_ZONES.find((candidate) => candidate.id === DECODE_ZONES.redSecretTunnel);
    if (zone === undefined) throw new Error('red secret tunnel zone missing');

    // Both rails sit outside the sourced 6.125 in corridor width, one on each
    // side, so nothing narrows the passage an ARTIFACT actually rolls through.
    const halfWidthM = inchesToMeters(ZONES.secretTunnelWidthIn.value) / 2;
    const gap = Math.abs(redTunnel.pose.p.x - otherRail.pose.p.x) / 2 - halfWidthM;
    expect(gap).toBeGreaterThanOrEqual(0);
    // The rails are centred a little south of the corridor itself: they
    // extend past its real length on the open (-Y) end only, so a wide robot
    // cannot get bumper-to-piece with anything actually inside the sourced
    // corridor (`TUNNEL_RAIL_OPEN_END_FLARE_IN`).
    expect(redTunnel.pose.p.y).toBeLessThan(zone.centerM.y);
  });

  /**
   * A ball travelling along the corridor's own axis passes clean through: the
   * rails bound the sides, not the ends the manual actually routes ARTIFACTS
   * through.
   */
  it('lets an ARTIFACT travel the length of the SECRET TUNNEL corridor', () => {
    const field = createDecodeField();
    const zone = DECODE_FIELD_ZONES.find((candidate) => candidate.id === DECODE_ZONES.redSecretTunnel);
    if (zone === undefined) throw new Error('red secret tunnel zone missing');

    // Half the nominal 4.9 in ARTIFACT diameter.
    const artifact = createCircle(inchesToMeters(2.45));
    for (const rail of field.bodies.filter((body) => body.id === 2106 || body.id === 2107)) {
      const contact = collide(
        artifact,
        { p: vec2(zone.centerM.x, zone.centerM.y), theta: 0 },
        rail.shape,
        rail.pose,
      );
      expect(contact, `rail ${rail.id} at the corridor centre`).toBeNull();
    }
  });

  it('does not invent a collision body for CAD-only gate parts', () => {
    for (const id of ['red-gate', 'blue-gate']) {
      expect(classified(id).classification).toBe('SOLID / COLLIDABLE');
      expect(classified(id).hasCollisionBody).toBe(false);
    }
  });
});
