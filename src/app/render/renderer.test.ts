import { describe, expect, it } from 'vitest';
import { fitCamera, metersToPixels, worldToScreenX, worldToScreenY } from './camera.js';
import { DEFAULT_RENDER_OPTIONS, renderFrame } from './fieldRenderer.js';
import {
  DECODE_FIELD_REGIONS,
  DECODE_FIELD_ZONES,
  DECODE_LAUNCH_ZONE_OUTLINES,
} from '../../core/game/fixtures/decodeField.js';
import { inchesToMeters } from '../../core/units/convert.js';
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
  const texts: string[] = [];
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
    closePath: record('closePath'),
    fill: record('fill'),
    arc: record('arc'),
    fillText: (text: string, x: number, y: number): void => {
      calls.push({ op: 'fillText', args: [x, y] });
      texts.push(text);
    },
    font: '',
    textAlign: 'start',
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, texts };
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

/**
 * Game geometry and pieces are drawn, and the renderer stays season-agnostic
 * while doing it.
 *
 * The app used to show a bare field with a robot on it: `snapshot.pieces` was
 * never drawn at all, and none of the regions or zones a `GameDefinition`
 * declares appeared. Phase 3 was complete in the core and invisible in the
 * product.
 */
describe('game overlay and pieces', () => {
  const field = createStandardField();

  const overlay = { regions: DECODE_FIELD_REGIONS, zones: DECODE_FIELD_ZONES };

  const withPieces = (ticks: number) =>
    runHeadless({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(createControlInput(0, 0, 0)),
          startPose: { p: vec2(-1.0, 0.5), theta: 0 },
        },
      ],
      pieces: [
        { pieceId: 'a1', pieceType: 'P', diameterIn: 4.9, massLb: 0.165, startPositionM: vec2(0.3, 0.2) },
      ],
      ticks,
    }).finalSnapshot;

  it('draws a game piece as a circle at its own position', () => {
    const snapshot = withPieces(10);
    const piece = snapshot.pieces[0];
    expect(piece).toBeDefined();
    if (piece === undefined) return;

    const { ctx, calls } = createRecordingContext(800, 800);
    renderFrame(ctx, snapshot, field, 1);

    const camera = fitCamera(800, 800, field.widthM, field.lengthM);
    const arcs = calls.filter((c) => c.op === 'arc');
    expect(arcs.length).toBeGreaterThan(0);
    expect(arcs[0]?.args[0]).toBeCloseTo(worldToScreenX(camera, piece.pose.p.x), 6);
    expect(arcs[0]?.args[1]).toBeCloseTo(worldToScreenY(camera, piece.pose.p.y), 6);
  });

  it('draws nothing extra without an overlay', () => {
    const snapshot = withPieces(1);
    const without = createRecordingContext(800, 800);
    renderFrame(without.ctx, snapshot, field, 0);

    const with_ = createRecordingContext(800, 800);
    renderFrame(with_.ctx, snapshot, field, 0, DEFAULT_RENDER_OPTIONS, overlay);

    expect(with_.calls.length).toBeGreaterThan(without.calls.length);
  });

  it('honours the option that turns game geometry off', () => {
    const snapshot = withPieces(1);
    const on = createRecordingContext(800, 800);
    renderFrame(on.ctx, snapshot, field, 0, DEFAULT_RENDER_OPTIONS, overlay);

    const off = createRecordingContext(800, 800);
    renderFrame(
      off.ctx,
      snapshot,
      field,
      0,
      { ...DEFAULT_RENDER_OPTIONS, showGameGeometry: false },
      overlay,
    );

    expect(off.calls.length).toBeLessThan(on.calls.length);
  });

  it('closes a path for every polygon it fills', () => {
    const snapshot = withPieces(1);
    const { calls } = (() => {
      const rec = createRecordingContext(800, 800);
      renderFrame(rec.ctx, snapshot, field, 0, DEFAULT_RENDER_OPTIONS, overlay);
      return rec;
    })();

    // One closePath per polygonal region or zone; circles use arc instead.
    const polygons = [...overlay.regions, ...overlay.zones].filter(
      (shaped) => shaped.shape.kind !== 'circle',
    ).length;
    expect(calls.filter((c) => c.op === 'closePath')).toHaveLength(polygons);
  });

  it('labels shapes by id only when asked', () => {
    const snapshot = withPieces(1);

    const plain = createRecordingContext(800, 800);
    renderFrame(plain.ctx, snapshot, field, 0, DEFAULT_RENDER_OPTIONS, overlay);
    expect(plain.texts).toEqual([]);

    const labelled = createRecordingContext(800, 800);
    renderFrame(
      labelled.ctx,
      snapshot,
      field,
      0,
      { ...DEFAULT_RENDER_OPTIONS, showGeometryLabels: true },
      overlay,
    );
    expect(labelled.texts).toContain('red-ramp');
    expect(labelled.texts).toContain('goal-launch-zone');
  });

  /**
   * The renderer may not branch on what a region *is*. It colours by id prefix,
   * which is a display convention: getting it wrong tints an outline and can
   * never change a score.
   */
  it('draws a triangular zone with its real vertex count', () => {
    const snapshot = withPieces(1);
    const { ctx, calls } = createRecordingContext(800, 800);
    renderFrame(ctx, snapshot, field, 0, DEFAULT_RENDER_OPTIONS, overlay);

    const camera = fitCamera(800, 800, field.widthM, field.lengthM);
    const apex = DECODE_LAUNCH_ZONE_OUTLINES.goalSide.find((v) => v.x === 0);
    expect(apex).toBeDefined();
    if (apex === undefined) return;

    const target = {
      x: worldToScreenX(camera, inchesToMeters(apex.x)),
      y: worldToScreenY(camera, inchesToMeters(apex.y)),
    };
    const hit = calls.some(
      (c) =>
        (c.op === 'lineTo' || c.op === 'moveTo') &&
        Math.abs((c.args[0] ?? 0) - target.x) < 1e-6 &&
        Math.abs((c.args[1] ?? 0) - target.y) < 1e-6,
    );
    expect(hit).toBe(true);
  });
});
