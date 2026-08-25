/**
 * goBILDA 5203 Series Yellow Jacket motor catalogue.
 *
 * Every field below is transcribed from the manufacturer's published product
 * page, cited per entry. Nothing here is estimated, recalled, or interpolated —
 * if a value could not be read from a datasheet it is not in this file
 * (CLAUDE.md: never silently invent real-world motor specifications).
 *
 * ── Two facts that shape the whole motor model ─────────────────────────────
 *
 * 1. Every ratio in the series reports the same 9.2 A stall current and 0.25 A
 *    no-load current. That is the signature of one shared base motor (a brushed
 *    RS-555) behind different planetary gearboxes: gearing changes torque and
 *    speed at the output shaft, but not the electrical behaviour of the winding.
 *
 *    The 1:1 entry is that bare base motor, so the shared constants below are
 *    read from a datasheet rather than inferred from the geared entries.
 *
 * 2. Published free speed and stall torque are quoted **at the output shaft**,
 *    so gearbox reduction *and* gearbox losses are already baked into them.
 *    Dividing the base motor's 6000 RPM by each ratio reproduces every published
 *    free speed to within rounding, while dividing published torque by
 *    (base torque x ratio) gives an implied gearbox efficiency spread across
 *    roughly 86-100 % — that spread is the differing stage counts of each
 *    gearbox, and it is real, not noise.
 *
 *    Consequence: the simulator must NOT apply a separate gearbox-efficiency
 *    term on top of these numbers. Doing so would count planetary losses twice.
 *    See ASSUMPTIONS.md §2.3 and §7.3.
 */

export interface MotorDatasheet {
  /** Stable identifier used by `RobotConfig.drivetrain.motorId`. */
  readonly id: string;
  readonly sku: string;
  readonly name: string;

  /** Planetary reduction, output shaft relative to the base motor. */
  readonly gearboxRatio: number;

  /** No-load speed at the output shaft, at `nominalVoltageV`. */
  readonly freeSpeedRpm: number;

  /** Stall torque at the output shaft, as printed. Both units are given on the
   *  datasheet; keeping both lets the unit conversion be cross-checked. */
  readonly stallTorqueKgCm: number;
  readonly stallTorqueOzIn: number;

  readonly stallCurrentA: number;
  readonly freeCurrentA: number;
  readonly nominalVoltageV: number;

  /** Encoder pulses per revolution at the output shaft. */
  readonly encoderPprOutputShaft: number;

  /** Product page the values above were read from. */
  readonly source: string;
  /** ISO date the page was retrieved. */
  readonly retrieved: string;
}

/**
 * Base motor free speed shared by the whole 5203 series, in RPM.
 * Read from the 1:1 datasheet (5203-2402-0001), not inferred.
 */
export const YELLOW_JACKET_BASE_FREE_SPEED_RPM = 6000;

/** Base motor stall torque at the bare shaft, in kg·cm. Same source. */
export const YELLOW_JACKET_BASE_STALL_TORQUE_KG_CM = 1.47;

