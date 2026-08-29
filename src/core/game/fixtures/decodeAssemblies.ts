/**
 * Canonical DECODE GOAL / classifier / GATE / SECRET TUNNEL assemblies.
 *
 * This is the only place that projects the full-field STEP CAD into the
 * top-down simulator.  The Event FIELD Setup Guide establishes the tape and
 * assembly relationships; the STEP's named Red/Blue Goal, Internal Ramp,
 * Goal Archway, Gate Arm, Gate Stop, Ramp, and Lower Ramp Blocker assemblies
 * establish that these are one connected raised fixture rather than unrelated
 * scoring rectangles.  The renderer reads these parts directly and
 * `decodeCollision.ts` derives static colliders from the same OBB parts.
 *
 * The simulation remains 2D: `elevation` gates interaction through existing
 * vertical spans, while the plan-view envelopes are intentionally compact
 * equivalents of CAD panels/rails rather than a second hand-drawn field.
 */

import type { FieldAssembly, FieldAssemblyPart } from '../../field/fieldTemplate.js';
import { inchesToMeters } from '../../units/convert.js';
import { vec2 } from '../../math/vec2.js';
import { CLASSIFIER, CLASSIFIER_SINGLE_FILE_CLEAR_WIDTH_IN, FIELD, GOAL, ZONES } from './decodeDimensions.js';

export type DecodeAssemblyAlliance = 'red' | 'blue';

/** Stable first body id for the CAD-projected fixture bodies. */
export const DECODE_ASSEMBLY_BODY_ID_BASE = 2100;
/** 4.9 in ARTIFACT plus 0.1 in running clearance seen in dSim. */
export const CLASSIFIER_CHANNEL_WIDTH_IN = CLASSIFIER_SINGLE_FILE_CLEAR_WIDTH_IN.value;

const GOAL_WALL_THICKNESS_IN = 2;
const CLASSIFIER_RAIL_START_Y_IN = 0;
const CLASSIFIER_ARCH_CENTRE_Y_IN = 57;
const CLASSIFIER_ARCH_OPENING_LENGTH_IN = 14;
const CLASSIFIER_RAIL_BALL_CENTRE_HEIGHT_IN = 10;
const CLASSIFIER_GATE_BLOCKING_TOP_IN = CLASSIFIER_RAIL_BALL_CENTRE_HEIGHT_IN + 2.5;
/** Raised classifier balls clear this low threshold; ground balls cannot. */
const GATE_GROUND_GUARD_TOP_IN = 6.5;
/**
 * Ground-level Goal Archway blocker. Its top is deliberately below the
 * 10-in classifier-ball surface minus an ARTIFACT radius, so a contained
 * elevated ball can roll through the real arch while a robot or floor ball
 * cannot use the same top-down footprint as an ordinary entrance.
 */
const GOAL_ARCH_GROUND_GUARD_TOP_IN = 6.5;

/** Red's physical target is at +X, blue's at -X (the CAD's mirrored corners). */
function goalSide(alliance: DecodeAssemblyAlliance): number {
  return alliance === 'red' ? 1 : -1;
}

function obb(
  widthIn: number,
  lengthIn: number,
  xIn: number,
  yIn: number,
  theta = 0,
): FieldAssemblyPart['geometry'] {
  return {
    kind: 'obb',
    widthM: inchesToMeters(widthIn),
    lengthM: inchesToMeters(lengthIn),
    pose: { p: vec2(inchesToMeters(xIn), inchesToMeters(yIn)), theta },
  };
}

function collider(id: number, bottomIn: number, topIn: number, tag?: string): NonNullable<FieldAssemblyPart['collider']> {
  return {
    id,
    span: { bottom: inchesToMeters(bottomIn), top: inchesToMeters(topIn) },
    ...(tag === undefined ? {} : { tag }),
  };
}

/**
 * One mirrored assembly.  Every CAD-projectable panel has one declarative
 * part.  The filled basin/ramp/tunnel surfaces supply visual structure and
 * elevation semantics; only actual rails/panels/gate arms have colliders.
 */
