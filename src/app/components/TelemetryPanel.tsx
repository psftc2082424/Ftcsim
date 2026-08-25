/**
 * Real-time telemetry, in FTC-facing units.
 *
 * The core reports SI; every conversion to inches, feet per second and degrees
 * happens here through `units/convert.ts`, which is the UI boundary
 * (ARCHITECTURE.md §4.1).
 *
 * This component re-renders at 10 Hz because that is the rate telemetry is
 * sampled at — never at frame rate, and never at tick rate.
 */

import type { RobotTelemetry, TelemetrySample } from '../../core/telemetry/sampler.js';
import type { RunnerStats } from '../simRunner.js';
import {
  metersPerSec2ToFeetPerSec2,
  metersPerSecToFeetPerSec,
  metersToInches,
  radPerSecToDegPerSec,
  radPerSecToRpm,
  radiansToDegrees,
} from '../../core/units/convert.js';
import { toArray, type WheelValues } from '../../core/drive/mecanumKinematics.js';
import {
  metersPerSec,
  metersPerSec2,
  meters,
  radPerSec,
  radians,
} from '../../core/units/si.js';

interface Props {
  readonly sample: TelemetrySample | null;
  readonly stats: RunnerStats | null;
}

const WHEEL_LABELS = ['FL', 'FR', 'BL', 'BR'] as const;

function Row({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="telemetry-row">
      <span className="telemetry-label">{label}</span>
      <span className="telemetry-value">
        {value}
        {unit !== undefined && <span className="telemetry-unit"> {unit}</span>}
      </span>
    </div>
  );
}

function WheelRow({ label, values, digits = 1 }: { label: string; values: WheelValues; digits?: number }) {
  return (
    <div className="telemetry-row">
      <span className="telemetry-label">{label}</span>
      <span className="telemetry-wheels">
        {toArray(values).map((value, index) => (
          <span key={WHEEL_LABELS[index]} className="telemetry-wheel">
            <span className="telemetry-wheel-label">{WHEEL_LABELS[index]}</span>
            {value.toFixed(digits)}
          </span>
        ))}
      </span>
    </div>
  );
}

function RobotTelemetryView({ robot }: { robot: RobotTelemetry }) {
  return (
    <>
      <h3>Pose</h3>
      <Row label="X" value={metersToInches(meters(robot.xM)).toFixed(1)} unit="in" />
      <Row label="Y" value={metersToInches(meters(robot.yM)).toFixed(1)} unit="in" />
      <Row
        label="Heading"
        value={radiansToDegrees(radians(robot.headingRad)).toFixed(1)}
        unit="deg"
      />

      <h3>Motion</h3>
      <Row
        label="Speed"
        value={metersPerSecToFeetPerSec(metersPerSec(robot.speedMps)).toFixed(2)}
        unit="ft/s"
      />
      <Row
        label="Forward"
        value={metersPerSecToFeetPerSec(metersPerSec(robot.forwardMps)).toFixed(2)}
        unit="ft/s"
      />
      <Row
        label="Strafe"
        value={metersPerSecToFeetPerSec(metersPerSec(robot.strafeMps)).toFixed(2)}
        unit="ft/s"
      />
      <Row
        label="Angular vel"
        value={radPerSecToDegPerSec(radPerSec(robot.angularVelocityRadPerSec)).toFixed(0)}
        unit="deg/s"
      />
      <Row
        label="Acceleration"
        value={metersPerSec2ToFeetPerSec2(metersPerSec2(robot.accelerationMps2)).toFixed(1)}
        unit="ft/s²"
      />

      <h3>Drivetrain</h3>
      <WheelRow label="Duty" values={robot.duties} digits={2} />
      <WheelRow
        label="Motor RPM"
        values={mapToRpm(robot.motorSpeedsRadPerSec)}
        digits={0}
      />
      <WheelRow label="Wheel RPM" values={mapToRpm(robot.wheelSpeedsRadPerSec)} digits={0} />
      <WheelRow label="Torque (N·m)" values={robot.motorTorquesNm} digits={2} />
      <WheelRow label="Current (A)" values={robot.motorCurrentsA} digits={1} />
      <WheelRow label="Force (N)" values={robot.wheelForcesN} digits={1} />
    </>
  );
}

function mapToRpm(values: WheelValues): WheelValues {
  return {
    frontLeft: radPerSecToRpm(radPerSec(values.frontLeft)),
    frontRight: radPerSecToRpm(radPerSec(values.frontRight)),
    backLeft: radPerSecToRpm(radPerSec(values.backLeft)),
    backRight: radPerSecToRpm(radPerSec(values.backRight)),
  };
}

export function TelemetryPanel({ sample, stats }: Props) {
  if (sample === null) {
    return (
      <section className="panel">
        <h2>Telemetry</h2>
        <p className="muted">Waiting for the first sample…</p>
      </section>
    );
  }

  const robot = sample.robots[0];

  return (
    <section className="panel">
      <h2>Telemetry</h2>

      <h3>Match</h3>
      <Row label="Sim time" value={sample.timeSec.toFixed(2)} unit="s" />
      <Row label="Tick" value={String(sample.tick)} />

      <h3>Power</h3>
      <Row label="Battery" value={sample.batteryVolts.toFixed(2)} unit="V" />
      <Row label="Pack current" value={sample.batteryCurrentA.toFixed(1)} unit="A" />

      {robot !== undefined && <RobotTelemetryView robot={robot} />}

      {stats !== null && (
        <>
          <h3>Loop</h3>
          <Row label="Render" value={stats.framesPerSecond.toFixed(0)} unit="fps" />
          <Row label="Physics" value={stats.ticksPerSecond.toFixed(0)} unit="Hz" />
          <Row label="Input" value={stats.activeSource ?? 'idle'} />
        </>
      )}
    </section>
  );
}
