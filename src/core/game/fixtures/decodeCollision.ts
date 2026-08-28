/**
 * Physical-collision classification for the DECODE field.
 *
 * A GameDefinition region answers a rules question; it is never silently made
 * into an obstacle.  This table is deliberately separate from `decodeField`:
 * a tape mark can be essential to a rule and still be completely passable.
 *
 * The Event FIELD Setup Guide is sufficient to distinguish markings from
 * assemblies, but it does not dimension every assembly part.  Consequently an
 * element receives a collision body only when the manual supplies a closed
 * envelope.  The CAD remains the next source for the ramp, gate and tunnel
 * wall sub-parts; guessing those parts would make driving less faithful, not
 * more.
 */

import { createStandardField, type FieldTemplate } from '../../field/fieldTemplate.js';
import { createStaticBody, type EntityId, type RigidBody } from '../../physics/body.js';
import { createObb } from '../../physics/shapes.js';
import { vec2 } from '../../math/vec2.js';
import { inchesToMeters } from '../../units/convert.js';
import { explicitRule, inferred, type Sourced } from '../sourced.js';
import { DECODE_REGIONS, DECODE_ZONES } from './decode.js';
import { CLASSIFIER, FIELD, GOAL } from './decodeDimensions.js';

/** Human-auditable classification; it is not a physics shape type. */
export type DecodeCollisionClass =
  | 'SOLID / COLLIDABLE'
  | 'PASSABLE'
  | 'GAME-LOGIC REGION ONLY';

export interface DecodeFieldElementCollision {
  readonly id: string;
  readonly classification: DecodeCollisionClass;
  /** Why this classification is justified by the authoritative field data. */
  readonly provenance: Sourced<string>;
  /** A body exists only when the supplied sources establish its footprint. */
  readonly hasCollisionBody: boolean;
}

const setupTape = explicitRule(
  'tape marking',
  'Event FIELD Setup Guide §§8–9',
  'The guide describes GATE ZONES and SECRET TUNNEL ZONES as pieces of colored tape, and says tape marks lines and zones throughout the FIELD.',
);

const goalAssembly = explicitRule(
  'physical assembly',
  'Event FIELD Setup Guide §9 step 1',
  'Place each GOAL Assembly onto the FIELD, making sure the GOAL Border Brackets slip over the FIELD perimeter.',
);

const rampAssembly = explicitRule(
  'physical assembly',
  'Event FIELD Setup Guide §9 step 2',
  'Place the Lower RAMP Assembly on the FIELD ... Secure to the TILES ... Secure to the Upper RAMP Assembly.',
);

const cadRequired = inferred(
  'assembly classification is known but a collision footprint is not',
  'The setup guide identifies the physical assembly but supplies no closed top-down footprint for its rails, gate panel, or tunnel-side walls. The full-field CAD is the dimensional authority.',
);

/**
 * Every DECODE object that could otherwise be mistaken for an obstacle.
 *
 * `hasCollisionBody` intentionally stays false for solid assemblies whose
 * component outline is CAD-only.  A broad rectangle copied from a scoring
 * region would incorrectly block the field and would violate this table's
 * purpose.
 */
