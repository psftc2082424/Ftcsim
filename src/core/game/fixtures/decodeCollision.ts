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
import { inchesToMeters } from '../../units/convert.js';
import { explicitRule, inferred, type Sourced } from '../sourced.js';
import { DECODE_REGIONS, DECODE_ZONES } from './decode.js';
import { FIELD, GOAL } from './decodeDimensions.js';

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
      hasCollisionBody: false,
    },
    {
      id: `${alliance}-gate`,
      classification: 'SOLID / COLLIDABLE' as const,
      provenance: cadRequired,
      hasCollisionBody: false,
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
      provenance: setupTape,
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

function goalAssemblyCenter(alliance: 'red' | 'blue') {
  // These anchors come from the GOAL's border brackets engaging the perimeter,
  // not from the scoring region built at the same position.  Keeping this
  // calculation here makes the one-way dependency visible: rules may use this
  // physical placement, but collision never reads a GameDefinition region.
  const sign = alliance === 'red' ? -1 : 1;
  const centerIn = FIELD.sideIn.value / 2 - GOAL.footprintIn.value / 2;
  return { x: inchesToMeters(sign * centerIn), y: inchesToMeters(centerIn) };
}

/**
 * Three collision rectangles form the goal's back and side shell.  The open
 * front is intentionally body-free: its dimensions are the manual's opening
 * dimensions, not a score-region shortcut.  The thin side walls and back
 * depth are the exact difference between the published outer footprint and
 * opening envelope; their front-facing orientation follows setup-guide §9's
 * assembly image and is recorded as an inference.
 */
function goalShellBodies(alliance: 'red' | 'blue', firstId: EntityId): readonly RigidBody[] {
  const center = goalAssemblyCenter(alliance);
  const outerM = inchesToMeters(GOAL.footprintIn.value);
  const openingWidthM = inchesToMeters(GOAL.openingWidthIn.value);
  const openingDepthM = inchesToMeters(GOAL.openingDepthIn.value);
  const sideThicknessM = (outerM - openingWidthM) / 2;
  const backDepthM = outerM - openingDepthM;
  const frontEdgeY = center.y - outerM / 2;
  const openingCenterY = frontEdgeY + openingDepthM / 2;
  const backCenterY = frontEdgeY + openingDepthM + backDepthM / 2;
  const span = { bottom: 0, top: inchesToMeters(GOAL.heightIn.value) };

  return [
    createStaticBody({
      id: firstId,
      shape: createObb(sideThicknessM, openingDepthM),
      span,
      pose: { p: { x: center.x - openingWidthM / 2 - sideThicknessM / 2, y: openingCenterY }, theta: 0 },
    }),
    createStaticBody({
      id: firstId + 1,
      shape: createObb(sideThicknessM, openingDepthM),
      span,
      pose: { p: { x: center.x + openingWidthM / 2 + sideThicknessM / 2, y: openingCenterY }, theta: 0 },
    }),
    createStaticBody({
      id: firstId + 2,
      shape: createObb(outerM, backDepthM),
      span,
      pose: { p: { x: center.x, y: backCenterY }, theta: 0 },
    }),
  ];
}

/** Build DECODE's generic field plus only its supported collision shells. */
export function createDecodeField(firstEntityId: EntityId = 1000): FieldTemplate {
  const standard = createStandardField(firstEntityId);
  return {
    ...standard,
    id: 'ftc-decode-2025-26',
    name: 'FTC DECODE Field',
    bodies: [
      ...standard.bodies,
      ...goalShellBodies('red', firstEntityId + GOAL_BODY_ID_BASE),
      ...goalShellBodies('blue', firstEntityId + GOAL_BODY_ID_BASE + 3),
    ],
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
