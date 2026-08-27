/**
 * Telemetry sampling.
 *
 * Samples are taken from a `WorldSnapshot` at 10 Hz, not every tick and not
 * every frame. That rate is the whole point: it decouples what the UI renders
 * from how fast the simulation runs, so React never re-renders at 200 Hz
 * (ARCHITECTURE.md §9, ASSUMPTIONS.md §4.3).
 *
 * Values are emitted in **SI**, because this is `core/`. Conversion to
 * FTC-facing units happens once, in the UI, through `units/convert.ts`.
 *
 * Only quantities that actually exist in Phase 1 are reported. Game pieces held,
 * intake and scoring rates, score and mechanism state belong to systems that
 * have not been built; emitting zeros for them would be a placeholder pretending
 * a feature exists.
 */

import type { WheelValues } from '../drive/mecanumKinematics.js';
import { mapWheels } from '../drive/mecanumKinematics.js';
import type { EntityId } from '../physics/body.js';
import type { WorldSnapshot } from '../sim/snapshot.js';

export interface RobotTelemetry {
  readonly id: EntityId;
  readonly name: string;

  // --- Pose, SI ---
  readonly xM: number;
  readonly yM: number;
  readonly headingRad: number;

  // --- Motion, SI ---
  readonly speedMps: number;
  readonly forwardMps: number;
  readonly strafeMps: number;
  readonly angularVelocityRadPerSec: number;
  readonly accelerationMps2: number;

  // --- Drivetrain, SI ---
  readonly duties: WheelValues;
  readonly motorSpeedsRadPerSec: WheelValues;
  readonly wheelSpeedsRadPerSec: WheelValues;
  readonly motorTorquesNm: WheelValues;
  readonly motorCurrentsA: WheelValues;
  readonly wheelForcesN: WheelValues;

  /** Match-visible mechanism state, sampled alongside driving telemetry. */
  readonly mechanisms: {
    readonly held: readonly string[];
    readonly capacity: number;
    readonly intake: 'off' | 'intake' | 'outtake';
    readonly gateOpen: boolean;
    readonly shooterRunning: boolean;
    readonly shooterReady: boolean;
  };
}

export interface TelemetrySample {
  readonly tick: number;
  readonly timeSec: number;
  readonly batteryVolts: number;
  readonly batteryCurrentA: number;
  readonly robots: readonly RobotTelemetry[];
}

export function sampleTelemetry(snapshot: WorldSnapshot): TelemetrySample {
  return {
    tick: snapshot.tick,
    timeSec: snapshot.timeSec,
    batteryVolts: snapshot.batteryVolts,
    batteryCurrentA: snapshot.batteryCurrentA,
    robots: snapshot.robots.map((robot) => ({
      id: robot.id,
      name: robot.name,
      xM: robot.pose.p.x,
      yM: robot.pose.p.y,
      headingRad: robot.pose.theta,
      speedMps: Math.hypot(robot.vel.v.x, robot.vel.v.y),
      forwardMps: robot.chassis.vx,
      strafeMps: robot.chassis.vy,
      angularVelocityRadPerSec: robot.chassis.omega,
      accelerationMps2: robot.accelerationMps2,
      duties: robot.drive.duties,
      motorSpeedsRadPerSec: robot.drive.motorSpeeds,
      // The wheel turns slower than the motor by the external reduction.
      wheelSpeedsRadPerSec: mapWheels(robot.drive.motorSpeeds, (w) => w / robot.gearRatio),
      motorTorquesNm: robot.drive.motorTorques,
      motorCurrentsA: robot.drive.motorCurrents,
      wheelForcesN: robot.drive.wheelForces,
      mechanisms: {
        held: robot.mechanisms.held,
        capacity: robot.mechanisms.capacity,
        intake: robot.mechanisms.intake,
        gateOpen: robot.mechanisms.gateOpen,
        shooterRunning: robot.mechanisms.shooterRunning,
        shooterReady: robot.mechanisms.shooterReady,
      },
    })),
  };
}

/** Peak of a numeric field across a recorded series. Used by the reference tests. */
export function peakOf(
  series: readonly TelemetrySample[],
  robotIndex: number,
  select: (robot: RobotTelemetry) => number,
): number {
  let peak = Number.NEGATIVE_INFINITY;
  for (const sample of series) {
    const robot = sample.robots[robotIndex];
    if (robot === undefined) continue;
    const value = select(robot);
    if (value > peak) peak = value;
  }
  return peak;
}