function goalClassifierAssembly(alliance: DecodeAssemblyAlliance, bodyIds: readonly number[]): FieldAssembly {
  const side = goalSide(alliance);
  const half = FIELD.sideIn.value / 2;
  const goalWidth = GOAL.openingWidthIn.value;
  const goalDepth = GOAL.openingDepthIn.value;
  const wall = GOAL_WALL_THICKNESS_IN;
  const channel = CLASSIFIER_CHANNEL_WIDTH_IN;
  const channelCentreX = side * (half - channel / 2);
  const railOffset = channel / 2 + wall / 2;
  const perimeterRailX = channelCentreX + side * railOffset;
  const fieldRailX = channelCentreX - side * railOffset;
  const archMinY = CLASSIFIER_ARCH_CENTRE_Y_IN - CLASSIFIER_ARCH_OPENING_LENGTH_IN / 2;
  const archMaxY = CLASSIFIER_ARCH_CENTRE_Y_IN + CLASSIFIER_ARCH_OPENING_LENGTH_IN / 2;
  const fullTop = GOAL.heightIn.value;
  const lipTop = GOAL.topLipHeightIn.value;

  // The rendered GOAL face is complete. Its full-length low guard keeps every
  // floor object out, while an accepted elevated ARTIFACT follows the open
  // Archway funnel. There is intentionally no short upper panel at the throat:
  // the CAD-equivalent raised guide/rails already contain the ball there, and
  // the former 2D fragment snagged otherwise valid GOAL-to-classifier flow.
  const faceStart = { x: side * (half - goalWidth), y: half };
  const fullFaceEnd = { x: side * half, y: half - goalDepth };
  const fullFaceDx = fullFaceEnd.x - faceStart.x;
  const fullFaceDy = fullFaceEnd.y - faceStart.y;

  const tunnelCentreY = -2 - ZONES.secretTunnelLengthIn.value / 2;
  const goalPrefix = `${alliance}-goal-classifier`;
  const goalSemantic = [`${alliance}-goal`, `${alliance}-ramp`];

  return {
    id: goalPrefix,
    parts: [
      // A filled receiving basin makes the three GOAL panels read as a single
      // physical structure; it is visual/elevated surface only, not a floor
      // collider that would eject a legitimately accepted ARTIFACT.
      {
        id: `${goalPrefix}-basin`,
        geometry: {
          kind: 'polygon',
          vertices: [
            vec2(inchesToMeters(side * half), inchesToMeters(half)),
            vec2(inchesToMeters(side * (half - goalWidth)), inchesToMeters(half)),
            vec2(inchesToMeters(side * half), inchesToMeters(half - goalDepth)),
          ],
        },
        material: 'panel',
        elevation: { bottom: inchesToMeters(0), top: inchesToMeters(lipTop) },
        semanticIds: goalSemantic,
      },
      {
        id: `${goalPrefix}-back-panel`,
        geometry: obb(goalWidth, wall, side * (half - goalWidth / 2), half),
        material: 'metal',
        elevation: { bottom: 0, top: inchesToMeters(fullTop) },
        collider: collider(bodyIds[0]!, 0, fullTop),
        semanticIds: goalSemantic,
      },
      {
        id: `${goalPrefix}-side-panel`,
        geometry: obb(wall, goalDepth, side * half, half - goalDepth / 2),
        material: 'metal',
        elevation: { bottom: 0, top: inchesToMeters(fullTop) },
        collider: collider(bodyIds[1]!, 0, fullTop),
        semanticIds: goalSemantic,
      },
      {
        id: `${goalPrefix}-front-skin`,
        geometry: obb(
          Math.hypot(fullFaceDx, fullFaceDy),
          wall,
          (faceStart.x + fullFaceEnd.x) / 2,
          (faceStart.y + fullFaceEnd.y) / 2,
          Math.atan2(fullFaceDy, fullFaceDx),
        ),
        material: 'metal',
        elevation: { bottom: 0, top: inchesToMeters(lipTop) },
        semanticIds: goalSemantic,
      },
      // The CAD's front lip is solid for a robot or a floor-level ARTIFACT
      // over its entire diagonal length.  Keeping that low physical face
      // separate from the open high funnel gives the 2.5D simulation the same
      // access rule without a normal top-down hole.
      {
        id: `${goalPrefix}-front-ground-guard`,
        geometry: obb(
          Math.hypot(fullFaceDx, fullFaceDy),
          wall,
          (faceStart.x + fullFaceEnd.x) / 2,
          (faceStart.y + fullFaceEnd.y) / 2,
          Math.atan2(fullFaceDy, fullFaceDx),
        ),
        material: 'metal',
        elevation: { bottom: 0, top: inchesToMeters(GOAL_ARCH_GROUND_GUARD_TOP_IN) },
        collider: collider(bodyIds[8]!, 0, GOAL_ARCH_GROUND_GUARD_TOP_IN),
        semanticIds: goalSemantic,
      },
      // The ramp surface connects the GOAL basin, classifier, and tunnel
      // visually, while rails alone are collision bodies.
      {
        id: `${goalPrefix}-ramp-surface`,
        geometry: obb(channel, half - CLASSIFIER_RAIL_START_Y_IN, channelCentreX, (half + CLASSIFIER_RAIL_START_Y_IN) / 2),
        material: 'ramp',
        elevation: { bottom: inchesToMeters(0), top: inchesToMeters(CLASSIFIER_RAIL_BALL_CENTRE_HEIGHT_IN) },
        semanticIds: goalSemantic,
      },
      {
        id: `${goalPrefix}-perimeter-rail`,
        geometry: obb(wall, half - CLASSIFIER_RAIL_START_Y_IN, perimeterRailX, (half + CLASSIFIER_RAIL_START_Y_IN) / 2),
        material: 'metal',
        elevation: { bottom: 0, top: inchesToMeters(fullTop) },
        collider: collider(bodyIds[3]!, 0, fullTop),
        semanticIds: goalSemantic,
      },
      {
        id: `${goalPrefix}-field-rail-lower`,
        geometry: obb(wall, archMinY - CLASSIFIER_RAIL_START_Y_IN, fieldRailX, (archMinY + CLASSIFIER_RAIL_START_Y_IN) / 2),
        material: 'metal',
        elevation: { bottom: 0, top: inchesToMeters(fullTop) },
        collider: collider(bodyIds[4]!, 0, fullTop),
        semanticIds: goalSemantic,
      },
      {
        id: `${goalPrefix}-field-rail-upper`,
        geometry: obb(wall, half - archMaxY, fieldRailX, (half + archMaxY) / 2),
        material: 'metal',
        elevation: { bottom: 0, top: inchesToMeters(fullTop) },
        collider: collider(bodyIds[5]!, 0, fullTop),
        semanticIds: goalSemantic,
      },
      // The Goal Archway is elevated in the real fixture. Project its lower
      // blocking lip into 2D so the rail opening cannot be a ground-level
      // shortcut, while an already-contained classifier ball at 10 in passes
      // over it in the existing vertical-span collision test.
      {
        id: `${goalPrefix}-archway-ground-guard`,
        geometry: obb(wall, archMaxY - archMinY, fieldRailX, (archMinY + archMaxY) / 2),
        material: 'metal',
        elevation: { bottom: 0, top: inchesToMeters(GOAL_ARCH_GROUND_GUARD_TOP_IN) },
        collider: collider(bodyIds[6]!, 0, GOAL_ARCH_GROUND_GUARD_TOP_IN),
        semanticIds: goalSemantic,
      },
      {
        id: `${goalPrefix}-gate`,
        geometry: obb(channel + wall, 1, channelCentreX, 0.5),
        material: 'metal',
        elevation: {
          bottom: 0,
          top: inchesToMeters(Math.max(CLASSIFIER.gateClosedMaxHeightIn.value, CLASSIFIER_GATE_BLOCKING_TOP_IN)),
        },
        collider: collider(bodyIds[7]!, 0, Math.max(CLASSIFIER.gateClosedMaxHeightIn.value, CLASSIFIER_GATE_BLOCKING_TOP_IN), `${alliance}-classifier-gate`),
        semanticIds: [`${alliance}-gate-zone`],
      },
      // The GATE arm itself retracts. The raised ramp still has a low physical
      // threshold at its mouth, so an ordinary floor ball cannot enter the
      // classifier when that arm is open. This is a real collision body, not
      // a coordinate rollback: its top stays below an elevated classifier
      // ARTIFACT's bottom, while it blocks a ground-level ARTIFACT or robot.
      {
        id: `${goalPrefix}-gate-ground-guard`,
        geometry: obb(channel + wall, 1, channelCentreX, 0.5),
        material: 'metal',
        elevation: { bottom: 0, top: inchesToMeters(GATE_GROUND_GUARD_TOP_IN) },
        collider: collider(bodyIds[9]!, 0, GATE_GROUND_GUARD_TOP_IN),
        semanticIds: [`${alliance}-gate-zone`],
      },
      // The SECRET TUNNEL is tape on the field, not a solid corridor.  It is
      // still part of the one visual assembly and carries the semantic route.
      {
        id: `${goalPrefix}-secret-tunnel`,
        geometry: obb(ZONES.secretTunnelWidthIn.value, ZONES.secretTunnelLengthIn.value, side * (half - ZONES.secretTunnelWidthIn.value / 2), tunnelCentreY),
        material: 'alliance-tape',
        elevation: { bottom: 0, top: 0 },
        semanticIds: [`${alliance}-secret-tunnel`],
      },
      {
        id: `${goalPrefix}-depot-strip`,
        geometry: obb(1, ZONES.depotLengthIn.value, side * (half - GOAL.footprintIn.value), half - GOAL.footprintIn.value / 2),
        material: 'tape',
        elevation: { bottom: 0, top: 0 },
        semanticIds: [`${alliance}-depot`],
      },
    ],
  };
}

