/**
 * Mechanism preset templates.
 *
 * Authoring convenience only. Each template is a *starting point* the user
 * edits — a named bundle of capabilities with a plausible motor choice — and
 * nothing in the engine ever reads the `preset` label back (ARCHITECTURE.md §7).
 * Picking "shooter" does not put the simulator into a shooter mode; it drops in
 * a `launch` capability and a fast motor, both of which the user can change.
 *
 * ── What is real here and what is not ─────────────────────────────────────
 *
 * `massLb` and `actuation` feed the physics today: mass changes acceleration,
 * motor count consumes ports. Those are the tradeoffs (PRODUCT_SPEC.md §11).
 *
 * The capability parameters — capacity, reach, exit speed, climb time — are
 * declarative descriptors that **no Phase 2 physics consumes**. They exist so a
 * mechanism can describe itself, and they are read by the rules engine in
 * Phase 3 once there are game pieces to act on. They are editable defaults, not
 * calibrated measurements. See ASSUMPTIONS.md §9.4.
 *
 * Motor choices follow the obvious engineering logic: flywheels want speed,
 * lifts and climbers want torque, intakes sit in between.
 */

import type { Capability } from './capability.js';
import type { MechanismConfig } from './mechanism.js';

export interface MechanismPreset {
  readonly preset: string;
  readonly label: string;
  /** One line explaining what the template is for, shown in the picker. */
  readonly summary: string;
  readonly massLb: number;
  readonly motorId: string | null;
  readonly motorCount: number;
  readonly gearRatio: number;
  readonly efficiency: number;
  readonly mount: { readonly xIn: number; readonly yIn: number; readonly facingDeg: number };
  readonly capabilities: readonly Capability[];
}

export const MECHANISM_PRESETS: readonly MechanismPreset[] = [
  {
    preset: 'intake',
    label: 'Intake',
    summary: 'Collects game pieces from the floor. Mid-speed motor, front-mounted.',
    massLb: 4,
    motorId: 'gobilda-5203-435',
    motorCount: 1,
    gearRatio: 1,
    efficiency: 0.9,
    mount: { xIn: 8, yIn: 0, facingDeg: 0 },
    capabilities: [
      {
        kind: 'acquire',
        pieceTypes: [],
        capacity: 3,
        reachIn: 6,
        // Spans most of an 18 in front rail, inside the bumpers.
        mouthWidthIn: 14,
        // A driver holding the intake over a stacked trio clears it in 1.5 s.
        acquisitionRatePerSec: 2,
      },
    ],
  },
  {
    preset: 'outtake',
    label: 'Outtake',
    summary: 'Deposits held pieces. Slower and more controlled than an intake.',
    massLb: 3,
    motorId: 'gobilda-5203-312',
    motorCount: 1,
    gearRatio: 1,
    efficiency: 0.9,
    mount: { xIn: -8, yIn: 0, facingDeg: 180 },
    capabilities: [{ kind: 'release', pieceTypes: [], reachIn: 5 }],
  },
  {
    preset: 'shooter',
    label: 'Shooter',
    summary: 'Routes held pieces to the game-defined scoring target.',
    massLb: 5,
    motorId: 'gobilda-5203-312',
    motorCount: 1,
    gearRatio: 1,
    efficiency: 0.92,
    mount: { xIn: 4, yIn: 0, facingDeg: 0 },
    capabilities: [
      {
        kind: 'launch',
        pieceTypes: [],
        // Two shots a second: fast enough to clear a 3-piece hopper in under
        // two seconds, slow enough to see each one leave.
        shotsPerSecond: 2,
      },
    ],
  },
  {
    preset: 'elevator',
    label: 'Elevator / lift',
    summary: 'Raises a piece to a scoring height. Wants torque, so a high reduction.',
    massLb: 7,
    motorId: 'gobilda-5203-117',
    motorCount: 1,
    gearRatio: 1,
    efficiency: 0.85,
    mount: { xIn: 0, yIn: 0, facingDeg: 0 },
    capabilities: [{ kind: 'elevate', minHeightIn: 2, maxHeightIn: 36, travelTimeSec: 1.5 }],
  },
  {
    preset: 'climber',
    label: 'Climber',
    summary: 'Endgame ascent. Lifts the whole robot, so the slowest motor available.',
    massLb: 6,
    motorId: 'gobilda-5203-60',
    motorCount: 1,
    gearRatio: 1,
    efficiency: 0.85,
    mount: { xIn: -4, yIn: 0, facingDeg: 180 },
    capabilities: [{ kind: 'climb', level: 1, timeSec: 4, successRate: 0.9 }],
  },
  {
    preset: 'deflector',
    label: 'Passive deflector',
    summary: 'Unpowered guide or hood. Costs mass but no motor port.',
    massLb: 1,
    motorId: null,
    motorCount: 0,
    gearRatio: 1,
    efficiency: 1,
    mount: { xIn: 6, yIn: 0, facingDeg: 0 },
    capabilities: [{ kind: 'traverse', requiredClearanceIn: 12 }],
  },
];

export function getMechanismPreset(preset: string): MechanismPreset {
  const found = MECHANISM_PRESETS.find((p) => p.preset === preset);
  if (found === undefined) {
    throw new Error(
      `Unknown mechanism preset "${preset}". Known: ${MECHANISM_PRESETS.map((p) => p.preset).join(', ')}.`,
    );
  }
  return found;
}

/**
 * Instantiate a template as a concrete mechanism.
 *
 * `id` is supplied by the caller so the UI controls uniqueness; a preset can be
 * added more than once (two intakes is a legitimate design).
 */
export function instantiateMechanism(preset: MechanismPreset, id: string): MechanismConfig {
  const base = {
    id,
    name: preset.label,
    preset: preset.preset,
    massLb: preset.massLb,
    mount: preset.mount,
    capabilities: preset.capabilities,
  };

  if (preset.motorId === null) return base;

  return {
    ...base,
    actuation: {
      motorId: preset.motorId,
      motorCount: preset.motorCount,
      gearRatio: preset.gearRatio,
      efficiency: preset.efficiency,
    },
  };
}
