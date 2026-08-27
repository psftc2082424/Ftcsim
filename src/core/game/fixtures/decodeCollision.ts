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
import { createObb, createPoly } from '../../physics/shapes.js';
import { inchesToMeters } from '../../units/convert.js';
import { explicitRule, inferred, type Sourced } from '../sourced.js';
import { DECODE_REGIONS, DECODE_ZONES } from './decode.js';
import { DECODE_FIELD_ZONES } from './decodeField.js';
import { CLASSIFIER, FIELD, GOAL, ZONES } from './decodeDimensions.js';

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
      classification: 'SOLID / COLLIDABLE' as const,
      provenance: explicitRule(
        'side-railed corridor',
        'Competition Manual §9.3',
        'SECRET TUNNEL ZONE: an approximately 46.5 in. long by approximately 6.125 in. wide infinitely tall volume',
      ),
      // The corridor's footprint is sourced (§9.3) and already placed by
      // `decodeField.ts`; only the rail height is a presentational choice
      // (`tunnelRailBodies`), so this is not the CAD-only case the other
      // `false` entries in this table are.
      hasCollisionBody: true,
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
const CLASSIFIER_GATE_Y_IN = 2;

/**
 * A GOAL sits on the *same* side as its own alliance, not cross-court from it.
 *
 * Red occupies -X and blue +X (`decodeField.ts`'s `SIDE`, from G402's TILE
 * columns). The GOAL, RAMP and GATE are one physical CLASSIFIER assembly, so
 * they share that sign — this used to disagree with `SIDE` and put an
 * alliance's own GATE and its own GOAL/RAMP in opposite corners of the field.
 */
function goalSide(alliance: 'red' | 'blue'): number {
  return alliance === 'red' ? -1 : 1;
}

/**
 * The GOAL opening is a right triangle in the far corner.  Its two legs are
 * the manual's top-view opening dimensions; the diagonal is the field-facing
 * goal face.  This is a physical assembly outline, not a scoring region.
 */
function goalBody(alliance: 'red' | 'blue', id: EntityId): RigidBody {
  const sign = goalSide(alliance);
  const half = FIELD.sideIn.value / 2;
  const far = { x: inchesToMeters(sign * (half - GOAL.openingWidthIn.value)), y: inchesToMeters(half) };
  const side = { x: inchesToMeters(sign * half), y: inchesToMeters(half - GOAL.openingDepthIn.value) };
  const corner = { x: inchesToMeters(sign * half), y: inchesToMeters(half) };
  const span = { bottom: 0, top: inchesToMeters(GOAL.heightIn.value) };
  const vertices = sign > 0 ? [far, side, corner] : [far, corner, side];
  return createStaticBody({ id, shape: createPoly(vertices), span });
}

/** The raised RAMP occupies its side-wall channel from the GATE to the far wall. */
function classifierBody(alliance: 'red' | 'blue', id: EntityId): RigidBody {
  const sign = goalSide(alliance);
  const half = FIELD.sideIn.value / 2;
  const widthIn = CLASSIFIER_CHANNEL_WIDTH_IN;
  const lengthIn = half - CLASSIFIER_GATE_Y_IN;
  return createStaticBody({
    id,
    shape: createObb(inchesToMeters(widthIn), inchesToMeters(lengthIn)),
    // A 4.9 in ARTIFACT can travel through the tunnel opening below this raised
    // structure, while a robot intersects the assembly. The clearance is the
    // documented maximum closed GATE contact height.
    span: {
      bottom: inchesToMeters(CLASSIFIER.gateClosedMaxHeightIn.value),
      top: inchesToMeters(GOAL.heightIn.value),
    },
    pose: {
      p: {
        x: inchesToMeters(sign * (half - widthIn / 2)),
        y: inchesToMeters(CLASSIFIER_GATE_Y_IN + lengthIn / 2),
      },
      theta: 0,
    },
  });
}

/**
 * Curb height for a SECRET TUNNEL's side rails, inches.
 *
 * The manual sources the corridor's footprint (§9.3, `ZONES.secretTunnelWidthIn`
 * / `secretTunnelLengthIn`) but not a wall height, because the real ALLIANCE
 * colored tape marking it has none — it is floor tape, not a kerb. A rail tall
 * enough to register a contact (any positive height, since every body here
 * starts at the floor) is what turns a marked-but-open floor rectangle into a
 * corridor an ARTIFACT can be kept inside and a ROBOT must enter end-on rather
 * than drive across sideways. The exact height is otherwise unconstrained, so
 * it is kept short and presentational rather than picked to look like a wall.
 */
const TUNNEL_RAIL_HEIGHT_IN = 2;
const TUNNEL_RAIL_THICKNESS_IN = 1;

/**
 * Two side rails flanking a SECRET TUNNEL ZONE, from its already-placed
 * footprint (`decodeField.ts`) rather than from a second copy of the seam
 * arithmetic that placed it.
 *
 * The rails run the corridor's length and sit just outside its sourced width,
 * so nothing about their span narrows the width an ARTIFACT actually has to
 * travel through — they bound the corridor, they do not intrude into it.
 */
function tunnelRailBodies(zoneId: string, firstId: EntityId): readonly RigidBody[] {
  const zone = DECODE_FIELD_ZONES.find((candidate) => candidate.id === zoneId);
  if (zone === undefined) throw new Error(`DECODE collision needs zone "${zoneId}".`);

  const widthM = inchesToMeters(ZONES.secretTunnelWidthIn.value);
  const lengthM = inchesToMeters(ZONES.secretTunnelLengthIn.value);
  const thicknessM = inchesToMeters(TUNNEL_RAIL_THICKNESS_IN);
  const span = { bottom: 0, top: inchesToMeters(TUNNEL_RAIL_HEIGHT_IN) };

  return [-1, 1].map((side, index) =>
    createStaticBody({
      id: firstId + index,
      shape: createObb(thicknessM, lengthM),
      span,
      pose: {
        p: {
          x: zone.centerM.x + (side * (widthM + thicknessM)) / 2,
          y: zone.centerM.y,
        },
        theta: 0,
      },
    }),
  );
}

/** Build DECODE's generic field plus its documented goal, classifier and tunnel assemblies. */
export function createDecodeField(firstEntityId: EntityId = 1000): FieldTemplate {
  const standard = createStandardField(firstEntityId);
  return {
    ...standard,
    id: 'ftc-decode-2025-26',
    name: 'FTC DECODE Field',
    bodies: [
      ...standard.bodies,
      goalBody('red', firstEntityId + GOAL_BODY_ID_BASE),
      goalBody('blue', firstEntityId + GOAL_BODY_ID_BASE + 1),
      classifierBody('red', firstEntityId + GOAL_BODY_ID_BASE + 2),
      classifierBody('blue', firstEntityId + GOAL_BODY_ID_BASE + 3),
      ...tunnelRailBodies(DECODE_ZONES.redSecretTunnel, firstEntityId + GOAL_BODY_ID_BASE + 4),
      ...tunnelRailBodies(DECODE_ZONES.blueSecretTunnel, firstEntityId + GOAL_BODY_ID_BASE + 6),
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
