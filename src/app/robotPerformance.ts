/**
 * Emergent performance figures for the robot builder, in FTC-facing units.
 *
 * Everything here is *derived*. None of these numbers is an input anywhere in
 * the simulator: top speed and acceleration fall out of motor, gearing, wheel
 * size and mass (PRODUCT_SPEC.md §5, §14). The builder shows them so a user can
 * see a design decision's consequence immediately, which is the whole point of
 * the tool — "if we build this robot instead of that robot".
 *
 * Kept out of the React component so the numbers on screen can be asserted
 * without rendering anything.
 */

import { deriveRobot, type DerivedRobot } from '../core/robot/derive.js';
import { analyticFreeSpeed, analyticPeakAcceleration } from '../core/drive/drivetrain.js';
import { DEFAULT_BATTERY } from '../core/motor/battery.js';
import {
  asVolts,
  kilogramsToPounds,
  metersPerSec2ToFeetPerSec2,
  metersPerSecToFeetPerSec,
  metersToInches,
  radPerSecToDegPerSec,
} from '../core/units/convert.js';
import { meters, radPerSec } from '../core/units/si.js';
import type { RobotConfig } from '../core/robot/robotConfig.js';

export interface RobotPerformance {
  readonly derived: DerivedRobot;

  // --- Derived geometry, inches ---
  readonly trackIn: number;
  readonly wheelbaseIn: number;
  /** kg·m², about the vertical axis. */
  readonly inertiaZ: number;
  readonly geometryClamped: boolean;

  // --- Emergent performance, FTC units ---
  readonly topSpeedFtPerSec: number;
  readonly peakAccelFtPerSec2: number;
  readonly spinRateDegPerSec: number;
  /** Peak acceleration expressed in g, which is how implausible it looks. */
  readonly peakAccelG: number;

  // --- Electrical ---
  readonly stallCurrentA: number;
  readonly stallSagV: number;

  // --- Mass budget, pounds ---
  readonly chassisMassLb: number;
  readonly mechanismMassLb: number;
  /** What the physics actually accelerates: chassis + mechanisms. */
  readonly totalMassLb: number;

  // --- Motor port budget ---
  readonly portsUsed: number;
  readonly portsAvailable: number;
  readonly portsRemaining: number;
  readonly portsOverBudget: boolean;
}

const STANDARD_GRAVITY_MPS2 = 9.80665;

/**
 * Compute everything the builder displays for a configuration.
 *
 * Throws if the configuration is not physically derivable; callers validate with
 * the schema first and only call this for configurations that passed.
 */
export function computePerformance(config: RobotConfig): RobotPerformance {
  const derived = deriveRobot(config);
  const volts = asVolts(DEFAULT_BATTERY.openCircuitVolts);

  const freeSpeed = analyticFreeSpeed(derived.drivetrain, volts);
  const peakAccel = analyticPeakAcceleration(derived.drivetrain, volts, derived.massKg);

  // Spinning in place, every wheel runs at free speed and its contact patch
  // traces a circle of radius k, so omega = v_free / k.
  const spinRate = radPerSec(freeSpeed / derived.kinematicK);

  // Every drive motor at stall simultaneously — the worst case the pack sees.
  const stallCurrentA = derived.motor.datasheet.stallCurrentA * config.drivetrain.motorCount;
  const stallSagV = stallCurrentA * DEFAULT_BATTERY.internalResistanceOhms;

  return {
    derived,
    trackIn: metersToInches(meters(derived.halfTrack * 2)),
    wheelbaseIn: metersToInches(meters(derived.halfWheelbase * 2)),
    inertiaZ: derived.inertiaZ,
    geometryClamped: derived.geometryClamped,

    topSpeedFtPerSec: metersPerSecToFeetPerSec(freeSpeed),
    peakAccelFtPerSec2: metersPerSec2ToFeetPerSec2(peakAccel),
    spinRateDegPerSec: radPerSecToDegPerSec(spinRate),
    peakAccelG: peakAccel / STANDARD_GRAVITY_MPS2,

    stallCurrentA,
    stallSagV,

    chassisMassLb: kilogramsToPounds(derived.chassisMassKg),
    mechanismMassLb: kilogramsToPounds(derived.mechanismMassKg),
    totalMassLb: kilogramsToPounds(derived.massKg),

    portsUsed: derived.ports.used,
    portsAvailable: derived.ports.available,
    portsRemaining: derived.ports.remaining,
    portsOverBudget: derived.ports.overBudget,
  };
}

/**
 * Signed percentage change from one configuration's performance to another's.
 * Used to show what a design edit actually bought.
 */
export function percentChange(before: number, after: number): number {
  if (before === 0) return 0;
  return ((after - before) / before) * 100;
}
