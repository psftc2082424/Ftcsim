/**
 * Battery model with one-tick voltage lag (ARCHITECTURE.md §5.2).
 *
 *     V_battery = V_oc - I_total * R_int
 *
 * Motor torque depends on battery voltage, which depends on total current, which
 * depends on torque. Rather than iterate that algebraic loop each tick, the
 * voltage computed at the end of tick *n* is what tick *n+1* consumes. At
 * dt = 5 ms the lag is far shorter than any electrical or mechanical time
 * constant in the system, and the scheme is unconditionally stable and exactly
 * deterministic.
 *
 * `R_int` here is not cell chemistry alone: it lumps pack resistance together
 * with wiring, connectors and the distribution path, because that is the sag a
 * robot actually experiences. It is the least-supported constant in the Phase 1
 * model — see ASSUMPTIONS.md §3.2.
 */

import { amps, ohms, volts, type Amps, type Ohms, type Volts } from '../units/si.js';

export interface BatteryConfig {
  /** Resting (no-load) pack voltage. */
  readonly openCircuitVolts: Volts;
  /** Lumped pack + wiring + connector resistance. */
  readonly internalResistanceOhms: Ohms;
}

/**
 * FTC-legal packs are 12 V NiMH (10 × 1.2 V cells). A freshly charged pack reads
 * roughly 13.0–13.5 V and falls through a match; 12.0 V represents a
 * mid-match resting voltage, so quoted performance is not flattered by a full
 * battery. See ASSUMPTIONS.md §3.1 and §3.2.
 */
export const DEFAULT_BATTERY: BatteryConfig = Object.freeze({
  openCircuitVolts: volts(12.0),
  internalResistanceOhms: ohms(0.03),
});

/**
 * Numerical floor only. Reaching it would need hundreds of amps, which no legal
 * FTC drivetrain can draw; it exists so that a pathological configuration
 * produces a clamped voltage rather than a negative one propagating into the
 * motor model.
 */
const MIN_TERMINAL_VOLTS = 0;

export class Battery {
  private terminalVolts: Volts;
  private load: Amps;

  constructor(private readonly config: BatteryConfig = DEFAULT_BATTERY) {
    this.terminalVolts = config.openCircuitVolts;
    this.load = amps(0);
  }

  /**
   * Voltage available to this tick's motor calculations. On tick 0 this is the
   * open-circuit voltage, because no load has been observed yet.
   */
  get voltage(): Volts {
    return this.terminalVolts;
  }

  /** Total pack current observed at the end of the previous tick. */
  get current(): Amps {
    return this.load;
  }

  get openCircuitVoltage(): Volts {
    return this.config.openCircuitVolts;
  }

  /**
   * Record this tick's total pack load and compute the voltage the *next* tick
   * will see. Call exactly once per tick, after every consumer has drawn.
   */
  update(totalCurrent: Amps): void {
    this.load = totalCurrent;
    const sagged =
      this.config.openCircuitVolts - totalCurrent * this.config.internalResistanceOhms;
    this.terminalVolts = volts(Math.max(MIN_TERMINAL_VOLTS, sagged));
  }

  reset(): void {
    this.terminalVolts = this.config.openCircuitVolts;
    this.load = amps(0);
  }
}

/**
 * Total pack load from a set of per-motor currents.
 *
 * Braking motors produce negative current. Real FTC power systems do not
 * usefully recharge the pack through the motor controllers, and crediting
 * regeneration would raise pack voltage during deceleration, which is not
 * observed. Negative contributions are therefore dropped here — in one place,
 * rather than at each call site. Per-motor current stays signed for telemetry.
 * See ASSUMPTIONS.md §3.4.
 */
export function sumPackLoad(currents: readonly Amps[]): Amps {
  let total = 0;
  for (const i of currents) {
    if (i > 0) total += i;
  }
  return amps(total);
}
