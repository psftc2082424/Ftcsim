/**
 * BIOBUZZ physical-collision fixture.
 *
 * Reuses the season-stable perimeter (`createStandardField`) and adds the one
 * structure BIOBUZZ puts in a ROBOT's path: the central HIVE Structure. It is
 * a real, solid assembly the manual describes (§9.6) but does not give a CAD
 * footprint for, so its collision body is a deliberately simple, `assumed`
 * full-footprint block rather than invented sub-part geometry. This is the
 * same "classify honestly, approximate visibly" position DECODE's own
 * collision fixture took before its CAD-backed pass, and it needs the same
 * follow-up once the CAD is available.
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

import { createStandardField, type FieldTemplate } from '../../field/fieldTemplate.js';
import { createStaticBody, type EntityId, type VerticalSpan } from '../../physics/body.js';
import { createObb } from '../../physics/shapes.js';
import { vec2 } from '../../math/vec2.js';
import { inchesToMeters } from '../../units/convert.js';
import { HIVE_FRAME } from './biobuzzDimensions.js';

/**
 * Assumed collision height for the HIVE frame — capped *below* a CELL's own
 * resting band (which starts at `HIVE_FRAME.pivotHeightIn -
 * HIVE_CELL.openingHeightIn`, see `biobuzzField.ts`). The obstacle exists to
 * block a ROBOT from driving through the frame's base, not to fill the hollow
 * CELL a real ROBOT never contacts at floor level — a taller block would
 * physically trap a piece this fixture holds up there (`tipper.ts`) inside
 * solid matter.
 */
const LOW_STRUCTURE_HEIGHT_IN = 12;

/**
 * Where this fixture's own bodies start, measured from the id the perimeter
 * gets. `createStandardField` numbers four walls from its own first id, so
 * anything added here has to begin past them: sharing an id silently replaces
 * a wall in `SimWorld`'s body map, and a robot drives straight out of the
 * field through the gap.
 */
const STRUCTURE_ID_OFFSET = 100;

export function createBiobuzzField(firstEntityId: EntityId = 1000): FieldTemplate {
  const base = createStandardField(firstEntityId);
  const structureId = firstEntityId + STRUCTURE_ID_OFFSET;

  const hiveSpan: VerticalSpan = { bottom: 0, top: inchesToMeters(LOW_STRUCTURE_HEIGHT_IN) };
  const hiveBody = createStaticBody({
    id: structureId,
    shape: createObb(inchesToMeters(HIVE_FRAME.widthIn.value), inchesToMeters(HIVE_FRAME.depthIn.value)),
    span: hiveSpan,
    pose: { p: vec2(0, 0), theta: 0 },
  });

  return {
    ...base,
    id: 'biobuzz-2026',
    name: 'BIOBUZZ Field',
    bodies: [...base.bodies, hiveBody],
  };
}
