/**
 * BIOBUZZ physical-collision fixture.
 *
 * Reuses the season-stable perimeter (`createStandardField`) and adds static
 * bodies for every collider `biobuzzAssemblies.ts` declares — the HIVE
 * Frame's own four corner legs. The renderer draws the same assembly parts
 * directly, so the visual structure and its collision footprint can never
 * drift apart, the same split DECODE's `decodeCollision.ts` uses.
 *
 * ── Why the HIVE is four leg posts, not a floor-level block ─────────────────
 *
 * The HIVE's own CELLs sit high off the tiles — their resting band starts at
 * `HIVE_FRAME.pivotHeightIn - HIVE_CELL.openingHeightIn` (`biobuzzField.ts`),
 * comfortably above a ROBOT's own height limit — so the structure is
 * genuinely elevated *above* the field rather than sitting on it. What
 * actually touches the tiles is the Frame's own four legs, at the corners of
 * its footprint (§9.6.1's 49.46 x 38.95 in). A ROBOT can legally drive under
 * the raised CELLs anywhere between those corners, including straight through
 * the middle, so only the corners get a collision body.
 *
 * ── Why the FLOWERs have no collision body ─────────────────────────────────
 *
 * A FLOWER is a hollow tube mounted on the perimeter wall, and its own staged
 * POLLEN live *inside* it — "the bottom most Pollen sitting on the tiles
 * inside the Flower Bottom Ring" (Setup Guide §11.2). A 2D collision shape is
 * convex, so it has no inside: a post drawn over the ring is solid matter
 * exactly where those four POLLEN rest, and the resolver ejects them — through
 * the perimeter and out of the FIELD, which is what it did before this was
 * removed. Since a FLOWER sits flush against a wall that already stops a
 * ROBOT there, a solid post buys almost nothing and costs the staging.
 *
 * The fidelity actually lost is retention: nothing stops a ROBOT bulldozing a
 * FLOWER's POLLEN sideways out of the ring the real tube would hold them in.
 * Fixing that needs an annulus or a ring of small bodies, which is worth doing
 * from the CAD rather than from a guess.
 *
 * The CELLs and FLOWER scoring volumes themselves have no collision body —
 * they are `GameDefinition` regions, not obstacles, exactly as DECODE keeps
 * its GOAL opening passable while the GOAL shell around it is solid.
 */

import { createStandardField, type FieldAssembly, type FieldTemplate } from '../../field/fieldTemplate.js';
import { createStaticBody, type EntityId, type RigidBody } from '../../physics/body.js';
import { createObb } from '../../physics/shapes.js';
import { createBiobuzzAssemblies } from './biobuzzAssemblies.js';

/**
 * Where this fixture's own bodies start, measured from the id the perimeter
 * gets. `createStandardField` numbers four walls from its own first id, so
 * anything added here has to begin past them: sharing an id silently replaces
 * a wall in `SimWorld`'s body map, and a robot drives straight out of the
 * field through the gap.
 */
const STRUCTURE_ID_OFFSET = 100;

/** Convert canonical OBB assembly parts into the static body model. */
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

export function createBiobuzzField(firstEntityId: EntityId = 1000): FieldTemplate {
  const base = createStandardField(firstEntityId);
  const assemblies = createBiobuzzAssemblies(firstEntityId + STRUCTURE_ID_OFFSET);
  const bodies = assemblyBodies(assemblies);

  return {
    ...base,
    id: 'biobuzz-2026',
    name: 'BIOBUZZ Field',
    bodies: [...base.bodies, ...bodies],
    assemblies,
  };
}
