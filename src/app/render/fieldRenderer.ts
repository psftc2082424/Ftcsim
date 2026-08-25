/**
 * Canvas 2D renderer.
 *
 * A pure read of simulation state: nothing here mutates the world, and no
 * gameplay logic lives in a draw call (CLAUDE.md). The renderer receives a
 * `WorldSnapshot` plus an interpolation factor and draws; that is all.
 *
 * `alpha` is how far the current frame sits between the last two simulation
 * ticks. Drawing at `lerp(previousPose, pose, alpha)` is what lets the display
 * run at whatever rate the monitor offers while physics stays locked to 200 Hz.
 */

import { lerpAngle } from '../../core/math/angle.js';
import { inchesToMeters } from '../../core/units/convert.js';
import type { WorldSnapshot } from '../../core/sim/snapshot.js';
import type { FieldTemplate } from '../../core/field/fieldTemplate.js';
import { fitCamera, metersToPixels, worldToScreenX, worldToScreenY, type Camera } from './camera.js';

/** FTC fields are laid out on 24 in foam tiles, 6 x 6 of them. */
const TILE_SIZE_M = inchesToMeters(24);

const COLORS = {
  backdrop: '#0d1117',
  tile: '#1c2530',
  tileLine: '#2a3644',
  fieldEdge: '#4a5b6e',
  wall: '#39485a',
  axis: '#2f3d4d',
  robotBody: '#3d7dca',
  robotOutline: '#9ecbff',
  robotFront: '#ffd166',
  velocity: '#5ce0a0',
} as const;

export interface RenderOptions {
  readonly showVelocity: boolean;
  readonly showGrid: boolean;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  showVelocity: true,
  showGrid: true,
};

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  field: FieldTemplate,
  alpha: number,
  options: RenderOptions = DEFAULT_RENDER_OPTIONS,
): void {
  const width = ctx.canvas.clientWidth;
  const height = ctx.canvas.clientHeight;
  const camera = fitCamera(width, height, field.widthM, field.lengthM);

  ctx.fillStyle = COLORS.backdrop;
  ctx.fillRect(0, 0, width, height);

  drawField(ctx, camera, field, options.showGrid);
  for (const robot of snapshot.robots) {
    drawRobot(ctx, camera, robot, alpha, options.showVelocity);
  }
}

function drawField(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  field: FieldTemplate,
  showGrid: boolean,
): void {
  const halfW = field.widthM / 2;
  const halfL = field.lengthM / 2;

  const left = worldToScreenX(camera, -halfW);
  const top = worldToScreenY(camera, halfL);
  const sizeX = metersToPixels(camera, field.widthM);
  const sizeY = metersToPixels(camera, field.lengthM);

  ctx.fillStyle = COLORS.tile;
  ctx.fillRect(left, top, sizeX, sizeY);

  if (showGrid) {
    ctx.strokeStyle = COLORS.tileLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -halfW + TILE_SIZE_M; x < halfW - 1e-9; x += TILE_SIZE_M) {
      const sx = Math.round(worldToScreenX(camera, x)) + 0.5;
      ctx.moveTo(sx, top);
      ctx.lineTo(sx, top + sizeY);
    }
    for (let y = -halfL + TILE_SIZE_M; y < halfL - 1e-9; y += TILE_SIZE_M) {
      const sy = Math.round(worldToScreenY(camera, y)) + 0.5;
      ctx.moveTo(left, sy);
      ctx.lineTo(left + sizeX, sy);
    }
    ctx.stroke();
  }

  // Origin cross, so the coordinate convention is visible while driving.
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(worldToScreenX(camera, 0), top);
  ctx.lineTo(worldToScreenX(camera, 0), top + sizeY);
  ctx.moveTo(left, worldToScreenY(camera, 0));
  ctx.lineTo(left + sizeX, worldToScreenY(camera, 0));
  ctx.stroke();

  // Perimeter, drawn from the actual collision bodies rather than from the
  // nominal size, so what is displayed is what the physics uses.
  ctx.strokeStyle = COLORS.wall;
  ctx.lineWidth = 3;
  for (const body of field.bodies) {
    if (body.shape.kind !== 'obb') continue;
    const { x: hx, y: hy } = body.shape.halfExtents;
    ctx.strokeRect(
      worldToScreenX(camera, body.pose.p.x - hx),
      worldToScreenY(camera, body.pose.p.y + hy),
      metersToPixels(camera, hx * 2),
      metersToPixels(camera, hy * 2),
    );
  }

  ctx.strokeStyle = COLORS.fieldEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(left, top, sizeX, sizeY);
}

function drawRobot(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  robot: WorldSnapshot['robots'][number],
  alpha: number,
  showVelocity: boolean,
): void {
  // Interpolate between the last two ticks so motion is smooth at any frame
  // rate without the physics ever seeing a variable timestep.
  const x = robot.previousPose.p.x + (robot.pose.p.x - robot.previousPose.p.x) * alpha;
  const y = robot.previousPose.p.y + (robot.pose.p.y - robot.previousPose.p.y) * alpha;
  const theta = lerpAngle(robot.previousPose.theta, robot.pose.theta, alpha);

  const screenX = worldToScreenX(camera, x);
  const screenY = worldToScreenY(camera, y);
  const halfLength = metersToPixels(camera, robot.lengthM / 2);
  const halfWidth = metersToPixels(camera, robot.widthM / 2);

  ctx.save();
  ctx.translate(screenX, screenY);
  // Screen Y is inverted relative to world Y, so a counter-clockwise world
  // rotation is a clockwise canvas rotation.
  ctx.rotate(-theta);

  ctx.fillStyle = COLORS.robotBody;
  ctx.strokeStyle = COLORS.robotOutline;
  ctx.lineWidth = 2;
  ctx.fillRect(-halfLength, -halfWidth, halfLength * 2, halfWidth * 2);
  ctx.strokeRect(-halfLength, -halfWidth, halfLength * 2, halfWidth * 2);

  // Front face marker: robot-forward is +X in the body frame.
  ctx.fillStyle = COLORS.robotFront;
  ctx.fillRect(halfLength - Math.max(3, halfLength * 0.18), -halfWidth, Math.max(3, halfLength * 0.18), halfWidth * 2);

  ctx.restore();

  if (showVelocity) {
    const speed = Math.hypot(robot.vel.v.x, robot.vel.v.y);
    if (speed > 0.02) {
      // Scaled so a full-speed FTC robot draws a visible but bounded arrow.
      const scale = metersToPixels(camera, 0.35);
      ctx.strokeStyle = COLORS.velocity;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(screenX, screenY);
      ctx.lineTo(screenX + robot.vel.v.x * scale, screenY - robot.vel.v.y * scale);
      ctx.stroke();
    }
  }
}

/**
 * Size the backing store to the element's CSS size times the device pixel
 * ratio, so the field stays crisp on high-DPI displays. Returns true when the
 * canvas was resized.
 */
export function syncCanvasSize(canvas: HTMLCanvasElement): boolean {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));

  if (canvas.width === width && canvas.height === height) return false;

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return true;
}
