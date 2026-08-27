/**
 * Intake geometry and the force a roller puts on a game piece.
 *
 * An intake is a powered roller at a mount point with a mouth in front of it.
 * Everything it does to a piece is a force, derived the same way the drivetrain
 * derives wheel force: torque at the output divided by the radius it acts at.
 * There is no capture probability, no acquisition timer and no "intake rate"
 * constant — a piece is taken in when the roller has actually dragged it to the
 * robot, and how long that takes falls out of the piece's mass and the motor
 * behind the roller.
 *
 * ── The mouth ──────────────────────────────────────────────────────────────
 *
 * A rectangle in the robot's body frame: `reachIn` deep along the mount's
 * facing, `mouthWidthIn` across it, with its near edge at the mount. A piece
 * whose centre is inside it is being worked on by the roller. A piece that has
 * been dragged into contact with the robot has arrived, and goes to the hopper.
 *
 * Contact — not a depth threshold — is the capture test because it needs no
 * invented distance: the ball is against the robot, which is what "collected"
 * physically means.
 *
 * ── Surface speed and the half ─────────────────────────────────────────────
 *
 * A ball pinched between a roller moving at `v` and a stationary surface (the
 * floor, a polycarbonate bumper) has its centre travelling at `v/2`, because the
 * two contact points must match the two surfaces and the centre is midway
 * between them. Same fact the flywheel's transfer ratio rests on, and the reason
 * both live one derivation apart rather than as two tuned numbers.
 *
 * ASSUMPTIONS.md §9.6.
 */

import { inchesToMeters } from '../units/convert.js';
import { rotate, vec2, type Vec2 } from '../math/vec2.js';
import type { AcquireCapability } from './capability.js';
import type { DerivedMechanism } from './mechanism.js';

/**
 * Centre speed over surface speed for a ball driven by one moving surface
 * against a stationary one. See the module note; the same geometry as the
 * flywheel's hooded transfer ratio.
 */
export const ROLLER_TRANSFER_RATIO = 0.5;

/** An intake as the physics sees it. */
export interface IntakeSpec {
  /** Mount point in the body frame, metres. */
  readonly mountM: Vec2;
  /** Mount facing relative to robot-forward, radians. */
  readonly facingRad: number;
  readonly reachM: number;
  readonly mouthWidthM: number;
  readonly rollerRadiusM: number;
  /** Roller speed at full command, rad/s. */
  readonly rollerRadPerSec: number;
  /** Torque available at the roller, N·m. */
  readonly rollerTorqueNm: number;
  readonly capacity: number;
  readonly pieceTypes: readonly string[];
}

/** What the driver is asking the roller to do. */
export type IntakeCommand = 'off' | 'intake' | 'outtake';

/** Roller surface speed for a command, m/s. Positive draws inward. */
export function surfaceSpeedMps(spec: IntakeSpec, command: IntakeCommand): number {
  const direction = command === 'intake' ? 1 : command === 'outtake' ? -1 : 0;
  return direction * spec.rollerRadPerSec * spec.rollerRadiusM;
}

/** Largest force the roller can put on a piece: torque over the radius it acts at. */
export function maxRollerForceN(spec: IntakeSpec): number {
  return spec.rollerTorqueNm / spec.rollerRadiusM;
}

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
 * Force the roller applies to one piece this tick, in the body frame.
 *
 * The roller drives the piece's velocity *relative to the robot* toward the
 * surface speed, in the draw direction. The force is whatever that demands over
 * one timestep, capped at what the motor can deliver through the roller — so a
 * light piece is snatched in immediately and a heavy one is limited by torque,
 * which is the same force-limited drive the wheels use.
 *
 * Returns a zero vector when the roller is off, or already at speed.
 */
export function rollerForceN(
  spec: IntakeSpec,
  command: IntakeCommand,
  pieceMassKg: number,
  /** Piece velocity relative to the robot, body frame, m/s. */
  relativeVelocityM: Vec2,
  dtSec: number,
): Vec2 {
  const surface = surfaceSpeedMps(spec, command);
  if (surface === 0) return vec2(0, 0);

  const inward = drawDirection(spec);
  const targetAlong = surface * ROLLER_TRANSFER_RATIO;
  const currentAlong = relativeVelocityM.x * inward.x + relativeVelocityM.y * inward.y;

  const demanded = (pieceMassKg * (targetAlong - currentAlong)) / dtSec;
  // Only ever pushes the way the roller turns: a roller cannot pull a piece
  // back that is already leaving faster than its surface.
  const along = clampToward(demanded, targetAlong, maxRollerForceN(spec));

  return vec2(inward.x * along, inward.y * along);
}

function clampToward(demanded: number, target: number, limit: number): number {
  const sign = Math.sign(target);
  if (sign === 0) return 0;
  const signed = demanded * sign;
  if (signed <= 0) return 0;
  return sign * Math.min(signed, limit);
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
 * Speed and torque come from `deriveMechanism`, which already turned the motor,
 * gear ratio, count and efficiency into an output speed and torque. That is why
 * changing the intake's motor changes how fast it collects: the number the
 * physics reads is the one the drivetrain of that mechanism produces.
 */
export function deriveIntake(
  mechanism: DerivedMechanism,
  capability: AcquireCapability,
): IntakeSpec {
  const { mount } = mechanism.config;
  const rollerRadiusM = inchesToMeters(capability.rollerDiameterIn) / 2;

  return {
    mountM: vec2(inchesToMeters(mount.xIn), inchesToMeters(mount.yIn)),
    facingRad: (mount.facingDeg * Math.PI) / 180,
    reachM: inchesToMeters(capability.reachIn),
    mouthWidthM: inchesToMeters(capability.mouthWidthIn),
    rollerRadiusM,
    rollerRadPerSec: ((mechanism.outputRpm ?? 0) * Math.PI * 2) / 60,
    rollerTorqueNm: mechanism.outputTorqueNm ?? 0,
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
