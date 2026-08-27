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
import { worldVertices } from '../../core/physics/shapes.js';
import type { WorldSnapshot } from '../../core/sim/snapshot.js';
import type { FieldTemplate } from '../../core/field/fieldTemplate.js';
import type { FieldRegion, FieldZone } from '../../core/game/regions.js';
import { fitCamera, metersToPixels, worldToScreenX, worldToScreenY, type Camera } from './camera.js';

/** FTC fields are laid out on 24 in foam tiles, 6 x 6 of them. */
const TILE_SIZE_M = inchesToMeters(24);

const COLORS = {
  backdrop: '#111820',
  tile: '#263442',
  tileLine: '#415363',
  fieldEdge: '#d8e2e9',
  wall: '#a9b8c3',
  axis: '#2f3d4d',
  robotBody: '#3d7dca',
  robotOutline: '#9ecbff',
  robotFront: '#ffd166',
  velocity: '#5ce0a0',
  piece: '#b072d6',
  pieceOutline: '#e0c6f2',
  pieceShadow: 'rgba(0, 0, 0, 0.35)',
  regionFill: 'rgba(120, 170, 220, 0.10)',
  regionEdge: 'rgba(255, 255, 255, 0.74)',
  redEdge: '#e23448',
  blueEdge: '#1772d0',
  label: 'rgba(200, 220, 240, 0.75)',
} as const;

/**
 * Game geometry to draw underneath the robots.
 *
 * Optional, and typed as the game layer's own shapes rather than as something
 * the renderer defines: a season is data, and the renderer should draw whatever
 * regions and zones a `GameDefinition` happens to declare without knowing what
 * any of them mean. Nothing here reads a region id.
 */
export interface FieldOverlay {
  readonly regions: readonly FieldRegion[];
  readonly zones: readonly FieldZone[];
}

export interface RenderOptions {
  readonly showVelocity: boolean;
  readonly showGrid: boolean;
  /** Draw the game's regions and zones. Off shows a bare drivetrain field. */
  readonly showGameGeometry?: boolean | undefined;
  /** Label each region and zone with its id. Useful while authoring a layout. */
  readonly showGeometryLabels?: boolean | undefined;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  showVelocity: true,
  showGrid: true,
  showGameGeometry: true,
  showGeometryLabels: false,
};

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  field: FieldTemplate,
  alpha: number,
  options: RenderOptions = DEFAULT_RENDER_OPTIONS,
  overlay?: FieldOverlay | undefined,
): void {
  const width = ctx.canvas.clientWidth;
  const height = ctx.canvas.clientHeight;
  const camera = fitCamera(width, height, field.widthM, field.lengthM);

  ctx.fillStyle = COLORS.backdrop;
  ctx.fillRect(0, 0, width, height);

  drawField(ctx, camera, field, options.showGrid);

  // Under the entities: game geometry is markings on the floor, and a robot
  // standing on a zone should be drawn over it.
  if (overlay !== undefined && options.showGameGeometry !== false) {
    drawOverlay(ctx, camera, overlay, options.showGeometryLabels === true, field.id === 'ftc-decode-2025-26');
  }

  for (const piece of snapshot.pieces) drawPiece(ctx, camera, piece, alpha);
  for (const robot of snapshot.robots) {
    drawRobot(ctx, camera, robot, alpha, options.showVelocity);
  }
}

/**
 * Draw every region and zone the game declares.
 *
 * Alliance colouring comes from the id prefix, which is a *display* convention
 * and nothing else: getting it wrong tints an outline, it cannot change a
 * score. The renderer still has no idea what any of these places are for.
 */