export const DECODE_FIELD_COLLISION_CLASSIFICATION: readonly DecodeFieldElementCollision[] = [
  {
    id: 'perimeter',
    classification: 'SOLID / COLLIDABLE',
    provenance: explicitRule(
      'perimeter wall',
      'Competition Manual §9.1',
      'The 144 in. by 144 in. FIELD is bounded by the inside surface of the walls of the FIELD perimeter.',
    ),
    hasCollisionBody: true,
  },
  ...(['red', 'blue'] as const).flatMap((alliance) => [
    {
      id: `${alliance}-goal-shell`,
      classification: 'SOLID / COLLIDABLE' as const,
      provenance: goalAssembly,
      hasCollisionBody: true,
    },
    {
      id: `${alliance}-goal-opening`,
      classification: 'PASSABLE' as const,
      provenance: explicitRule(
        'goal opening',
        'Competition Manual §9.7',
        'The opening of the GOAL is approximately 26.5 in. wide and 18.3 in. deep.',
      ),
      hasCollisionBody: false,
    },
    {
      id: `${alliance}-ramp-assembly`,
      classification: 'SOLID / COLLIDABLE' as const,
      provenance: rampAssembly,
      // The raised classifier channel is the documented portion of the ramp
      // whose envelope is represented by `classifierBody` below.
      hasCollisionBody: true,
    },
    {
      id: `${alliance}-gate`,
      classification: 'SOLID / COLLIDABLE' as const,
      provenance: cadRequired,
      hasCollisionBody: true,
    },
    {
      id: `${alliance}-gate-zone`,
      classification: 'PASSABLE' as const,
      provenance: setupTape,
      hasCollisionBody: false,
    },
    {
      id: `${alliance}-secret-tunnel`,
      classification: 'PASSABLE' as const,
      provenance: explicitRule(
        'taped SECRET TUNNEL ZONE',
        'Competition Manual §9.3',
        'SECRET TUNNEL ZONE: an approximately 46.5 in. long by approximately 6.125 in. wide infinitely tall volume',
      ),
      // The manual calls this a taped volume, not a physical tunnel wall.
      // Directionality is enforced by the conveyor state, not collision.
      hasCollisionBody: false,
    },
    {
      id: `${alliance}-base-zone`,
      classification: 'GAME-LOGIC REGION ONLY' as const,
      provenance: setupTape,
      hasCollisionBody: false,
    },
    {
      id: `${alliance}-loading-zone`,
      classification: 'GAME-LOGIC REGION ONLY' as const,
      provenance: setupTape,
      hasCollisionBody: false,
    },
    {
      id: `${alliance}-depot`,
      classification: 'GAME-LOGIC REGION ONLY' as const,
      provenance: setupTape,
      hasCollisionBody: false,
    },
    {
      id: `${alliance}-ramp-region`,
      classification: 'GAME-LOGIC REGION ONLY' as const,
      provenance: inferred(
        'field mechanism occupancy',
        'The RAMP region represents its classifier queue for the conveyor/rules layer. It is not the physical outline of the RAMP assembly.',
      ),
      hasCollisionBody: false,
    },
  ]),
  {
    id: 'audience-launch-zone',
    classification: 'GAME-LOGIC REGION ONLY',
    provenance: setupTape,
    hasCollisionBody: false,
  },
  {
    id: 'goal-launch-zone',
    classification: 'GAME-LOGIC REGION ONLY',
    provenance: setupTape,
    hasCollisionBody: false,
  },
  {
    id: 'spike-marks',
    classification: 'GAME-LOGIC REGION ONLY',
    provenance: setupTape,
    hasCollisionBody: false,
  },
  {
    id: 'obelisk',
    classification: 'SOLID / COLLIDABLE',
    provenance: inferred(
      'outside the playing field perimeter',
      'The Competition Manual places the OBELISK just outside the FIELD perimeter. The perimeter already prevents a robot or artifact on the playing surface from reaching it, so no duplicate interior body is made.',
    ),
    hasCollisionBody: false,
  },
];

const GOAL_BODY_ID_BASE = 1100;

/**
 * Classifier channel width, traced from the supplied CAD/dSim top-down field
 * reference.  The manual establishes that it is a physical RAMP assembly but
 * does not print a plan-view channel width, so this remains visibly inferred.
 */
const CLASSIFIER_CHANNEL_WIDTH_IN = 6;
/**
 * The physical rail reaches the gate arm.  The scored/queue region begins two
 * inches up the ramp, but ending the rail there leaves a floor-level corner
 * beside the gate that a 5 in ARTIFACT can roll around.  This is a continuous
 * channel wall, not an extra scoring or parking surface.
 */
const CLASSIFIER_RAIL_START_Y_IN = 0;
/**
 * The sole physical arch from the raised GOAL basin into the classifier rail.
 * The centre follows dSim's observed hand-off; 14 in gives a 5 in ARTIFACT
 * clearance through the two-in rail walls. The rail remains closed elsewhere.
 */
const CLASSIFIER_ARCH_CENTRE_Y_IN = 57;
const CLASSIFIER_ARCH_OPENING_LENGTH_IN = 14;

/**
 * GOALS and classifier assemblies are cross-court from their drive-team side:
 * blue far-left, red far-right. `decodeField.ts` keeps this separate from the
 * drive-team/alliance-area orientation.
 */
function goalSide(alliance: 'red' | 'blue'): number {
  return alliance === 'red' ? 1 : -1;
}

/**
 * Wall thickness for the GOAL's own two backstop legs, inches.
 *
 * Presentational, like `TUNNEL_RAIL_THICKNESS_IN`: the manual gives the
 * assembly's outer footprint (§9's opening width/depth) but not a wall
 * material thickness, and any positive thickness registers the contact a
 * robot needs to be kept out of the corner.
 */
const GOAL_WALL_THICKNESS_IN = 2;
/** Normal ARTIFACT centre on the raised classifier rail, per dSim/CAD audit. */
const CLASSIFIER_RAIL_BALL_CENTRE_HEIGHT_IN = 10;
/** A 5 in ARTIFACT must meet the closed arm across the full normal rail span. */
const CLASSIFIER_GATE_BLOCKING_TOP_IN = CLASSIFIER_RAIL_BALL_CENTRE_HEIGHT_IN + 2.5;
/**
 * The GOAL's diagonal front closes against the classifier arch.  The arch is
 * the sole physical outlet from the receiving basin: widening it creates a
 * second field-facing escape path for accepted ARTIFACTS.
 */
