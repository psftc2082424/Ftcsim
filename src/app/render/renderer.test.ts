import { describe, expect, it } from 'vitest';
import { fitCamera, metersToPixels, worldToScreenX, worldToScreenY } from './camera.js';
import { renderFrame } from './fieldRenderer.js';
import { createStandardField } from '../../core/field/fieldTemplate.js';
import { runHeadless } from '../../core/sim/headless.js';
import { DEFAULT_ROBOT_CONFIG } from '../../core/robot/robotConfig.js';
import { constantController } from '../../core/control/scripted.js';
import { createControlInput } from '../../core/control/controlInput.js';
import { vec2 } from '../../core/math/vec2.js';

describe('camera', () => {
  const field = createStandardField();

  it('centres world origin in the canvas', () => {
    const camera = fitCamera(800, 800, field.widthM, field.lengthM);
    expect(worldToScreenX(camera, 0)).toBeCloseTo(400, 9);
    expect(worldToScreenY(camera, 0)).toBeCloseTo(400, 9);
  });

  it('flips the Y axis: world up is screen up', () => {
    const camera = fitCamera(800, 800, field.widthM, field.lengthM);
    // A point north of origin must draw *above* the centre, i.e. smaller screen Y.
    expect(worldToScreenY(camera, 1)).toBeLessThan(worldToScreenY(camera, 0));
    expect(worldToScreenX(camera, 1)).toBeGreaterThan(worldToScreenX(camera, 0));
  });

  it('fits the field inside the canvas with a margin', () => {
    const camera = fitCamera(800, 800, field.widthM, field.lengthM, 0.05);
    const fieldPixels = metersToPixels(camera, field.widthM);
    expect(fieldPixels).toBeLessThanOrEqual(800 * 0.9 + 1e-9);
    expect(fieldPixels).toBeGreaterThan(800 * 0.85);
  });

  it('uses one scale for both axes on a non-square canvas', () => {
    const camera = fitCamera(1200, 600, field.widthM, field.lengthM);
    // Limited by the short side, so the field is not stretched.
    expect(metersToPixels(camera, field.lengthM)).toBeLessThanOrEqual(600);
  });

  it('scales linearly', () => {
    const camera = fitCamera(800, 800, field.widthM, field.lengthM);
    expect(metersToPixels(camera, 2)).toBeCloseTo(metersToPixels(camera, 1) * 2, 9);
  });
});

/** Minimal recording stand-in for a 2D context. */
interface DrawCall {
  readonly op: string;
  readonly args: readonly number[];
}

function createRecordingContext(width: number, height: number) {
  const calls: DrawCall[] = [];
  const record =
    (op: string) =>
    (...args: number[]): void => {
      calls.push({ op, args });
    };

  const ctx = {
    canvas: { clientWidth: width, clientHeight: height },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    rotate: record('rotate'),
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('field renderer', () => {
  const field = createStandardField();

  const snapshotAfter = (ticks: number) =>
    runHeadless({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(createControlInput(1, 0, 0)),
          startPose: { p: vec2(-1.0, 0.5), theta: 0.3 },
        },
      ],
      ticks,
    }).finalSnapshot;

  it('draws the backdrop, field and robot', () => {
    const { ctx, calls } = createRecordingContext(800, 800);
    renderFrame(ctx, snapshotAfter(50), field, 0);

    expect(calls.some((c) => c.op === 'fillRect')).toBe(true);
    expect(calls.some((c) => c.op === 'strokeRect')).toBe(true);
    // save/restore must balance, or the transform leaks into the next frame.
    expect(calls.filter((c) => c.op === 'save')).toHaveLength(
      calls.filter((c) => c.op === 'restore').length,
    );
  });

  it('places the robot at its interpolated screen position', () => {
    const snapshot = snapshotAfter(50);
    const robot = snapshot.robots[0];
    expect(robot).toBeDefined();
    if (robot === undefined) return;

    const { ctx, calls } = createRecordingContext(800, 800);
    renderFrame(ctx, snapshot, field, 1);

    const translate = calls.find((c) => c.op === 'translate');
    expect(translate).toBeDefined();

    const camera = fitCamera(800, 800, field.widthM, field.lengthM);
    expect(translate?.args[0]).toBeCloseTo(worldToScreenX(camera, robot.pose.p.x), 6);
    expect(translate?.args[1]).toBeCloseTo(worldToScreenY(camera, robot.pose.p.y), 6);
  });

  it('interpolates between the previous and current pose', () => {
    const snapshot = snapshotAfter(50);
    const robot = snapshot.robots[0];
    if (robot === undefined) return;

    const positionAt = (alpha: number): number => {
      const { ctx, calls } = createRecordingContext(800, 800);
      renderFrame(ctx, snapshot, field, alpha);
      return calls.find((c) => c.op === 'translate')?.args[0] ?? Number.NaN;
    };

    const camera = fitCamera(800, 800, field.widthM, field.lengthM);
    expect(positionAt(0)).toBeCloseTo(worldToScreenX(camera, robot.previousPose.p.x), 6);
    expect(positionAt(1)).toBeCloseTo(worldToScreenX(camera, robot.pose.p.x), 6);
    // Moving forward along +X, so a mid-frame draw sits between the two.
    expect(positionAt(0.5)).toBeGreaterThan(positionAt(0));
    expect(positionAt(0.5)).toBeLessThan(positionAt(1));
  });

  it('rotates the robot clockwise on screen for a counter-clockwise heading', () => {
    const snapshot = snapshotAfter(50);
    const robot = snapshot.robots[0];
    if (robot === undefined) return;

    const { ctx, calls } = createRecordingContext(800, 800);
    renderFrame(ctx, snapshot, field, 1);

    // Screen Y is inverted, so canvas rotation is the negated world heading.
    expect(calls.find((c) => c.op === 'rotate')?.args[0]).toBeCloseTo(-robot.pose.theta, 9);
  });

  /** CLAUDE.md: rendering is a pure read of simulation state. */
  it('does not mutate the snapshot', () => {
    const snapshot = snapshotAfter(50);
    const before = JSON.stringify(snapshot);

    const { ctx } = createRecordingContext(800, 800);
    renderFrame(ctx, snapshot, field, 0.5);

    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('honours the render options', () => {
    const snapshot = snapshotAfter(50);

    const withGrid = createRecordingContext(800, 800);
    renderFrame(withGrid.ctx, snapshot, field, 0, { showGrid: true, showVelocity: false });

    const withoutGrid = createRecordingContext(800, 800);
    renderFrame(withoutGrid.ctx, snapshot, field, 0, { showGrid: false, showVelocity: false });

    expect(withGrid.calls.filter((c) => c.op === 'moveTo').length).toBeGreaterThan(
      withoutGrid.calls.filter((c) => c.op === 'moveTo').length,
    );
  });

  it('draws a velocity vector only when moving', () => {
    const moving = snapshotAfter(200);
    const stopped = runHeadless({
      robots: [
        { config: DEFAULT_ROBOT_CONFIG, controller: constantController(createControlInput(0, 0, 0)) },
      ],
      ticks: 10,
    }).finalSnapshot;

    const a = createRecordingContext(800, 800);
    renderFrame(a.ctx, moving, field, 0, { showGrid: false, showVelocity: true });

    const b = createRecordingContext(800, 800);
    renderFrame(b.ctx, stopped, field, 0, { showGrid: false, showVelocity: true });

    expect(a.calls.filter((c) => c.op === 'lineTo').length).toBeGreaterThan(
      b.calls.filter((c) => c.op === 'lineTo').length,
    );
  });
});
