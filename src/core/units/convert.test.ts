import { describe, expect, it } from 'vitest';
import {
  KILOGRAMS_PER_POUND,
  METERS_PER_FOOT,
  METERS_PER_INCH,
  degPerSecToRadPerSec,
  degreesToRadians,
  feetPerSecToMetersPerSec,
  feetToMeters,
  inchesToMeters,
  kgCmToNewtonMeters,
  kilogramsToPounds,
  metersPerSec2ToFeetPerSec2,
  metersPerSecToFeetPerSec,
  metersToFeet,
  metersToInches,
  newtonMetersToKgCm,
  poundsToKilograms,
  radPerSecToDegPerSec,
  radPerSecToRpm,
  radiansToDegrees,
  rpmToRadPerSec,
} from './convert.js';
import { feetPerSec2ToMetersPerSec2 } from './convert.js';
import { metersPerSec, metersPerSec2, radPerSec, radians } from './si.js';

describe('definitional constants', () => {
  it('uses the exact international definitions', () => {
    expect(METERS_PER_INCH).toBe(0.0254);
    expect(METERS_PER_FOOT).toBe(0.3048);
    expect(KILOGRAMS_PER_POUND).toBe(0.45359237);
  });

  it('keeps foot and inch mutually consistent', () => {
    expect(METERS_PER_FOOT).toBeCloseTo(12 * METERS_PER_INCH, 15);
  });
});

describe('length', () => {
  it('converts known FTC field dimensions', () => {
    // The FTC field is 12 ft × 12 ft = 144 in on a side.
    expect(inchesToMeters(144)).toBeCloseTo(3.6576, 12);
    expect(feetToMeters(12)).toBeCloseTo(3.6576, 12);
  });

  it('round-trips', () => {
    for (const inches of [0, 1, 18, 96, 144, -7.25]) {
      expect(metersToInches(inchesToMeters(inches))).toBeCloseTo(inches, 12);
    }
    for (const feet of [0, 1, 12, -3.5]) {
      expect(metersToFeet(feetToMeters(feet))).toBeCloseTo(feet, 12);
    }
  });
});

describe('mass', () => {
  it('treats pounds as pound-mass', () => {
    expect(poundsToKilograms(1)).toBeCloseTo(0.45359237, 12);
    // A typical FTC robot around 32 lb.
    expect(poundsToKilograms(32)).toBeCloseTo(14.5149558, 6);
  });

  it('round-trips', () => {
    for (const lb of [0, 1, 32, 42.5]) {
      expect(kilogramsToPounds(poundsToKilograms(lb))).toBeCloseTo(lb, 12);
    }
  });
});

describe('velocity and acceleration', () => {
  it('converts ft/s to m/s', () => {
    expect(feetPerSecToMetersPerSec(1)).toBeCloseTo(0.3048, 12);
    expect(feetPerSecToMetersPerSec(8)).toBeCloseTo(2.4384, 12);
  });

  it('round-trips velocity and acceleration', () => {
    for (const fps of [0, 1, 8, 13.5]) {
      expect(metersPerSecToFeetPerSec(feetPerSecToMetersPerSec(fps))).toBeCloseTo(fps, 12);
    }
    for (const fps2 of [0, 35, -12.25]) {
      expect(metersPerSec2ToFeetPerSec2(feetPerSec2ToMetersPerSec2(fps2))).toBeCloseTo(fps2, 12);
    }
  });

  it('accepts already-branded SI values', () => {
    expect(metersPerSecToFeetPerSec(metersPerSec(0.3048))).toBeCloseTo(1, 12);
    expect(metersPerSec2ToFeetPerSec2(metersPerSec2(0.3048))).toBeCloseTo(1, 12);
  });
});

describe('angle', () => {
  it('converts cardinal angles', () => {
    expect(degreesToRadians(0)).toBe(0);
    expect(degreesToRadians(180)).toBeCloseTo(Math.PI, 15);
    expect(degreesToRadians(90)).toBeCloseTo(Math.PI / 2, 15);
    expect(radiansToDegrees(radians(Math.PI))).toBeCloseTo(180, 12);
  });

  it('round-trips', () => {
    for (const deg of [0, 45, 90, 180, 359.9, -270]) {
      expect(radiansToDegrees(degreesToRadians(deg))).toBeCloseTo(deg, 12);
    }
  });
});

describe('angular velocity', () => {
  it('converts RPM to rad/s', () => {
    // 60 RPM is exactly one revolution per second = 2π rad/s.
    expect(rpmToRadPerSec(60)).toBeCloseTo(Math.PI * 2, 12);
    // 6000 RPM, the bare-motor free speed of the goBILDA 5203 series.
    expect(rpmToRadPerSec(6000)).toBeCloseTo(628.3185307179587, 9);
  });

  it('round-trips RPM and deg/s', () => {
    for (const rpm of [0, 60, 312, 6000]) {
      expect(radPerSecToRpm(rpmToRadPerSec(rpm))).toBeCloseTo(rpm, 9);
    }
    for (const dps of [0, 200, -45.5]) {
      expect(radPerSecToDegPerSec(degPerSecToRadPerSec(dps))).toBeCloseTo(dps, 12);
    }
  });

  it('accepts already-branded SI values', () => {
    expect(radPerSecToRpm(radPerSec(Math.PI * 2))).toBeCloseTo(60, 12);
  });
});

describe('torque', () => {
  it('converts kg-cm to N-m using standard gravity', () => {
    // 1 kg·cm = 1 kgf acting at 1 cm = 9.80665 N × 0.01 m.
    expect(kgCmToNewtonMeters(1)).toBeCloseTo(0.0980665, 12);
  });

  it('round-trips', () => {
    for (const kgcm of [0, 1, 24.3, 100]) {
      expect(newtonMetersToKgCm(kgCmToNewtonMeters(kgcm))).toBeCloseTo(kgcm, 12);
    }
  });
});
