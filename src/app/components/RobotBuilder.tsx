/**
 * Robot builder (PRODUCT_SPEC.md §8, Phase 2).
 *
 * The user-editable physical parameters are exactly four — length, width,
 * height, mass — plus the drivetrain configuration. Centre of mass, moment of
 * inertia, track and wheelbase are shown but not editable, because they are
 * derived (§4).
 *
 * Two things make this the centre of the product:
 *
 *   - Emergent performance updates **as you type**, before anything is applied,
 *     so a design decision's consequence is visible immediately.
 *   - Every figure in the lower block is derived. There is no "top speed" input
 *     anywhere in this simulator (§5).
 *
 * Edits are held as strings so a half-typed value like "1." does not get parsed
 * into something surprising. Validation runs against the same schema that
 * guards imported presets, so the form and the file format cannot drift apart.
 */

import { useMemo, useState } from 'react';
import {
  DEFAULT_ROBOT_CONFIG,
  ROBOT_CONFIG_SCHEMA_VERSION,
  type RobotConfig,
} from '../../core/robot/robotConfig.js';
import { GOBILDA_5203_SERIES } from '../../core/motor/catalog/goBILDA.js';
import {
  safeParseRobotConfig,
  warningsFor,
  type ValidationFailure,
} from '../../schema/robotConfig.schema.js';
import { computePerformance, percentChange } from '../robotPerformance.js';

interface Props {
  /** The configuration currently loaded in the simulation. */
  readonly applied: RobotConfig;
  readonly onApply: (config: RobotConfig) => void;
}

interface Draft {
  name: string;
  lengthIn: string;
  widthIn: string;
  heightIn: string;
  massLb: string;
  motorId: string;
  motorCount: string;
  gearRatio: string;
  wheelDiameterIn: string;
}

function toDraft(config: RobotConfig): Draft {
  return {
    name: config.name,
    lengthIn: String(config.chassis.lengthIn),
    widthIn: String(config.chassis.widthIn),
    heightIn: String(config.chassis.heightIn),
    massLb: String(config.chassis.massLb),
    motorId: config.drivetrain.motorId,
    motorCount: String(config.drivetrain.motorCount),
    gearRatio: String(config.drivetrain.gearRatio),
    wheelDiameterIn: String(config.drivetrain.wheelDiameterIn),
  };
}

/**
 * An empty or half-typed field becomes NaN rather than 0, so the schema reports
 * "must be a number" instead of silently simulating a massless robot.
 */
