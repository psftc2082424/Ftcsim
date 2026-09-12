/**
 * Where BIOBUZZ's pieces start a match, as actual bodies.
 *
 * `BIOBUZZ_SETUP` (`biobuzz.ts`) carries the full manual composition — 40
 * POLLEN, 16 NECTAR, across 4 ROBOTS this solo-practice simulator does not
 * seat all of. `stageBiobuzzPieces` is the runtime counterpart: it places
 * every piece this *one* practice robot's match actually starts with, the
 * same declared-vs-staged split `decodeStaging.ts` uses for DECODE's
 * off-field ALLIANCE AREA artifacts — except here, unlike DECODE, BIOBUZZ's
 * "off-field" reserve NECTAR really are staged as bodies (parked, per
 * `reserveFeed.ts`), because this fixture chose to model the human-fed
 * reserve rather than omit it.
 *
 * ── Where "pre-loaded in a FLOWER" pieces actually go ──────────────────────
 *
 * §10.3.1 stages 4 POLLEN "in" each FLOWER, but the FLOWER's *scoring* volume
 * is between its top and middle rings (§10.5.2) while its lower ring is a
 * separate feeder POLLEN sit in near the floor (§9.7). Placed at floor height,
 * these fall below the scoring region's vertical span by construction — the
 * geometry already keeps a staged, not-yet-scored POLLEN from reading as
 * pre-scored, with no separate feeder region needed for this pass.
 */

import type { GamePieceSpec } from '../../sim/simWorld.js';
import { vec2 } from '../../math/vec2.js';
import { inchesToMeters } from '../../units/convert.js';
import {
  NECTAR_DIAMETER_IN,
  NECTAR_MASS_LB,
  POLLEN_DIAMETER_IN,
  POLLEN_MASS_LB,
  STARTING_CUBE_IN,
} from './biobuzzDimensions.js';
import { BIOBUZZ_FIELD_REGIONS, BIOBUZZ_LEGAL_START_POSES, BIOBUZZ_REGIONS, BIOBUZZ_ZONES, BIOBUZZ_FIELD_ZONES } from './biobuzzField.js';
import { tileBounds } from './biobuzzTiles.js';
import { BIOBUZZ_TIPPING_STRUCTURES, HIVE_CELL_REST_HEIGHT_IN, reserveNectarIds } from './biobuzz.js';

const POLLEN_D = POLLEN_DIAMETER_IN.value;
const NECTAR_D = NECTAR_DIAMETER_IN.value;

function centerOf(id: string): { xIn: number; yIn: number } {
  const place = BIOBUZZ_FIELD_REGIONS.find((r) => r.id === id) ?? BIOBUZZ_FIELD_ZONES.find((z) => z.id === id);
  if (place === undefined) throw new Error(`BIOBUZZ staging needs region or zone "${id}".`);
  return { xIn: place.centerM.x / inchesToMeters(1), yIn: place.centerM.y / inchesToMeters(1) };
}

function pollen(pieceId: string, xIn: number, yIn: number, heightIn?: number): GamePieceSpec {
  return {
    pieceId,
    pieceType: 'pollen',
    diameterIn: POLLEN_D,
    massLb: POLLEN_MASS_LB.value,
    startPositionM: vec2(inchesToMeters(xIn), inchesToMeters(yIn)),
    ...(heightIn === undefined ? {} : { heightM: inchesToMeters(heightIn) }),
  };
}

function nectar(pieceId: string, alliance: 'red' | 'blue', xIn: number, yIn: number, heightIn?: number): GamePieceSpec {
  return {
    pieceId,
    pieceType: `nectar-${alliance}`,
    diameterIn: NECTAR_D,
    massLb: NECTAR_MASS_LB.value,
    startPositionM: vec2(inchesToMeters(xIn), inchesToMeters(yIn)),
    ...(heightIn === undefined ? {} : { heightM: inchesToMeters(heightIn) }),
  };
}

/**
 * Stages 4 practice-robot POLLEN at *each* alliance's own legal start, since
 * this solo-practice simulator lets the driver switch alliance after the
 * world is built (`App.tsx`'s Team selector) without re-staging. Only one set
 * is ever actually contacting a robot at a time; the other sits idle on the
 * floor, the same "declared but not all staged" gap DECODE's 3 off-field
 * ROBOTS' worth of ARTIFACTS leave.
 */