export const GOBILDA_5203_SERIES: readonly MotorDatasheet[] = [
  {
    id: 'gobilda-5203-6000',
    sku: '5203-2402-0001',
    name: 'goBILDA 5203 Yellow Jacket 1:1 (6000 RPM)',
    gearboxRatio: 1,
    freeSpeedRpm: 6000,
    stallTorqueKgCm: 1.47,
    stallTorqueOzIn: 20.45,
    stallCurrentA: 9.2,
    freeCurrentA: 0.25,
    nominalVoltageV: 12,
    encoderPprOutputShaft: 28,
    source:
      'https://www.gobilda.com/5203-series-yellow-jacket-motor-1-1-ratio-24mm-length-8mm-rex-shaft-6000-rpm-3-3-5v-encoder/',
    retrieved: '2026-08-24',
  },
  {
    id: 'gobilda-5203-1620',
    sku: '5203-2402-0003',
    name: 'goBILDA 5203 Yellow Jacket 3.7:1 (1620 RPM)',
    gearboxRatio: 3.7,
    freeSpeedRpm: 1620,
    stallTorqueKgCm: 5.4,
    stallTorqueOzIn: 75.8,
    stallCurrentA: 9.2,
    freeCurrentA: 0.25,
    nominalVoltageV: 12,
    encoderPprOutputShaft: 103.8,
    source:
      'https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-3-7-1-ratio-1620-rpm-3-3-5v-encoder/',
    retrieved: '2026-08-24',
  },
  {
    id: 'gobilda-5203-1150',
    sku: '5203-2402-0005',
    name: 'goBILDA 5203 Yellow Jacket 5.2:1 (1150 RPM)',
    gearboxRatio: 5.2,
    freeSpeedRpm: 1150,
    stallTorqueKgCm: 7.9,
    stallTorqueOzIn: 109,
    stallCurrentA: 9.2,
    freeCurrentA: 0.25,
    nominalVoltageV: 12,
    encoderPprOutputShaft: 145.1,
    source:
      'https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-5-2-1-ratio-24mm-length-8mm-rex-shaft-1150-rpm-3-3-5v-encoder/',
    retrieved: '2026-08-24',
  },
  {
    id: 'gobilda-5203-435',
    sku: '5203-2402-0014',
    name: 'goBILDA 5203 Yellow Jacket 13.7:1 (435 RPM)',
    gearboxRatio: 13.7,
    freeSpeedRpm: 435,
    stallTorqueKgCm: 18.7,
    stallTorqueOzIn: 260,
    stallCurrentA: 9.2,
    freeCurrentA: 0.25,
    nominalVoltageV: 12,
    encoderPprOutputShaft: 384.5,
    source:
      'https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-13-7-1-ratio-24mm-length-8mm-rex-shaft-435-rpm-3-3-5v-encoder/',
    retrieved: '2026-08-24',
  },
  {
    id: 'gobilda-5203-312',
    sku: '5203-2402-0019',
    name: 'goBILDA 5203 Yellow Jacket 19.2:1 (312 RPM)',
    gearboxRatio: 19.2,
    freeSpeedRpm: 312,
    stallTorqueKgCm: 24.3,
    stallTorqueOzIn: 338,
    stallCurrentA: 9.2,
    freeCurrentA: 0.25,
    nominalVoltageV: 12,
    encoderPprOutputShaft: 537.7,
    source:
      'https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-19-2-1-ratio-24mm-length-8mm-rex-shaft-312-rpm-3-3-5v-encoder/',
    retrieved: '2026-08-24',
  },
  {
    id: 'gobilda-5203-223',
    sku: '5203-2402-0027',
    name: 'goBILDA 5203 Yellow Jacket 26.9:1 (223 RPM)',
    gearboxRatio: 26.9,
    freeSpeedRpm: 223,
    stallTorqueKgCm: 38.0,
    stallTorqueOzIn: 530,
    stallCurrentA: 9.2,
    freeCurrentA: 0.25,
    nominalVoltageV: 12,
    encoderPprOutputShaft: 751.8,
    source:
      'https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-26-9-1-ratio-24mm-length-8mm-rex-shaft-223-rpm-3-3-5v-encoder/',
    retrieved: '2026-08-24',
  },
  {
    id: 'gobilda-5203-117',
    sku: '5203-2402-0051',
    name: 'goBILDA 5203 Yellow Jacket 50.9:1 (117 RPM)',
    gearboxRatio: 50.9,
    freeSpeedRpm: 117,
    stallTorqueKgCm: 68.4,
    stallTorqueOzIn: 950,
    stallCurrentA: 9.2,
    freeCurrentA: 0.25,
    nominalVoltageV: 12,
    encoderPprOutputShaft: 1425.1,
    source:
      'https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-50-9-1-ratio-24mm-length-8mm-rex-shaft-117-rpm-3-3-5v-encoder/',
    retrieved: '2026-08-24',
  },
  {
    id: 'gobilda-5203-84',
    sku: '5203-2402-0071',
    name: 'goBILDA 5203 Yellow Jacket 71.2:1 (84 RPM)',
    gearboxRatio: 71.2,
    freeSpeedRpm: 84,
    stallTorqueKgCm: 93.6,
    stallTorqueOzIn: 1310,
    stallCurrentA: 9.2,
    freeCurrentA: 0.25,
    nominalVoltageV: 12,
    encoderPprOutputShaft: 1993.6,
    source:
      'https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-71-2-1-ratio-24mm-length-8mm-rex-shaft-84-rpm-3-3-5v-encoder/',
    retrieved: '2026-08-24',
  },
  {
    id: 'gobilda-5203-60',
    sku: '5203-2402-0100',
    name: 'goBILDA 5203 Yellow Jacket 99.5:1 (60 RPM)',
    gearboxRatio: 99.5,
    freeSpeedRpm: 60,
    stallTorqueKgCm: 133.2,
    stallTorqueOzIn: 1850,
    stallCurrentA: 9.2,
    freeCurrentA: 0.25,
    nominalVoltageV: 12,
    encoderPprOutputShaft: 2786.2,
    source:
      'https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-99-5-1-ratio-24mm-length-8mm-rex-shaft-60-rpm-3-3-5v-encoder/',
    retrieved: '2026-08-24',
  },
  {
    id: 'gobilda-5203-43',
    sku: '5203-2402-0139',
    name: 'goBILDA 5203 Yellow Jacket 139:1 (43 RPM)',
    gearboxRatio: 139,
    freeSpeedRpm: 43,
    stallTorqueKgCm: 185,
    stallTorqueOzIn: 2570,
    stallCurrentA: 9.2,
    freeCurrentA: 0.25,
    nominalVoltageV: 12,
    encoderPprOutputShaft: 3895.9,
    source:
      'https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-139-1-ratio-24mm-length-8mm-rex-shaft-43-rpm-3-3-5v-encoder/',
    retrieved: '2026-08-24',
  },
];

const BY_ID = new Map(GOBILDA_5203_SERIES.map((m) => [m.id, m]));

/** The default drivetrain motor: 312 RPM is the most common FTC drive choice. */
export const DEFAULT_DRIVE_MOTOR_ID = 'gobilda-5203-312';

export function getMotorDatasheet(id: string): MotorDatasheet {
  const found = BY_ID.get(id);
  if (found === undefined) {
    throw new Error(
      `Unknown motor id "${id}". Known ids: ${GOBILDA_5203_SERIES.map((m) => m.id).join(', ')}`,
    );
  }
  return found;
}

export function listMotorIds(): readonly string[] {
  return GOBILDA_5203_SERIES.map((m) => m.id);
}
