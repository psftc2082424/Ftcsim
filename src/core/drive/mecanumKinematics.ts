/**
 * Mecanum kinematics — 45° rollers in the standard X configuration.
 *
 * Frames and signs (fixed in `math/angle.ts`, restated here because every sign
 * below depends on them):
 *
 *   - Robot body frame: +X is robot-forward, +Y is robot-left.
 *   - Positive `omega` is counter-clockwise.
 *   - A positive wheel value means that wheel drives its contact patch forward.
 *
 * `k = halfTrack + halfWheelbase` is the single geometric constant coupling
 * translation and rotation. It is derived from the robot's outer length and
 * width in `robot/derive.ts`; the user never enters a track width or wheelbase
 * (PRODUCT_SPEC.md §4).
 *
 * Inverse kinematics (body → wheel):
 *
 *     v_FL = vx - vy - k*w        v_FR = vx + vy + k*w
 *     v_BL = vx + vy - k*w        v_BR = vx - vy + k*w
 *
 * Forward kinematics is the pseudo-inverse; the wrench mapping is the Jacobian
 * transpose. All three share one sign pattern, expressed once in `mix()`.
 */

export interface WheelValues {
  readonly frontLeft: number;
  readonly frontRight: number;
  readonly backLeft: number;
  readonly backRight: number;
}

export interface ChassisVelocity {
  /** Forward, m/s. */
  readonly vx: number;
  /** Left, m/s. */
  readonly vy: number;
  /** Counter-clockwise, rad/s. */
  readonly omega: number;
}

/** Body-frame force and torque. */
export interface ChassisWrench {
  /** Forward force, N. */
  readonly fx: number;
  /** Leftward force, N. */
  readonly fy: number;
  /** Counter-clockwise torque, N·m. */
  readonly mz: number;
}

/**
 * The one sign pattern shared by every mecanum relation.
 *
 * `turnTerm` is `k * omega` in the velocity domain and a dimensionless turn
 * command in the command domain — the mixing is identical either way.
 */
function mix(x: number, y: number, turnTerm: number): WheelValues {
  return {
    frontLeft: x - y - turnTerm,
    frontRight: x + y + turnTerm,
    backLeft: x + y - turnTerm,
    backRight: x - y + turnTerm,
  };
}

/** Fixed iteration order, so nothing downstream can depend on object key order. */
export function toArray(w: WheelValues): readonly [number, number, number, number] {
  return [w.frontLeft, w.frontRight, w.backLeft, w.backRight];
}

export function fromArray(values: readonly [number, number, number, number]): WheelValues {
  return {
    frontLeft: values[0],
    frontRight: values[1],
    backLeft: values[2],
    backRight: values[3],
  };
}

export function mapWheels(w: WheelValues, fn: (value: number) => number): WheelValues {
  return {
    frontLeft: fn(w.frontLeft),
    frontRight: fn(w.frontRight),
    backLeft: fn(w.backLeft),
    backRight: fn(w.backRight),
  };
}

/** Combine two per-wheel quantities wheel-by-wheel. */
export function zipWheels(
  a: WheelValues,
  b: WheelValues,
  fn: (a: number, b: number) => number,
): WheelValues {
  return {
    frontLeft: fn(a.frontLeft, b.frontLeft),
    frontRight: fn(a.frontRight, b.frontRight),
    backLeft: fn(a.backLeft, b.backLeft),
    backRight: fn(a.backRight, b.backRight),
  };
}

/**
 * Inverse kinematics: chassis velocity → wheel contact-patch linear speeds, m/s.
 *
 * With perfect traction there is no slip, so this also determines each wheel's
 * angular velocity for any given chassis motion — which is how the drivetrain
 * knows where on the torque-speed curve each motor is operating.
 */
export function chassisToWheelVelocities(chassis: ChassisVelocity, k: number): WheelValues {
  return mix(chassis.vx, chassis.vy, k * chassis.omega);
}

/** Forward kinematics: wheel linear speeds → chassis velocity. */
export function wheelVelocitiesToChassis(w: WheelValues, k: number): ChassisVelocity {
  const { frontLeft: fl, frontRight: fr, backLeft: bl, backRight: br } = w;
  return {
    vx: (fl + fr + bl + br) / 4,
    vy: (-fl + fr + bl - br) / 4,
    omega: (-fl + fr - bl + br) / (4 * k),
  };
}

/**
 * Driver command mixing. Inputs are dimensionless stick values; the result is a
 * per-wheel command that still needs saturating before use.
 */
export function commandToWheels(x: number, y: number, turn: number): WheelValues {
  return mix(x, y, turn);
}

/**
 * Jacobian transpose: per-wheel forces → body-frame wrench.
 *
 * This is the dual of `wheelVelocitiesToChassis`, which is why it carries the
 * same sign pattern. Getting it by transposing the kinematics rather than by
 * inventing a force distribution is what keeps the dynamics consistent with the
 * kinematics — power in equals power out.
 */
export function wheelForcesToChassisWrench(forces: WheelValues, k: number): ChassisWrench {
  const { frontLeft: fl, frontRight: fr, backLeft: bl, backRight: br } = forces;
  return {
    fx: fl + fr + bl + br,
    fy: -fl + fr + bl - br,
    mz: (-fl + fr - bl + br) * k,
  };
}

/**
 * Normalise wheel commands into [-1, 1] while preserving the commanded motion.
 *
 * If any wheel exceeds unit magnitude, every wheel is divided by that same
 * maximum. Clipping wheels individually would silently rotate the resulting
 * motion away from what the driver asked for — a robot commanded to strafe
 * would curve. Scaling uniformly slows the motion but keeps its direction
 * (PRODUCT_SPEC.md §6, "wheel-speed saturation").
 */
export function saturate(w: WheelValues): WheelValues {
  const peak = Math.max(
    Math.abs(w.frontLeft),
    Math.abs(w.frontRight),
    Math.abs(w.backLeft),
    Math.abs(w.backRight),
  );
  if (peak <= 1 || peak === 0) return w;
  const scale = 1 / peak;
  return mapWheels(w, (v) => v * scale);
}
