import { describe, expect, it } from 'vitest';
import { computePerformance, percentChange } from './robotPerformance.js';
import { DEFAULT_ROBOT_CONFIG, type RobotConfig } from '../core/robot/robotConfig.js';

const withChassis = (patch: Partial<RobotConfig['chassis']>): RobotConfig => ({
  ...DEFAULT_ROBOT_CONFIG,
  chassis: { ...DEFAULT_ROBOT_CONFIG.chassis, ...patch },
});

const withDrivetrain = (patch: Partial<RobotConfig['drivetrain']>): RobotConfig => ({
  ...DEFAULT_ROBOT_CONFIG,
  drivetrain: { ...DEFAULT_ROBOT_CONFIG.drivetrain, ...patch },
});

describe('performance readout — matches the Phase 1 reference robot', () => {
  const perf = computePerformance(DEFAULT_ROBOT_CONFIG);

  it('reports the hand-computed figures', () => {
    expect(perf.topSpeedFtPerSec).toBeCloseTo(5.146, 2);
    expect(perf.peakAccelFtPerSec2).toBeCloseTo(42.64, 1);
    expect(perf.spinRateDegPerSec).toBeCloseTo(228.3, 0);
    expect(perf.trackIn).toBeCloseTo(15.5, 1);
    expect(perf.wheelbaseIn).toBeCloseTo(15.5, 1);
  });

  it('flags the acceleration as exceeding 1 g', () => {
    // The perfect-traction consequence, surfaced so the UI can caveat it.
    expect(perf.peakAccelG).toBeGreaterThan(1);
    expect(perf.peakAccelG).toBeCloseTo(1.33, 1);
  });

  it('reports a four-motor stall load and its sag', () => {
    expect(perf.stallCurrentA).toBeCloseTo(36.8, 6);
    expect(perf.stallSagV).toBeCloseTo(36.8 * 0.03, 6);
  });

  it('does not report clamped geometry for a normal robot', () => {
    expect(perf.geometryClamped).toBe(false);
  });
});

describe('performance readout — responds to design changes', () => {
  const base = computePerformance(DEFAULT_ROBOT_CONFIG);

  /**
   * These are the engineering tradeoffs the whole product exists to show. Each
   * assertion is a claim about physics, not about code.
   */
  it('mass changes acceleration but never top speed', () => {
    const heavy = computePerformance(withChassis({ massLb: 64 }));
    expect(heavy.peakAccelFtPerSec2).toBeCloseTo(base.peakAccelFtPerSec2 / 2, 3);
    expect(heavy.topSpeedFtPerSec).toBeCloseTo(base.topSpeedFtPerSec, 9);
  });

  it('gearing down trades top speed for acceleration', () => {
    const geared = computePerformance(withDrivetrain({ gearRatio: 2 }));
    expect(geared.topSpeedFtPerSec).toBeCloseTo(base.topSpeedFtPerSec / 2, 6);
    expect(geared.peakAccelFtPerSec2).toBeCloseTo(base.peakAccelFtPerSec2 * 2, 6);
  });

  it('a bigger wheel trades acceleration for top speed', () => {
    const bigger = computePerformance(withDrivetrain({ wheelDiameterIn: 7.56 }));
    expect(bigger.topSpeedFtPerSec).toBeCloseTo(base.topSpeedFtPerSec * 2, 6);
    expect(bigger.peakAccelFtPerSec2).toBeCloseTo(base.peakAccelFtPerSec2 / 2, 6);
  });

  it('a faster motor raises top speed and lowers acceleration', () => {
    const fast = computePerformance(withDrivetrain({ motorId: 'gobilda-5203-435' }));
    expect(fast.topSpeedFtPerSec).toBeGreaterThan(base.topSpeedFtPerSec);
    expect(fast.peakAccelFtPerSec2).toBeLessThan(base.peakAccelFtPerSec2);
  });

  it('doubling motors doubles acceleration and stall current, not top speed', () => {
    const dual = computePerformance(withDrivetrain({ motorCount: 8 }));
    expect(dual.peakAccelFtPerSec2).toBeCloseTo(base.peakAccelFtPerSec2 * 2, 6);
    expect(dual.stallCurrentA).toBeCloseTo(base.stallCurrentA * 2, 6);
    expect(dual.topSpeedFtPerSec).toBeCloseTo(base.topSpeedFtPerSec, 9);
  });

  it('a wider robot spins slower', () => {
    // Larger k means the wheels sit further from the centre, so the same wheel
    // speed produces less angular rate.
    const wide = computePerformance(withChassis({ lengthIn: 30, widthIn: 30 }));
    expect(wide.spinRateDegPerSec).toBeLessThan(base.spinRateDegPerSec);
    expect(wide.topSpeedFtPerSec).toBeCloseTo(base.topSpeedFtPerSec, 9);
  });

  it('reports clamped geometry for an impossibly small robot', () => {
    expect(computePerformance(withChassis({ lengthIn: 2, widthIn: 2 })).geometryClamped).toBe(true);
  });
});

describe('percentChange', () => {
  it('reports signed relative change', () => {
    expect(percentChange(10, 15)).toBeCloseTo(50, 9);
    expect(percentChange(10, 5)).toBeCloseTo(-50, 9);
    expect(percentChange(10, 10)).toBe(0);
  });

  it('does not divide by zero', () => {
    expect(percentChange(0, 5)).toBe(0);
  });
});
