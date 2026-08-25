/**
 * Traction seam.
 *
 * Phase 1 traction is **exactly ideal** by explicit product decision
 * (PRODUCT_SPEC.md §4 and §6): wheel force is limited only by available motor
 * torque. There is deliberately no friction coefficient, no normal-load
 * calculation and no force clamp anywhere in this codebase.
 *
 * This interface exists so that a calibrated traction mode can later be added as
 * an explicit opt-in without touching a single caller. It is not a hidden
 * parameter and it is not a partially-implemented feature — `IdealTraction` is
 * the identity function, and it is the only implementation that ships.
 *
 * Consequence, recorded in ASSUMPTIONS.md §2.1: acceleration is
 * stall-torque-limited rather than friction-limited, so the simulator
 * over-predicts acceleration relative to real mecanum wheels on FTC foam tile.
 */

import type { ChassisVelocity, WheelValues } from './mecanumKinematics.js';

/**
 * What a traction model is allowed to know.
 *
 * Deliberately narrow: mass and chassis motion are everything a Coulomb model
 * would need, and nothing here couples `drive/` to the physics body types.
 */
export interface TractionContext {
  readonly massKg: number;
  readonly chassis: ChassisVelocity;
}

export interface TractionModel {
  readonly id: string;
  limit(wheelForces: WheelValues, context: TractionContext): WheelValues;
}

/** The only traction model in Phase 1. `limit(force) = force`. */
export const IdealTraction: TractionModel = Object.freeze({
  id: 'ideal',
  limit(wheelForces: WheelValues): WheelValues {
    return wheelForces;
  },
});
