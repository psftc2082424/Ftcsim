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

import { createStandardField, type FieldAssembly, type FieldTemplate } from '../../field/fieldTemplate.js';
import { createStaticBody, type EntityId, type RigidBody } from '../../physics/body.js';
import { createObb } from '../../physics/shapes.js';
import { explicitRule, inferred, type Sourced } from '../sourced.js';
import { DECODE_REGIONS, DECODE_ZONES } from './decode.js';
import { CLASSIFIER_CHANNEL_WIDTH_IN as ASSEMBLY_CLASSIFIER_CHANNEL_WIDTH_IN, createDecodeAssemblies } from './decodeAssemblies.js';

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

/** The shared assembly dimension is retained as this fixture's public API. */
export const CLASSIFIER_CHANNEL_WIDTH_IN = ASSEMBLY_CLASSIFIER_CHANNEL_WIDTH_IN;

/** Convert canonical OBB fixture parts into the static body model. */
function assemblyBodies(assemblies: readonly FieldAssembly[]): readonly RigidBody[] {
  return assemblies.flatMap((assembly) =>
    assembly.parts.flatMap((part) => {
      if (part.collider === undefined || part.geometry.kind !== 'obb') return [];
      return [
        createStaticBody({
          id: part.collider.id,
          shape: createObb(part.geometry.widthM, part.geometry.lengthM),
          span: part.collider.span,
          pose: part.geometry.pose,
        }),
      ];
    }),
  );
}

/** Build DECODE's generic field plus physical GOAL, lane rails, and live gates. */
export function createDecodeField(firstEntityId: EntityId = 1000): FieldTemplate {
  const standard = createStandardField(firstEntityId);
  const assemblies = createDecodeAssemblies(firstEntityId + 1100);
  const bodies = assemblyBodies(assemblies);
  const colliderTags = Object.fromEntries(
    assemblies.flatMap((assembly) => assembly.parts)
      .flatMap((part) => part.collider?.tag === undefined ? [] : [[part.collider.tag, [part.collider.id]] as const]),
  );
  return {
    ...standard,
    id: 'ftc-decode-2025-26',
    name: 'FTC DECODE Field',
    bodies: [
      ...standard.bodies,
      ...bodies,
    ],
    colliderTags,
    assemblies,
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
