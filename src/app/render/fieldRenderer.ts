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
  tunnelRail: '#d9a441',
  axis: '#2f3d4d',
  robotBody: '#3d7dca',
  robotOutline: '#9ecbff',
  robotFront: '#ffd166',
  velocity: '#5ce0a0',
  piecePurple: '#8b3fd1',
  piecePurpleOutline: '#d9baf5',
  pieceGreen: '#3fae55',
  pieceGreenOutline: '#bdeecb',
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
  /**
   * Which of the game's own conveyors (`game/conveyor.ts`) are open right now.
   *
   * Optional read-only presentation state: a season with no GATE-like element
   * simply never populates it, and the renderer still has no idea what any id
   * means beyond "does this one draw as open".
   */
  readonly openConveyorIds?: ReadonlySet<string> | undefined;
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

  // Every piece draws from its own real position and height — a shot is an
  // ordinary simulated piece the instant it leaves the shooter
  // (`sim/simWorld.ts`'s `launchPieceTowards`), not a separate cosmetic path.
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
  const openConveyorIds = overlay.openConveyorIds ?? EMPTY_OPEN_SET;
  for (const shaped of [...overlay.regions, ...overlay.zones]) {
    const kind = presentationKind(shaped.id);
    // The raised RAMP is rendered from its physical fixture body. The GOAL is
    // different: its rule region is the exact triangular open basin, so using
    // it for the filled plan view is both more legible and faithful to the
    // physical outline. Generic structure rectangles remain hidden.
    if (decodePresentation && kind === 'structure' && shaped.id.endsWith('-ramp')) continue;
    const allianceColor = shaped.id.startsWith('red-') ? COLORS.redEdge : shaped.id.startsWith('blue-') ? COLORS.blueEdge : COLORS.regionEdge;
    ctx.fillStyle = kind === 'goal' ? (shaped.id.startsWith('red-') ? '#4f1414' : '#14235a') : COLORS.regionFill;
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
        drawGate(ctx, camera, shaped, allianceColor, isConveyorOpenFor(shaped.id, openConveyorIds));
        continue;
      }

      if (decodePresentation && shaped.id.includes('secret-tunnel')) {
        drawTunnel(ctx, camera, shaped, allianceColor);
        continue;
      }

      if (decodePresentation && shaped.id.endsWith('-depot')) {
        drawDepot(ctx, camera, shaped.id, overlay);
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

const EMPTY_OPEN_SET: ReadonlySet<string> = new Set();

/**
 * Does the GATE beside this zone currently let CLASSIFIED ARTIFACTS out?
 *
 * The conveyor that owns a `<alliance>-gate-zone` is named `<alliance>-classifier`
 * (`decode.ts`'s `DECODE_CONVEYORS`) — a naming convention local to this one
 * season's presentation, the same way the rest of `decodePresentation` already
 * is. It costs nothing to be wrong: a season with no matching conveyor id
 * simply never appears in `openConveyorIds` and the gate draws closed.
 */
function isConveyorOpenFor(gateZoneId: string, openConveyorIds: ReadonlySet<string>): boolean {
  return openConveyorIds.has(gateZoneId.replace('-gate-zone', '-classifier'));
}

/**
 * The GATE: a literal arm across the low end of the CLASSIFIER, not a scoring
 * rectangle. Its state is read straight from `PieceConveyors.isOpen`, the same
 * fact that governs whether CLASSIFIED ARTIFACTS actually drain — so the arm
 * shown is never out of step with what the RAMP is really doing.
 *
 * Closed: solid, spanning the ROBOT-pushed width, exactly like the manual's
 * "closed by gravity" resting state. Open: swung clear, drawn thin and pale so
 * the passage it just made reads as open at a glance.
 */
function drawGate(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  shaped: FieldRegion | FieldZone,
  allianceColor: string,
  isOpen: boolean,
): void {
  if (shaped.shape.kind !== 'poly') return;
  const vertices = shaped.shape.vertices;
  if (vertices.length === 0) return;

  const minX = Math.min(...vertices.map((vertex) => vertex.x));
  const maxX = Math.max(...vertices.map((vertex) => vertex.x));
  const minY = Math.min(...vertices.map((vertex) => vertex.y));
  const maxY = Math.max(...vertices.map((vertex) => vertex.y));
  const centerY = (minY + maxY) / 2;
  const fieldSideX = Math.abs(minX) > Math.abs(maxX) ? minX : maxX;
  const side = Math.sign(fieldSideX);
  const classifierWidthM = inchesToMeters(6);
  const handleLengthM = inchesToMeters(2.5);
  // A lifted lever foreshortens in top-down view. The state remains a direct
  // read of the conveyor gate, not a renderer-owned animation.
  const projection = isOpen ? 0.22 : 1;

  ctx.save();
  ctx.strokeStyle = allianceColor;
  ctx.lineWidth = 2;
  // The official GATE ZONE is two parallel colored tape lines, not a filled
  // rectangle. Its bounds already encode the 10 in by 2.75 in marking.
  for (const y of [minY, maxY]) {
    ctx.beginPath();
    ctx.moveTo(worldToScreenX(camera, minX), worldToScreenY(camera, y));
    ctx.lineTo(worldToScreenX(camera, maxX), worldToScreenY(camera, y));
    ctx.stroke();
  }

  // Hinged at the classifier edge: a long paddle covers the channel and a
  // short handle reaches out into the field for the robot to push.
  ctx.globalAlpha = isOpen ? 0.45 : 1;
  ctx.strokeStyle = isOpen ? '#63c174' : COLORS.wall;
  ctx.lineWidth = isOpen ? 2 : 5;
  ctx.beginPath();
  ctx.moveTo(worldToScreenX(camera, fieldSideX), worldToScreenY(camera, centerY));
  ctx.lineTo(
    worldToScreenX(camera, fieldSideX + side * classifierWidthM * projection),
    worldToScreenY(camera, centerY),
  );
  ctx.stroke();
  ctx.strokeStyle = COLORS.wall;
  ctx.lineWidth = isOpen ? 2 : 5;
  ctx.beginPath();
  ctx.moveTo(worldToScreenX(camera, fieldSideX), worldToScreenY(camera, centerY));
  ctx.lineTo(
    worldToScreenX(camera, fieldSideX - side * handleLengthM * projection),
    worldToScreenY(camera, centerY),
  );
  ctx.stroke();
  ctx.restore();
}

/** Draw the marked, passable SECRET TUNNEL floor below a classifier. */
function drawTunnel(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  shaped: FieldRegion | FieldZone,
  allianceColor: string,
): void {
  if (shaped.shape.kind !== 'poly') return;
  const vertices = shaped.shape.vertices;
  if (vertices.length === 0) return;

  const minX = Math.min(...vertices.map((vertex) => vertex.x));
  const maxX = Math.max(...vertices.map((vertex) => vertex.x));
  const minY = Math.min(...vertices.map((vertex) => vertex.y));
  const maxY = Math.max(...vertices.map((vertex) => vertex.y));
  const fieldSideX = Math.abs(minX) < Math.abs(maxX) ? minX : maxX;

  ctx.save();
  ctx.fillStyle = allianceColor;
  ctx.globalAlpha = 0.16;
  ctx.fillRect(
    worldToScreenX(camera, minX),
    worldToScreenY(camera, maxY),
    metersToPixels(camera, maxX - minX),
    metersToPixels(camera, maxY - minY),
  );
  ctx.globalAlpha = 1;
  ctx.strokeStyle = allianceColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(worldToScreenX(camera, fieldSideX), worldToScreenY(camera, minY));
  ctx.lineTo(worldToScreenX(camera, fieldSideX), worldToScreenY(camera, maxY));
  ctx.stroke();
  ctx.restore();
}

/** DEPOT is a white launch-line segment along the GOAL face, not an area fill. */
function drawDepot(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  depotId: string,
  overlay: FieldOverlay,
): void {
  const goalId = depotId.replace('-depot', '-goal');
  const goal = overlay.regions.find((region) => region.id === goalId);
  if (goal?.shape.kind !== 'poly' || goal.shape.vertices.length !== 3) return;

  const vertices = goal.shape.vertices;
  const farCandidates = vertices.filter((vertex) =>
    Math.abs(vertex.y - Math.max(...vertices.map((candidate) => candidate.y))) < 1e-9,
  );
  const far = farCandidates.reduce((best, candidate) =>
    Math.abs(candidate.x) < Math.abs(best.x) ? candidate : best,
  );
  const side = vertices.find(
    (vertex) => Math.abs(vertex.x) > Math.abs(far.x) + 1e-9 && vertex.y < far.y - 1e-9,
  );
  if (side === undefined) return;

  const faceWidthM = Math.abs(side.x - far.x);
  const classifierWidthM = inchesToMeters(6);
  const fraction = Math.max(0, 1 - classifierWidthM / faceWidthM);
  const end = {
    x: far.x + (side.x - far.x) * fraction,
    y: far.y + (side.y - far.y) * fraction,
  };

  ctx.save();
  ctx.strokeStyle = '#f4f7fb';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(worldToScreenX(camera, far.x), worldToScreenY(camera, far.y));
  ctx.lineTo(worldToScreenX(camera, end.x), worldToScreenY(camera, end.y));
  ctx.stroke();
  ctx.restore();
}

/** Fill/outline pair for a game piece, by its type id. Unknown types fall back
 * to the purple pair rather than a warning colour: an unrecognised type is
 * still a real piece and should not look like an error. */
function pieceColors(pieceType: string): { fill: string; outline: string } {
  if (pieceType === 'G') return { fill: COLORS.pieceGreen, outline: COLORS.pieceGreenOutline };
  return { fill: COLORS.piecePurple, outline: COLORS.piecePurpleOutline };
}

/** Presentation-only classification; game rules and collision never read this. */
function presentationKind(id: string): 'goal' | 'structure' | 'gate' | 'tape' | 'zone' {
  if (id.endsWith('-goal')) return 'goal';
  // The GATE ZONE has no collision body of its own — unlike the RAMP and the
  // TUNNEL, which now render from real fixture geometry (`classifierBody`,
  // `tunnelRailBodies`) — so it must stay off the "skip, a real body already
  // draws this" path below and keep going to `drawGate`.
  if (id.includes('gate-zone')) return 'gate';
  if (id.endsWith('-ramp') || id.includes('tunnel') || id.includes('gate')) return 'structure';
  if (id.includes('spike') || id.includes('launch') || id.includes('base') || id.includes('loading') || id.includes('depot')) return 'tape';
  return 'zone';
}

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

  const { fill, outline } = pieceColors(piece.pieceType);
  ctx.beginPath();
  // Top-down elevation changes gameplay access, never apparent ball diameter.
  ctx.arc(screenX, screenY, groundRadius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = outline;
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
    const minHalfExtentM =
      body.shape.kind === 'obb' ? Math.min(body.shape.halfExtents.x, body.shape.halfExtents.y) : null;
    // A SECRET TUNNEL rail is a thin OBB — `tunnelRailBodies`' rails are ~1 in
    // thick, far slimmer than the 6 in classifier channel or the 12 in
    // perimeter — so it reads apart from an ordinary wall rather than as more
    // of one. Drawn as a neutral colour: the tunnel is shared floor, not
    // territory either alliance owns outright.
    const tunnelRail =
      field.id === 'ftc-decode-2025-26' && minHalfExtentM !== null && minHalfExtentM < inchesToMeters(0.75);
    // The GOAL's own two backstop legs (`goalWallBodies`) are thicker than a
    // tunnel rail (~2 in) but far thinner than the 6 in classifier channel or
    // the 12 in perimeter, so the same thickness-banding trick that finds a
    // tunnel rail finds these too.
    const goal =
      field.id === 'ftc-decode-2025-26' &&
      !tunnelRail &&
      minHalfExtentM !== null &&
      minHalfExtentM < inchesToMeters(2.5);
    // A field body carries no alliance tag, only geometry, so colour is
    // guessed from which side of the field it sits on. DECODE's GOALS are
    // cross-court: red is +X and blue is -X.
    const redGoal = goal && body.pose.p.x > 0;
    ctx.fillStyle = goal ? (redGoal ? '#a92036' : '#176bc4') : tunnelRail ? COLORS.tunnelRail : COLORS.wall;
    ctx.strokeStyle = goal ? '#f3f7fb' : tunnelRail ? COLORS.tunnelRail : COLORS.wall;
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
