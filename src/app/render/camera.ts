/**
 * World-to-screen mapping.
 *
 * The simulation works in metres with +Y pointing up the field; a canvas works
 * in pixels with +Y pointing down. This module is the only place that flip
 * happens, so no drawing code has to remember it.
 */

export interface Camera {
  /** Screen pixel corresponding to world (0, 0). */
  readonly originX: number;
  readonly originY: number;
  readonly pixelsPerMeter: number;
}

/** Fit a field of the given size into the canvas, leaving a proportional margin. */
export function fitCamera(
  canvasWidth: number,
  canvasHeight: number,
  fieldWidthM: number,
  fieldHeightM: number,
  marginFraction = 0.04,
): Camera {
  const usableWidth = canvasWidth * (1 - marginFraction * 2);
  const usableHeight = canvasHeight * (1 - marginFraction * 2);
  const pixelsPerMeter = Math.min(usableWidth / fieldWidthM, usableHeight / fieldHeightM);

  return {
    originX: canvasWidth / 2,
    originY: canvasHeight / 2,
    pixelsPerMeter,
  };
}

export function worldToScreenX(camera: Camera, x: number): number {
  return camera.originX + x * camera.pixelsPerMeter;
}

/** Note the sign flip: world +Y is up the field, screen +Y is down. */
export function worldToScreenY(camera: Camera, y: number): number {
  return camera.originY - y * camera.pixelsPerMeter;
}

export function metersToPixels(camera: Camera, meters: number): number {
  return meters * camera.pixelsPerMeter;
}
