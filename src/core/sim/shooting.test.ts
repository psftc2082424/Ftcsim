/**
 * Ball flight, and the shot that starts it.
 *
 * A launched piece leaves the plane the rest of the simulator lives in, so its
 * height is integrated separately (`physics/ballistics.ts`). With no drag the
 * horizontal and vertical components of projectile motion are independent, so
 * that split is exact — and closed-form range and apex exist to measure the
 * integration against, the way `analyticFreeSpeed` backs the drivetrain.
 *
 * The shot itself is composed in `shooter.ts` from three things, only one of
 * which is random. These assert all three separately and then together.
 */

import { describe, expect, it } from 'vitest';
import { DT_SECONDS, SimWorld, type GamePieceSpec } from './simWorld.js';
import { aimShot, pointVelocity, transitTimeSec, type ShotConditions } from './shooter.js';
import { analyticApex, analyticRange, stepVertical } from '../physics/ballistics.js';
import { NeutralController } from '../control/controller.js';
import { Pcg32, SubStream } from '../math/rng.js';
import { degreesToRadians, inchesToMeters, STANDARD_GRAVITY } from '../units/convert.js';
import { vec2 } from '../math/vec2.js';
import type { FieldTemplate } from '../field/fieldTemplate.js';
import type { LaunchCapability } from '../mechanism/capability.js';
import { DEFAULT_ROBOT_CONFIG } from '../robot/robotConfig.js';

/** No perimeter, so a shot measures a trajectory rather than a wall. */
export const OPEN_FIELD: FieldTemplate = {
  id: 'open',
  name: 'No perimeter',
  widthM: 1000,
  lengthM: 1000,
  bodies: [],
};

const ARTIFACT_DIAMETER_IN = 4.9;
const ARTIFACT_RADIUS_M = inchesToMeters(ARTIFACT_DIAMETER_IN) / 2;

const artifact = (pieceId: string, xIn: number, yIn: number): GamePieceSpec => ({
  pieceId,
  pieceType: 'P',
  diameterIn: ARTIFACT_DIAMETER_IN,
  massLb: 0.165,
  startPositionM: vec2(inchesToMeters(xIn), inchesToMeters(yIn)),
});

const SHOOTER: LaunchCapability = {
  kind: 'launch',
  pieceTypes: [],
  exitSpeedFtPerSec: 30,
  exitAngleDeg: 45,
  spreadDeg: 0,
  flywheelDiameterIn: 4,
  flywheelMassLb: 0.6,
  transferRatio: 0.5,
  shootOnMoveCompensation: 0,
};

const conditions = (patch: Partial<ShotConditions> = {}): ShotConditions => ({
  capability: SHOOTER,
  exitSpeedMps: 9,
  aimRad: 0,
  muzzleVelocity: vec2(0, 0),
  omegaRadPerSec: 0,
  pieceDiameterM: ARTIFACT_RADIUS_M * 2,
  fromHeightM: 0.5,
  ...patch,
});

const world = (pieces: readonly GamePieceSpec[]): SimWorld =>
  new SimWorld({
    robots: [
      {
        config: DEFAULT_ROBOT_CONFIG,
        controller: new NeutralController(),
        startPose: { p: vec2(-20, -20), theta: 0 },
      },
    ],
    pieces,
    field: OPEN_FIELD,
    seed: 7,
  });

describe('a piece falls under gravity', () => {
  it('accelerates downward at g', () => {
    const state = { heightM: 2, velocityMps: 0 };
    const after = stepVertical(state, ARTIFACT_RADIUS_M, DT_SECONDS);

    expect(after.state.velocityMps).toBeCloseTo(-STANDARD_GRAVITY * DT_SECONDS, 12);
  });

  it('comes to rest on its own radius and stays there', () => {
    let state = { heightM: 1, velocityMps: 0 };
    for (let i = 0; i < 400; i++) {
      state = stepVertical(state, ARTIFACT_RADIUS_M, DT_SECONDS).state;
    }

    expect(state.heightM).toBeCloseTo(ARTIFACT_RADIUS_M, 12);
    expect(state.velocityMps).toBe(0);
  });
});

