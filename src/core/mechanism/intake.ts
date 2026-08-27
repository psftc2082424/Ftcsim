/**
 * Intake specification and functional collection.
 *
 * Functionality-first model: the intake has a mouth geometry and a capacity.
 * A piece is acquired when its center is inside the mouth and the intake is active.
 * No roller force simulation needed — collection is instantaneous once in range.
 *
 * Geometry is still described (mount, facing, reach, width) so robots can be
 * built meaningfully, but the *gameplay* treats it as a simple state transition.
 */

import { inchesToMeters } from '../units/convert.js';
import { rotate, vec2, type Vec2 } from '../math/vec2.js';
import type { AcquireCapability } from './capability.js';
import type { DerivedMechanism } from './mechanism.js';

/** An intake as the gameplay sees it. */
export interface IntakeSpec {
  /** Mount point in the body frame, metres. */
  readonly mountM: Vec2;
  /** Mount facing relative to robot-forward, radians. */
  readonly facingRad: number;
  readonly reachM: number;
  readonly mouthWidthM: number;
  readonly capacity: number;
  readonly pieceTypes: readonly string[];
}

/** What the driver is asking the intake to do. */
export type IntakeCommand = 'off' | 'intake' | 'outtake';

/**
 * Is a piece inside the mouth?
 *
 * Both arguments are in the robot's body frame. The mouth runs from the mount
 * outward along its facing, so the test is a rectangle in the mount's own
 * frame — which is what makes a side-mounted or rear-facing intake work with no
 * special case.
 */
export function mouthContains(spec: IntakeSpec, pieceBodyM: Vec2): boolean {
  const local = toMouthFrame(spec, pieceBodyM);
  return (
    local.x >= 0 && local.x <= spec.reachM && Math.abs(local.y) <= spec.mouthWidthM / 2
  );
}

/** A piece's position relative to the mount, with +x along the mount's facing. */
export function toMouthFrame(spec: IntakeSpec, pieceBodyM: Vec2): Vec2 {
  return rotate(vec2(pieceBodyM.x - spec.mountM.x, pieceBodyM.y - spec.mountM.y), -spec.facingRad);
}

/** Unit vector pointing into the mouth, in the body frame. */
export function drawDirection(spec: IntakeSpec): Vec2 {
  return vec2(-Math.cos(spec.facingRad), -Math.sin(spec.facingRad));
}

/**
 * Where the nth held piece sits in the robot, body frame.
 *
 * A queue running back from the mount along the mount's facing, one piece
 * diameter apart. Held pieces are real bodies carried at these poses, so a
 * robot's contents move with it and are drawn where they are.
 */
export function hopperSlotM(spec: IntakeSpec, index: number, pieceDiameterM: number): Vec2 {
  const back = drawDirection(spec);
  const depth = pieceDiameterM * (index + 0.5);
  return vec2(spec.mountM.x + back.x * depth, spec.mountM.y + back.y * depth);
}

/** Where an ejected piece re-enters the world: just outside the mouth. */
export function ejectionPointM(spec: IntakeSpec, pieceRadiusM: number): Vec2 {
  const out = vec2(Math.cos(spec.facingRad), Math.sin(spec.facingRad));
  const distance = pieceRadiusM * 2;
  return vec2(spec.mountM.x + out.x * distance, spec.mountM.y + out.y * distance);
}

/** Can this intake take this piece type? Empty means "whatever the game defines". */
export function intakeAccepts(spec: IntakeSpec, pieceType: string): boolean {
  return spec.pieceTypes.length === 0 || spec.pieceTypes.includes(pieceType);
}

/**
 * Build an intake spec from a mechanism the user configured.
 *
 * Geometry comes from the config; we ignore motor details for functional gameplay.
 */
export function deriveIntake(
  mechanism: DerivedMechanism,
  capability: AcquireCapability,
): IntakeSpec {
  const { mount } = mechanism.config;

  return {
    mountM: vec2(inchesToMeters(mount.xIn), inchesToMeters(mount.yIn)),
    facingRad: (mount.facingDeg * Math.PI) / 180,
    reachM: inchesToMeters(capability.reachIn),
    mouthWidthM: inchesToMeters(capability.mouthWidthIn),
    capacity: Math.max(0, Math.floor(capability.capacity)),
    pieceTypes: capability.pieceTypes,
  };
}

/** The first acquire capability a robot carries, with the mechanism it is on. */
export function intakeOf(
  mechanisms: readonly DerivedMechanism[],
): { readonly mechanism: DerivedMechanism; readonly capability: AcquireCapability } | undefined {
  for (const mechanism of mechanisms) {
    for (const capability of mechanism.config.capabilities) {
      if (capability.kind === 'acquire') return { mechanism, capability };
    }
  }
  return undefined;
}