function drawOverlay(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  overlay: FieldOverlay,
  showLabels: boolean,
  decodePresentation: boolean,
): void {
  for (const shaped of [...overlay.regions, ...overlay.zones]) {
    const kind = presentationKind(shaped.id);
    // DECODE's physical goal/ramp assemblies come from the field fixture, not
    // their rule regions. Drawing the latter would reintroduce the old large
    // abstract rectangles on top of the real top-down geometry.
    if (decodePresentation && (kind === 'goal' || kind === 'structure')) continue;
    const allianceColor = shaped.id.startsWith('red-') ? COLORS.redEdge : shaped.id.startsWith('blue-') ? COLORS.blueEdge : COLORS.regionEdge;
    ctx.fillStyle = kind === 'goal' ? (shaped.id.startsWith('red-') ? '#9d1f31' : '#1559a5') : COLORS.regionFill;
    ctx.strokeStyle = allianceColor;
    ctx.lineWidth = kind === 'tape' ? 3 : kind === 'structure' || kind === 'goal' ? 2.5 : 1.5;

    if (shaped.shape.kind === 'circle') {
      const radius = metersToPixels(camera, shaped.shape.radius);
      ctx.beginPath();
      ctx.arc(
        worldToScreenX(camera, shaped.centerM.x),
        worldToScreenY(camera, shaped.centerM.y),
        radius,
        0,
        Math.PI * 2,
      );
      if (kind !== 'tape') ctx.fill();
      ctx.stroke();
    } else {
      const vertices = shaped.shape.vertices;
      if (vertices.length === 0) continue;

      if (decodePresentation && shaped.id.includes('spike')) {
        const minX = Math.min(...vertices.map((vertex) => vertex.x));
        const maxX = Math.max(...vertices.map((vertex) => vertex.x));
        const centerY = shaped.centerM.y;
        ctx.beginPath();
        ctx.moveTo(worldToScreenX(camera, minX), worldToScreenY(camera, centerY));
        ctx.lineTo(worldToScreenX(camera, maxX), worldToScreenY(camera, centerY));
        ctx.stroke();
        continue;
      }

      if (decodePresentation && shaped.id.includes('gate-zone')) {
        const minX = Math.min(...vertices.map((vertex) => vertex.x));
        const maxX = Math.max(...vertices.map((vertex) => vertex.x));
        const minY = Math.min(...vertices.map((vertex) => vertex.y));
        const maxY = Math.max(...vertices.map((vertex) => vertex.y));
        ctx.beginPath();
        ctx.moveTo(worldToScreenX(camera, minX), worldToScreenY(camera, minY));
        ctx.lineTo(worldToScreenX(camera, maxX), worldToScreenY(camera, minY));
        ctx.moveTo(worldToScreenX(camera, minX), worldToScreenY(camera, maxY));
        ctx.lineTo(worldToScreenX(camera, maxX), worldToScreenY(camera, maxY));
        ctx.stroke();
        continue;
      }

      ctx.beginPath();
      vertices.forEach((vertex, index) => {
        const sx = worldToScreenX(camera, vertex.x);
        const sy = worldToScreenY(camera, vertex.y);
        if (index === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
      if (kind !== 'tape') ctx.fill();
      ctx.stroke();

      if (kind === 'goal' || kind === 'structure') {
        ctx.save();
        ctx.globalAlpha = 0.24;
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
      }
    }

    if (showLabels) {
      ctx.fillStyle = COLORS.label;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        shaped.id,
        worldToScreenX(camera, shaped.centerM.x),
        worldToScreenY(camera, shaped.centerM.y),
      );
      ctx.textAlign = 'start';
    }
  }
}

/** Presentation-only classification; game rules and collision never read this. */
function presentationKind(id: string): 'goal' | 'structure' | 'tape' | 'zone' {
  if (id.endsWith('-goal')) return 'goal';
  if (id.endsWith('-ramp') || id.includes('tunnel') || id.includes('gate')) return 'structure';
  if (id.includes('spike') || id.includes('launch') || id.includes('base') || id.includes('loading') || id.includes('depot')) return 'tape';
  return 'zone';
}

/**
 * How much bigger a piece is drawn per metre of height, as a fraction.
 *
 * A top-down view has no way to show that something is in the air, so a shot
 * would look identical to a piece skidding across the floor. Growing it — and
 * leaving a shadow behind on the ground — is the usual convention and reads
 * immediately. Purely presentational: nothing reads this back.
 */
const HEIGHT_SCALE_PER_M = 0.6;

function drawPiece(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  piece: WorldSnapshot['pieces'][number],
  alpha: number,
): void {
  const x = piece.previousPose.p.x + (piece.pose.p.x - piece.previousPose.p.x) * alpha;
  const y = piece.previousPose.p.y + (piece.pose.p.y - piece.previousPose.p.y) * alpha;
  const heightM = piece.previousHeightM + (piece.heightM - piece.previousHeightM) * alpha;

  const screenX = worldToScreenX(camera, x);
  const screenY = worldToScreenY(camera, y);
  // Floored so an artifact stays visible when the whole field is on screen.
  const groundRadius = Math.max(2, metersToPixels(camera, piece.radiusM));

  // Height above resting, so a piece on the floor casts nothing.
  const airborneM = Math.max(0, heightM - piece.radiusM);

  if (airborneM > 0) {
    ctx.beginPath();
    ctx.arc(screenX, screenY, groundRadius, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.pieceShadow;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(screenX, screenY, groundRadius * (1 + airborneM * HEIGHT_SCALE_PER_M), 0, Math.PI * 2);
  ctx.fillStyle = COLORS.piece;
  ctx.fill();
  ctx.strokeStyle = COLORS.pieceOutline;
  ctx.lineWidth = 1;
  ctx.stroke();
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

  // Alternating tile faces make the standard 6 x 6 foam grid legible even
  // with authoring labels disabled.
  for (let column = 0; column < 6; column++) {
    for (let row = 0; row < 6; row++) {
      if ((column + row) % 2 === 0) continue;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.075)';
      ctx.fillRect(left + (column * sizeX) / 6, top + (row * sizeY) / 6, sizeX / 6, sizeY / 6);
    }
  }

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

  // Every fixture is rendered from its collision shape. This keeps physical
  // field geometry and what a driver sees in lockstep.
  ctx.lineWidth = 2;
  for (const body of field.bodies) {
    if (body.shape.kind === 'circle') continue;
    const vertices = worldVertices(body.shape, body.pose.p, body.pose.theta);
    const goal = field.id === 'ftc-decode-2025-26' && body.shape.kind === 'poly';
    const redGoal = goal && vertices.reduce((sum, vertex) => sum + vertex.x, 0) >= 0;
    ctx.fillStyle = goal ? (redGoal ? '#a92036' : '#176bc4') : COLORS.wall;
    ctx.strokeStyle = goal ? '#f3f7fb' : COLORS.wall;
    ctx.beginPath();
    vertices.forEach((vertex, index) => {
      const x = worldToScreenX(camera, vertex.x);
      const y = worldToScreenY(camera, vertex.y);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
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