describe('a launched piece flies the trajectory the closed form predicts', () => {
  /**
   * Fired flat-ground to flat-ground so the textbook range applies, and stepped
   * through the same integrator the world uses.
   */
  const flight = (speedMps: number, elevationDeg: number) => {
    const elevation = degreesToRadians(elevationDeg);
    let vertical = { heightM: ARTIFACT_RADIUS_M, velocityMps: speedMps * Math.sin(elevation) };
    const horizontalMps = speedMps * Math.cos(elevation);

    let x = 0;
    let apex = vertical.heightM;
    for (let i = 0; i < 4000; i++) {
      const step = stepVertical(vertical, ARTIFACT_RADIUS_M, DT_SECONDS);
      vertical = step.state;
      apex = Math.max(apex, vertical.heightM);
      if (step.landed) break;
      x += horizontalMps * DT_SECONDS;
    }
    return { rangeM: x, apexM: apex - ARTIFACT_RADIUS_M };
  };

  it('lands within a timestep of v squared sin 2 theta over g', () => {
    const speed = 9;
    const elevationDeg = 45;
    const measured = flight(speed, elevationDeg);
    const predicted = analyticRange(speed, degreesToRadians(elevationDeg));

    // One tick of horizontal travel is the whole of the discretisation error.
    expect(Math.abs(measured.rangeM - predicted)).toBeLessThan(
      speed * Math.cos(degreesToRadians(elevationDeg)) * DT_SECONDS * 2,
    );
  });

  /**
   * The apex lands *below* the closed form by exactly half a step of vertical
   * velocity, which is the symplectic integrator's half-step and not an error
   * to be tolerated away. Asserted as the identity it is.
   */
  it('peaks half a vertical step below the closed-form apex', () => {
    const speed = 9;
    const elevation = degreesToRadians(45);
    const measured = flight(speed, 45);
    const predicted = analyticApex(speed, elevation);

    const halfStep = (speed * Math.sin(elevation) * DT_SECONDS) / 2;
    expect(predicted - measured.apexM).toBeGreaterThan(0);
    expect(predicted - measured.apexM).toBeLessThan(halfStep * 1.1);
  });
});

describe('composing a shot', () => {
  const rng = () => new Pcg32(1, SubStream.Launch);

  it('leaves along the aim when the robot is still and the shooter perfect', () => {
    const shot = aimShot(conditions({ aimRad: 0.7 }), rng());

    expect(shot.headingRad).toBeCloseTo(0.7, 12);
    expect(shot.speedMps).toBeCloseTo(9, 12);
    expect(shot.elevationRad).toBeCloseTo(degreesToRadians(45), 12);
  });

  /**
   * The whole shoot-on-move model in one assertion: a ball leaving a robot that
   * is moving sideways carries that sideways velocity, so it goes off by
   * exactly `atan(v_side / v_forward)` — a real angle, not a percentage.
   */
  it('carries the robot velocity, deflecting the shot by an arctangent', () => {
    const sideways = 1;
    const shot = aimShot(conditions({ muzzleVelocity: vec2(0, sideways) }), rng());

    const horizontal = 9 * Math.cos(degreesToRadians(45));
    expect(shot.headingRad).toBeCloseTo(Math.atan2(sideways, horizontal), 12);
  });

  it('cancels that deflection in proportion to the compensation', () => {
    const withHalf = aimShot(
      conditions({
        capability: { ...SHOOTER, shootOnMoveCompensation: 0.5 },
        muzzleVelocity: vec2(0, 1),
      }),
      rng(),
    );

    const horizontal = 9 * Math.cos(degreesToRadians(45));
    expect(withHalf.headingRad).toBeCloseTo(Math.atan2(0.5, horizontal), 12);
  });

  it('leaves a fully compensated shooter dead on aim however fast it moves', () => {
    const shot = aimShot(
      conditions({
        capability: { ...SHOOTER, shootOnMoveCompensation: 1 },
        muzzleVelocity: vec2(2, 3),
        omegaRadPerSec: 4,
      }),
      rng(),
    );

    expect(shot.headingRad).toBeCloseTo(0, 12);
    expect(shot.speedMps).toBeCloseTo(9, 12);
  });

  /** A turning robot smears the shot by however far it rotated in transit. */
  it('smears the aim by omega times the transit time', () => {
    const omega = 3;
    const shot = aimShot(conditions({ omegaRadPerSec: omega }), rng());

    expect(shot.headingRad).toBeCloseTo(omega * transitTimeSec(ARTIFACT_RADIUS_M * 2, 9), 12);
  });

  it('spends less time in the shooter the faster the shot', () => {
    expect(transitTimeSec(0.12, 12)).toBeLessThan(transitTimeSec(0.12, 6));
  });

  it('draws nothing from the generator when the spread is zero', () => {
    const untouched = rng();
    aimShot(conditions(), untouched);
    expect(untouched.nextFloat()).toBe(rng().nextFloat());
  });

  it('stays inside the spread cone and is reproducible from the seed', () => {
    const capability = { ...SHOOTER, spreadDeg: 10 };
    const half = degreesToRadians(5);

    const draw = (): number[] => {
      const generator = rng();
      return Array.from(
        { length: 200 },
        () => aimShot(conditions({ capability }), generator).headingRad,
      );
    };

    const first = draw();
    expect(draw()).toEqual(first);
    for (const heading of first) expect(Math.abs(heading)).toBeLessThanOrEqual(half);
  });
});