/**
 * Build both mirrored STEP-CAD assembly projections.  IDs deliberately match
 * the historic collision fixture (2100–2113) and append the two archway
 * guards (2114–2115), two full-front low guards (2116–2117), and two low
 * GATE thresholds (2118–2119), so save/replay determinism and
 * existing field-mechanism tags remain stable through this presentation pass.
 */
export function createDecodeAssemblies(firstBodyId = DECODE_ASSEMBLY_BODY_ID_BASE): readonly FieldAssembly[] {
  return [
    // Keep historical IDs stable while arranging output as two complete
    // mirrored assemblies. This protects saved field-mechanism tags while the
    // visual/collision source becomes canonical.
    goalClassifierAssembly('red', [
      firstBodyId,
      firstBodyId + 1,
      firstBodyId + 2,
      firstBodyId + 6,
      firstBodyId + 7,
      firstBodyId + 8,
      firstBodyId + 14,
      firstBodyId + 12,
      firstBodyId + 16,
      firstBodyId + 18,
    ]),
    goalClassifierAssembly('blue', [
      firstBodyId + 3,
      firstBodyId + 4,
      firstBodyId + 5,
      firstBodyId + 9,
      firstBodyId + 10,
      firstBodyId + 11,
      firstBodyId + 15,
      firstBodyId + 13,
      firstBodyId + 17,
      firstBodyId + 19,
    ]),
  ];
}