// One inch is the rail's material half-thickness: this makes the diagonal
// physically meet the inner classifier rail, rather than stopping at the
// abstract six-inch channel boundary and leaving a one-inch seam.
const GOAL_CLASSIFIER_ARCH_CLEARANCE_IN = GOAL_WALL_THICKNESS_IN / 2;

/**
 * The GOAL opening is a right triangle in the far corner. Its two legs and its
 * diagonal field-facing face are real walls: robots and loose floor balls stay
 * out, while a valid shot clears their top lip and then lands in the hollow
 * basin.
 *
 * These used to be one filled triangular body from the floor to the full
 * assembly height. That is right for blocking a robot, but wrong the moment
 * an ARTIFACT can fly *over* the opening lip and needs to come to rest
 * *inside* the footprint: a solid interior has no "inside" for it to rest
 * in — the piece would already be in deep collision with the fill the
 * instant its 2D position crossed into the triangle, and the resolver would
 * shove it back out along whatever face it entered. Three thin boundary walls,
 * not a filled triangle, leave that interior genuinely usable after a shot.
 */
function goalWallBodies(alliance: 'red' | 'blue', firstId: EntityId): readonly RigidBody[] {
  const sign = goalSide(alliance);
  const half = FIELD.sideIn.value / 2;
  const openingWidthIn = GOAL.openingWidthIn.value;
  const openingDepthIn = GOAL.openingDepthIn.value;
  const thicknessM = inchesToMeters(GOAL_WALL_THICKNESS_IN);
  const fullSpan = { bottom: 0, top: inchesToMeters(GOAL.heightIn.value) };
  // The face is the 38.75 in lip. A valid shot crosses above it and descends
  // into the hollow basin; once it is at floor level this remains a real wall.
  const openingSpan = { bottom: 0, top: inchesToMeters(GOAL.topLipHeightIn.value) };

  // The back leg runs along the field's own back perimeter (y = half),
  // spanning the opening's width in x.
  const backLeg = createStaticBody({
    id: firstId,
    shape: createObb(inchesToMeters(openingWidthIn), thicknessM),
    span: fullSpan,
    pose: {
      p: {
        x: inchesToMeters(sign * (half - openingWidthIn / 2)),
        y: inchesToMeters(half),
      },
      theta: 0,
    },
  });

  // The side leg runs along the field's own side perimeter (x = sign*half),
  // spanning the opening's depth in y.
  const sideLeg = createStaticBody({
    id: firstId + 1,
    shape: createObb(thicknessM, inchesToMeters(openingDepthIn)),
    span: fullSpan,
    pose: {
      p: {
        x: inchesToMeters(sign * half),
        y: inchesToMeters(half - openingDepthIn / 2),
      },
      theta: 0,
    },
  });

  const faceStart = vec2(
    inchesToMeters(sign * (half - openingWidthIn)),
    inchesToMeters(half),
  );
  // The six-inch CLASSIFIER channel replaces only the side-wall end of the
  // GOAL face. The diagonal closes everywhere else, leaving one direct arch
  // into the classifier rather than a broad field-facing basin exit.
  const channelInnerXIn = sign * (half - CLASSIFIER_CHANNEL_WIDTH_IN - GOAL_CLASSIFIER_ARCH_CLEARANCE_IN);
  const originalFaceEndYIn = half - openingDepthIn;
  const faceFraction =
    Math.abs(channelInnerXIn - sign * (half - openingWidthIn)) / openingWidthIn;
  const faceEnd = vec2(
    inchesToMeters(channelInnerXIn),
    inchesToMeters(half + faceFraction * (originalFaceEndYIn - half)),
  );
  const faceDx = faceEnd.x - faceStart.x;
  const faceDy = faceEnd.y - faceStart.y;
  const face = createStaticBody({
    id: firstId + 2,
    shape: createObb(Math.hypot(faceDx, faceDy), thicknessM),
    span: openingSpan,
    pose: {
      p: vec2((faceStart.x + faceEnd.x) / 2, (faceStart.y + faceEnd.y) / 2),
      theta: Math.atan2(faceDy, faceDx),
    },
  });

  return [backLeg, sideLeg, face];
}

/**
 * Rails bound the physical classifier lane. Its inner rail has one raised
 * arch from the GOAL basin; it remains solid everywhere else so ground balls
 * cannot enter the channel sideways.
 */