function num(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

function draftToRaw(draft: Draft, id: string): unknown {
  return {
    schemaVersion: ROBOT_CONFIG_SCHEMA_VERSION,
    id,
    name: draft.name,
    chassis: {
      lengthIn: num(draft.lengthIn),
      widthIn: num(draft.widthIn),
      heightIn: num(draft.heightIn),
      massLb: num(draft.massLb),
    },
    drivetrain: {
      motorId: draft.motorId,
      motorCount: num(draft.motorCount),
      gearRatio: num(draft.gearRatio),
      wheelDiameterIn: num(draft.wheelDiameterIn),
    },
  };
}

function errorFor(errors: readonly ValidationFailure[], path: string): string | undefined {
  return errors.find((e) => e.path === path)?.message;
}

function Field({
  label,
  unit,
  value,
  error,
  onChange,
  step = 'any',
}: {
  label: string;
  unit?: string | undefined;
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
  step?: string | undefined;
}) {
  return (
    <label className={`builder-field ${error !== undefined ? 'has-error' : ''}`}>
      <span className="builder-field-label">
        {label}
        {unit !== undefined && <span className="builder-field-unit"> ({unit})</span>}
      </span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {error !== undefined && <span className="builder-field-error">{error}</span>}
    </label>
  );
}

function Derived({
  label,
  value,
  unit,
  delta,
}: {
  label: string;
  value: string;
  unit?: string | undefined;
  // Explicitly optional-or-undefined: under `exactOptionalPropertyTypes` an
  // omitted prop and one passed as `undefined` are different types, and the
  // delta genuinely is undefined while the draft is invalid.
  delta?: number | undefined;
}) {
  const show = delta !== undefined && Math.abs(delta) >= 0.05;
  return (
    <div className="telemetry-row">
      <span className="telemetry-label">{label}</span>
      <span className="telemetry-value">
        {value}
        {unit !== undefined && <span className="telemetry-unit"> {unit}</span>}
        {show && (
          <span className={`builder-delta ${delta > 0 ? 'up' : 'down'}`}>
            {delta > 0 ? '▲' : '▼'}
            {Math.abs(delta).toFixed(0)}%
          </span>
        )}
      </span>
    </div>
  );
}

export function RobotBuilder({ applied, onApply }: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(applied));

  const set = (key: keyof Draft) => (value: string) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const parsed = useMemo(
    () => safeParseRobotConfig(draftToRaw(draft, applied.id)),
    [draft, applied.id],
  );

  const appliedPerf = useMemo(() => computePerformance(applied), [applied]);
  const draftPerf = useMemo(
    () => (parsed.ok ? computePerformance(parsed.config) : null),
    [parsed],
  );
  const warnings = useMemo(() => (parsed.ok ? warningsFor(parsed.config) : []), [parsed]);

  const errors = parsed.ok ? [] : parsed.errors;
  const dirty = JSON.stringify(draftToRaw(draft, applied.id)) !== JSON.stringify(applied);
  const perf = draftPerf ?? appliedPerf;

  const delta = (select: (p: typeof appliedPerf) => number): number | undefined =>
    draftPerf === null ? undefined : percentChange(select(appliedPerf), select(draftPerf));

  return (
    <section className="panel">
      <h2>Robot Builder</h2>

      <label className="builder-field">
        <span className="builder-field-label">Name</span>
        <input type="text" value={draft.name} onChange={(e) => set('name')(e.target.value)} />
        {errorFor(errors, 'name') !== undefined && (
          <span className="builder-field-error">{errorFor(errors, 'name')}</span>
        )}
      </label>

      <h3>Chassis</h3>
      <p className="muted small">
        These four are the only physical parameters you set. Everything below is derived.
      </p>
      <div className="builder-grid">
        <Field
          label="Length"
          unit="in"
          value={draft.lengthIn}
          error={errorFor(errors, 'chassis.lengthIn')}
          onChange={set('lengthIn')}
        />
        <Field
          label="Width"
          unit="in"
          value={draft.widthIn}
          error={errorFor(errors, 'chassis.widthIn')}
          onChange={set('widthIn')}
        />
        <Field
          label="Height"
          unit="in"
          value={draft.heightIn}
          error={errorFor(errors, 'chassis.heightIn')}
          onChange={set('heightIn')}
        />
        <Field
          label="Mass"
          unit="lb"
          value={draft.massLb}
          error={errorFor(errors, 'chassis.massLb')}
          onChange={set('massLb')}
        />
      </div>

      <h3>Drivetrain</h3>
      <label className="builder-field">
        <span className="builder-field-label">Motor</span>
        <select value={draft.motorId} onChange={(e) => set('motorId')(e.target.value)}>
          {GOBILDA_5203_SERIES.map((motor) => (
            <option key={motor.id} value={motor.id}>
              {motor.gearboxRatio}:1 — {motor.freeSpeedRpm} RPM, {motor.stallTorqueKgCm} kg·cm
            </option>
          ))}
        </select>
        {errorFor(errors, 'drivetrain.motorId') !== undefined && (
          <span className="builder-field-error">{errorFor(errors, 'drivetrain.motorId')}</span>
        )}
      </label>

      <div className="builder-grid">
        <Field
          label="Motor count"
          value={draft.motorCount}
          step="4"
          error={errorFor(errors, 'drivetrain.motorCount')}
          onChange={set('motorCount')}
        />
        <Field
          label="External gearing"
          unit=":1"
          value={draft.gearRatio}
          error={errorFor(errors, 'drivetrain.gearRatio')}
          onChange={set('gearRatio')}
        />
        <Field
          label="Wheel dia."
          unit="in"
          value={draft.wheelDiameterIn}
          error={errorFor(errors, 'drivetrain.wheelDiameterIn')}
          onChange={set('wheelDiameterIn')}
        />
      </div>

      {warnings.length > 0 && (
        <div className="builder-warnings">
          {warnings.map((warning) => (
            <div key={`${warning.path}:${warning.message}`} className="builder-warning">
              <span className="warning-tag">{warning.severity}</span>
              {warning.message}
            </div>
          ))}
        </div>
      )}

      <h3>Derived geometry</h3>
      <Derived label="Track" value={perf.trackIn.toFixed(1)} unit="in" />
      <Derived label="Wheelbase" value={perf.wheelbaseIn.toFixed(1)} unit="in" />
      <Derived label="Moment of inertia" value={perf.inertiaZ.toFixed(3)} unit="kg·m²" />
      {perf.geometryClamped && (
        <div className="builder-warning">
          <span className="warning-tag">plausibility</span>
          Chassis is smaller than its own wheel inset; track and wheelbase are clamped.
        </div>
      )}

      <h3>Emergent performance</h3>
      <p className="muted small">
        Computed from motor, gearing, wheel size and mass. None of these is a setting.
      </p>
      <Derived
        label="Top speed"
        value={perf.topSpeedFtPerSec.toFixed(2)}
        unit="ft/s"
        delta={delta((p) => p.topSpeedFtPerSec)}
      />
      <Derived
        label="Peak accel."
        value={perf.peakAccelFtPerSec2.toFixed(1)}
        unit="ft/s²"
        delta={delta((p) => p.peakAccelFtPerSec2)}
      />
      <Derived
        label="Spin rate"
        value={perf.spinRateDegPerSec.toFixed(0)}
        unit="deg/s"
        delta={delta((p) => p.spinRateDegPerSec)}
      />
      <Derived label="Stall draw" value={perf.stallCurrentA.toFixed(1)} unit="A" />
      <Derived label="Stall sag" value={perf.stallSagV.toFixed(2)} unit="V" />

      <p className="muted small">
        Phase 1 assumes perfect traction, so peak acceleration ({perf.peakAccelG.toFixed(2)} g) is
        limited only by motor stall torque and is optimistic against real mecanum wheels on foam
        tile. See <code>docs/ASSUMPTIONS.md §2.1</code>.
      </p>

      <div className="row-actions">
        <button
          type="button"
          disabled={!parsed.ok || !dirty}
          onClick={() => {
            if (parsed.ok) onApply(parsed.config);
          }}
        >
          Apply to simulation
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!dirty}
          onClick={() => setDraft(toDraft(applied))}
        >
          Revert
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setDraft(toDraft({ ...DEFAULT_ROBOT_CONFIG, id: applied.id }))}
        >
          Default
        </button>
      </div>

      {dirty && parsed.ok && (
        <p className="muted small">Applying resets the robot to the field centre.</p>
      )}
    </section>
  );
}