export function stageBiobuzzPieces(): readonly GamePieceSpec[] {
  const staged: GamePieceSpec[] = [];

  // "[4] Pollen placed in it, with the bottom most Pollen sitting on the tiles
  // inside the Flower Bottom Ring and each subsequent Pollen resting on the one
  // below" (Setup Guide §11.2) — a column inside a vertical tube.
  //
  // This engine cannot hold that column: loose pieces have a height but no
  // resting-on-each-other contact (see `BIOBUZZ_ELEVATED_REGIONS`), so four
  // POLLEN stacked on one spot simply overlap, shove each other apart and
  // scatter. They are staged spread along the wall at the FLOWER's mouth
  // instead: the same four POLLEN, at the same FLOWER, reachable by the same
  // ROBOT, just lying in a row rather than a stack. Restore the column when
  // piece-on-piece stacking exists.
  const flowerIds = [
    BIOBUZZ_REGIONS.flowerNorth,
    BIOBUZZ_REGIONS.flowerSouth,
    BIOBUZZ_REGIONS.flowerEast,
    BIOBUZZ_REGIONS.flowerWest,
  ];
  for (const flowerId of flowerIds) {
    const { xIn, yIn } = centerOf(flowerId);
    // Spread along whichever wall the FLOWER is mounted on, so the row runs
    // beside the perimeter rather than out into the driving lane.
    const alongWall = Math.abs(xIn) > Math.abs(yIn) ? { x: 0, y: 1 } : { x: 1, y: 0 };
    for (let index = 0; index < 4; index++) {
      const offsetIn = (index - 1.5) * POLLEN_D;
      staged.push(
        pollen(
          `pollen-${flowerId}-${index}`,
          xIn + alongWall.x * offsetIn,
          yIn + alongWall.y * offsetIn,
        ),
      );
    }
  }

  // "[4] Pollen in each Garden are placed in a line such that they contact the
  // Tape Lines of the Garden, are approximately adjacent to both nearby Field
  // Perimeter Walls and are approximately adjacent to each other" (§11.3): a
  // row running out of the corner along the wall, each ball touching the next.
  const gardenTiles = [
    { id: BIOBUZZ_REGIONS.redGarden, column: 'A' as const, row: 1 as const },
    { id: BIOBUZZ_REGIONS.blueGarden, column: 'F' as const, row: 6 as const },
  ];
  for (const { id, column, row } of gardenTiles) {
    const bounds = tileBounds(column, row);
    const yIn = centerOf(id).yIn;
    // Each row starts from the corner its own GARDEN TILE makes with the side
    // wall — A1's is at -X, F6's at +X — and runs along the wall from there.
    const fromXIn = column === 'A' ? bounds.minXIn : bounds.maxXIn;
    const along = column === 'A' ? 1 : -1;
    for (let index = 0; index < 4; index++) {
      staged.push(
        pollen(`pollen-${id}-${index}`, fromXIn + along * (POLLEN_D / 2 + index * POLLEN_D), yIn),
      );
    }
  }

  // "ROBOTS must start the MATCH contacting 4 pre-loaded POLLEN" (§10.3.4).
  // Laid in a row across the front bumper, just touching it: a piece staged at
  // the robot's own centre would be inside its chassis, where it is both in
  // permanent collision and out of reach of a front-mounted intake — so the
  // driver could never actually collect the preload the rule requires.
  // Staged for *both* alliances because this solo-practice simulator lets the
  // driver switch alliance after the world is built (`App.tsx`'s Team
  // selector) without re-staging; only one set is ever against a robot.
  for (const startAlliance of ['red', 'blue'] as const) {
    const start = BIOBUZZ_LEGAL_START_POSES[startAlliance];
    const startXIn = start.p.x / inchesToMeters(1);
    const startYIn = start.p.y / inchesToMeters(1);
    // Along the robot's heading, clear of a half-robot plus one ball radius.
    const aheadIn = STARTING_CUBE_IN.value / 2 + POLLEN_D / 2;
    const forward = { x: Math.cos(start.theta), y: Math.sin(start.theta) };
    for (let index = 0; index < 4; index++) {
      const acrossIn = (index - 1.5) * POLLEN_D;
      staged.push(
        pollen(
          `pollen-robot-${startAlliance}-${index}`,
          startXIn + forward.x * aheadIn - forward.y * acrossIn,
          startYIn + forward.y * aheadIn + forward.x * acrossIn,
        ),
      );
    }
  }

  // "Each upward tilted Cell has [3] Nectar in it" (§11.1), of that HIVE's own
  // colour — and which CELL is up is the guide's own per-alliance setup
  // (`BIOBUZZ_INITIAL_UP_CELL`: red on the audience side, blue on the scoring
  // side), so this reads the structure rather than assuming both are mirrored.
  // They sit at the CELL's resting height so they read as already inside it,
  // not on the floor below.
  for (const alliance of ['red', 'blue'] as const) {
    const structure = BIOBUZZ_TIPPING_STRUCTURES.find((s) => s.alliance === alliance);
    if (structure === undefined) throw new Error(`BIOBUZZ staging needs a ${alliance} HIVE.`);
    const cell = centerOf(structure.cellRegionIds[structure.initialUpIndex]);
    for (let index = 0; index < 3; index++) {
      staged.push(
        nectar(
          `nectar-${alliance}-${index + 1}`,
          alliance,
          cell.xIn + (index - 1) * NECTAR_D,
          cell.yIn,
          HIVE_CELL_REST_HEIGHT_IN,
        ),
      );
    }
  }

  // The reserve 5-per-alliance NECTAR: staged as real bodies so the declared
  // piece count is honest, but `MatchSimulation` parks every id a
  // `ReserveFeedSpec` names immediately at construction (`reserveFeed.ts`),
  // so this starting position is never actually seen in play.
  const redLoading = centerOf(BIOBUZZ_ZONES.redLoadingZone);
  for (const pieceId of reserveNectarIds('red')) {
    staged.push(nectar(pieceId, 'red', redLoading.xIn, redLoading.yIn));
  }
  const blueLoading = centerOf(BIOBUZZ_ZONES.blueLoadingZone);
  for (const pieceId of reserveNectarIds('blue')) {
    staged.push(nectar(pieceId, 'blue', blueLoading.xIn, blueLoading.yIn));
  }

  return staged;
}