function classifierRailBodies(alliance: 'red' | 'blue', firstId: EntityId): readonly RigidBody[] {
  const sign = goalSide(alliance);
  const half = FIELD.sideIn.value / 2;
  const widthIn = CLASSIFIER_CHANNEL_WIDTH_IN;
  const lengthIn = half - CLASSIFIER_RAIL_START_Y_IN;
  const thicknessM = inchesToMeters(GOAL_WALL_THICKNESS_IN);
  const centerX = inchesToMeters(sign * (half - widthIn / 2));
  const offsetM = inchesToMeters(widthIn) / 2 + thicknessM / 2;
  const span = { bottom: 0, top: inchesToMeters(GOAL.heightIn.value) };
  const rail = (id: EntityId, x: number, startYIn: number, endYIn: number): RigidBody =>
    createStaticBody({
      id,
      shape: createObb(thicknessM, inchesToMeters(endYIn - startYIn)),
      span,
      pose: { p: vec2(x, inchesToMeters((startYIn + endYIn) / 2)), theta: 0 },
    });
  const innerX = centerX - offsetM;
  const outerX = centerX + offsetM;
  const archMinYIn = CLASSIFIER_ARCH_CENTRE_Y_IN - CLASSIFIER_ARCH_OPENING_LENGTH_IN / 2;
  const archMaxYIn = CLASSIFIER_ARCH_CENTRE_Y_IN + CLASSIFIER_ARCH_OPENING_LENGTH_IN / 2;
  return [
    rail(firstId, outerX, CLASSIFIER_RAIL_START_Y_IN, CLASSIFIER_RAIL_START_Y_IN + lengthIn),
    rail(firstId + 1, innerX, CLASSIFIER_RAIL_START_Y_IN, archMinYIn),
    rail(firstId + 2, innerX, archMaxYIn, CLASSIFIER_RAIL_START_Y_IN + lengthIn),
  ];
}

/** A live arm across the lane mouth. The conveyor retracts its semantic tag. */
function gateBody(alliance: 'red' | 'blue', id: EntityId): RigidBody {
  const sign = goalSide(alliance);
  const half = FIELD.sideIn.value / 2;
  return createStaticBody({
    id,
    shape: createObb(
      inchesToMeters(CLASSIFIER_CHANNEL_WIDTH_IN + GOAL_WALL_THICKNESS_IN),
      inchesToMeters(1),
    ),
    span: {
      bottom: 0,
      top: inchesToMeters(Math.max(CLASSIFIER.gateClosedMaxHeightIn.value, CLASSIFIER_GATE_BLOCKING_TOP_IN)),
    },
    pose: {
      p: vec2(
        inchesToMeters(sign * (half - CLASSIFIER_CHANNEL_WIDTH_IN / 2)),
        inchesToMeters(0.5),
      ),
      theta: 0,
    },
  });
}

/** Build DECODE's generic field plus physical GOAL, lane rails, and live gates. */
export function createDecodeField(firstEntityId: EntityId = 1000): FieldTemplate {
  const standard = createStandardField(firstEntityId);
  const redGoal = goalWallBodies('red', firstEntityId + GOAL_BODY_ID_BASE);
  const blueGoal = goalWallBodies('blue', firstEntityId + GOAL_BODY_ID_BASE + 3);
  const redRails = classifierRailBodies('red', firstEntityId + GOAL_BODY_ID_BASE + 6);
  const blueRails = classifierRailBodies('blue', firstEntityId + GOAL_BODY_ID_BASE + 9);
  const redGate = gateBody('red', firstEntityId + GOAL_BODY_ID_BASE + 12);
  const blueGate = gateBody('blue', firstEntityId + GOAL_BODY_ID_BASE + 13);
  return {
    ...standard,
    id: 'ftc-decode-2025-26',
    name: 'FTC DECODE Field',
    bodies: [
      ...standard.bodies,
      ...redGoal,
      ...blueGoal,
      ...redRails,
      ...blueRails,
      redGate,
      blueGate,
    ],
    colliderTags: {
      'red-classifier-gate': [redGate.id],
      'blue-classifier-gate': [blueGate.id],
    },
  };
}

/** Region ids are rule destinations, never static collision element ids. */
export const DECODE_GAME_LOGIC_REGION_IDS = new Set<string>([
  DECODE_REGIONS.redGoal,
  DECODE_REGIONS.blueGoal,
  DECODE_REGIONS.redRamp,
  DECODE_REGIONS.blueRamp,
  DECODE_REGIONS.redDepot,
  DECODE_REGIONS.blueDepot,
  ...Object.values(DECODE_ZONES),
]);