describe('a point on a rotating robot', () => {
  it('adds omega cross r to the chassis velocity', () => {
    const at = pointVelocity(vec2(1, 0), 2, vec2(0.3, 0));
    expect(at.x).toBeCloseTo(1, 12);
    expect(at.y).toBeCloseTo(0.6, 12);
  });

  it('is the chassis velocity at the centre of rotation', () => {
    const at = pointVelocity(vec2(1, -2), 5, vec2(0, 0));
    expect(at).toEqual(vec2(1, -2));
  });
});

describe('the world puts a launched piece in the air', () => {
  it('gives it height, climb rate and a horizontal velocity', () => {
    const sim = world([artifact('a', 0, 0)]);
    sim.launchPiece('a', {
      speedMps: 9,
      elevationRad: degreesToRadians(45),
      headingRad: 0,
      fromHeightM: 0.5,
    });

    const piece = sim.snapshot().pieces[0];
    expect(piece?.airborne).toBe(true);
    expect(piece?.heightM).toBeCloseTo(0.5, 12);
    expect(piece?.verticalVelocityMps).toBeCloseTo(9 * Math.sin(degreesToRadians(45)), 12);
    expect(piece?.vel.v.x).toBeCloseTo(9 * Math.cos(degreesToRadians(45)), 12);
  });

  it('refuses a negative launch speed rather than flying backwards', () => {
    const sim = world([artifact('a', 0, 0)]);
    expect(() => sim.launchPiece('a', { speedMps: -1, elevationRad: 0, headingRad: 0 })).toThrow(
      /non-negative/,
    );
  });

  it('names the piece it cannot find', () => {
    const sim = world([artifact('a', 0, 0)]);
    expect(() => sim.launchPiece('nope', { speedMps: 1, elevationRad: 0, headingRad: 0 })).toThrow(
      /nope/,
    );
  });

  /**
   * Height is state, so the determinism digest has to cover it. A shot that
   * diverged only in the air would otherwise slip past the canary.
   */
  it('changes the state hash when a piece is launched', () => {
    const before = world([artifact('a', 0, 0)]);
    const after = world([artifact('a', 0, 0)]);
    after.launchPiece('a', { speedMps: 5, elevationRad: 0.5, headingRad: 0 });

    expect(after.stateHash()).not.toBe(before.stateHash());
  });
});
