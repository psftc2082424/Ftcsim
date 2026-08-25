import { describe, expect, it } from 'vitest';
import {
  MECHANISM_PRESETS,
  getMechanismPreset,
  instantiateMechanism,
} from './presets.js';
import { deriveMechanism, portBudget } from './mechanism.js';
import { listMotorIds } from '../motor/catalog/goBILDA.js';
import { DEFAULT_ROBOT_CONFIG } from '../robot/robotConfig.js';
import { deriveRobot } from '../robot/derive.js';

// Schema conformance of these templates is asserted in src/schema/schema.test.ts:
// core/ may not import schema/ (ARCHITECTURE.md §3.1), and that holds for tests.
const instantiateAll = () =>
  MECHANISM_PRESETS.map((preset, index) => instantiateMechanism(preset, `m-${index}`));

describe('preset catalogue integrity', () => {
  it('has unique preset keys and labels', () => {
    const keys = MECHANISM_PRESETS.map((p) => p.preset);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('references only motors that exist in the goBILDA catalogue', () => {
    const known = listMotorIds();
    for (const preset of MECHANISM_PRESETS) {
      if (preset.motorId === null) continue;
      expect(known).toContain(preset.motorId);
    }
  });

  it('gives every template a positive mass and at least one capability', () => {
    for (const preset of MECHANISM_PRESETS) {
      expect(preset.massLb).toBeGreaterThan(0);
      expect(preset.capabilities.length).toBeGreaterThan(0);
    }
  });

  it('throws a helpful error for an unknown preset', () => {
    expect(() => getMechanismPreset('nope')).toThrow(/Unknown mechanism preset/);
    expect(() => getMechanismPreset('nope')).toThrow(/intake/);
  });

  /** Engineering sanity: a flywheel wants speed, a climber wants torque. */
  it('picks a faster motor for the shooter than for the climber', () => {
    const shooter = getMechanismPreset('shooter');
    const climber = getMechanismPreset('climber');
    expect(shooter.motorId).not.toBe(climber.motorId);

    const shooterRpm = deriveMechanism(instantiateMechanism(shooter, 's')).outputRpm ?? 0;
    const climberRpm = deriveMechanism(instantiateMechanism(climber, 'c')).outputRpm ?? 0;
    expect(shooterRpm).toBeGreaterThan(climberRpm);

    const shooterTorque = deriveMechanism(instantiateMechanism(shooter, 's')).outputTorqueNm ?? 0;
    const climberTorque = deriveMechanism(instantiateMechanism(climber, 'c')).outputTorqueNm ?? 0;
    expect(climberTorque).toBeGreaterThan(shooterTorque);
  });
});

describe('instantiation', () => {
  it('produces a mechanism that derives cleanly', () => {
    for (const mechanism of instantiateAll()) {
      expect(() => deriveMechanism(mechanism)).not.toThrow();
    }
  });

  it('omits actuation for a passive template', () => {
    const deflector = instantiateMechanism(getMechanismPreset('deflector'), 'd');
    expect(deflector.actuation).toBeUndefined();

    const derived = deriveMechanism(deflector);
    expect(derived.motorCount).toBe(0);
    expect(derived.outputRpm).toBeNull();
    // Passive still costs mass — that is the point of listing it.
    expect(derived.massLb).toBeGreaterThan(0);
  });

  it('carries the preset key through as a cosmetic label', () => {
    const intake = instantiateMechanism(getMechanismPreset('intake'), 'i-1');
    expect(intake.preset).toBe('intake');
    expect(intake.id).toBe('i-1');
  });

  it('can be added more than once with distinct ids', () => {
    const preset = getMechanismPreset('intake');
    const a = instantiateMechanism(preset, 'intake-1');
    const b = instantiateMechanism(preset, 'intake-2');
    expect(a.id).not.toBe(b.id);
    expect(a.massLb).toBe(b.massLb);
  });
});

describe('port budget across the template catalogue', () => {
  it('fits a typical three-mechanism robot within eight ports', () => {
    const mechanisms = ['intake', 'shooter', 'climber'].map((key, i) =>
      instantiateMechanism(getMechanismPreset(key), `m-${i}`),
    );
    const robot = deriveRobot({ ...DEFAULT_ROBOT_CONFIG, mechanisms });

    expect(robot.ports.used).toBe(7); // 4 drive + 3 mechanism
    expect(robot.ports.overBudget).toBe(false);
  });

  /**
   * The constraint doing real work: five powered mechanisms alongside a mecanum
   * drivetrain does not fit, and the builder has to say so.
   */
  it('goes over budget with five powered mechanisms', () => {
    const powered = MECHANISM_PRESETS.filter((p) => p.motorCount > 0);
    expect(powered.length).toBeGreaterThanOrEqual(5);

    const mechanisms = powered
      .slice(0, 5)
      .map((preset, i) => instantiateMechanism(preset, `m-${i}`));
    const robot = deriveRobot({ ...DEFAULT_ROBOT_CONFIG, mechanisms });

    expect(robot.ports.used).toBe(9);
    expect(robot.ports.overBudget).toBe(true);
  });

  it('does not charge a port for a passive mechanism', () => {
    const deflector = instantiateMechanism(getMechanismPreset('deflector'), 'd');
    const robot = deriveRobot({ ...DEFAULT_ROBOT_CONFIG, mechanisms: [deflector] });

    expect(robot.ports.used).toBe(4);
    expect(portBudget(4, 0).remaining).toBe(4);
    // But it still adds mass.
    expect(robot.mechanismMassKg).toBeGreaterThan(0);
  });
});
