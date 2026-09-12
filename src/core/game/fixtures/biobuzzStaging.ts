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
import { NECTAR_DIAMETER_IN, NECTAR_MASS_LB, POLLEN_DIAMETER_IN, POLLEN_MASS_LB } from './biobuzzDimensions.js';
import { BIOBUZZ_FIELD_REGIONS, BIOBUZZ_LEGAL_START_POSES, BIOBUZZ_REGIONS, BIOBUZZ_ZONES, BIOBUZZ_FIELD_ZONES } from './biobuzzField.js';
import { HIVE_CELL_REST_HEIGHT_IN, reserveNectarIds } from './biobuzz.js';

const POLLEN_D = POLLEN_DIAMETER_IN.value;
const NECTAR_D = NECTAR_DIAMETER_IN.value;

function centerOf(id: string): { xIn: number; yIn: number } {
  const place = BIOBUZZ_FIELD_REGIONS.find((r) => r.id === id) ?? BIOBUZZ_FIELD_ZONES.find((z) => z.id === id);
  if (place === undefined) throw new Error(`BIOBUZZ staging needs region or zone "${id}".`);
  return { xIn: place.centerM.x / inchesToMeters(1), yIn: place.centerM.y / inchesToMeters(1) };
}

function pollen(pieceId: string, xIn: number, yIn: number): GamePieceSpec {
  return { pieceId, pieceType: 'pollen', diameterIn: POLLEN_D, massLb: POLLEN_MASS_LB.value, startPositionM: vec2(inchesToMeters(xIn), inchesToMeters(yIn)) };
}

function nectar(pieceId: string, alliance: 'red' | 'blue', xIn: number, yIn: number, heightIn?: number): GamePieceSpec {
  return {
    pieceId,
    pieceType: `nectar-${alliance}`,
    diameterIn: NECTAR_D,
    massLb: NECTAR_MASS_LB.value,
    startPositionM: vec2(inchesToMeters(xIn), inchesToMeters(yIn)),
    heightM: heightIn === undefined ? undefined : inchesToMeters(heightIn),
  };
}

/** Small, deterministic offsets so 4 same-spot pieces do not spawn stacked. */
const CLUSTER_OFFSETS_IN: readonly [number, number][] = [
  [-1.5, -1.5],
  [1.5, -1.5],
  [-1.5, 1.5],
  [1.5, 1.5],
];

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

  const flowerIds = [
    BIOBUZZ_REGIONS.flowerNorth,
    BIOBUZZ_REGIONS.flowerSouth,
    BIOBUZZ_REGIONS.flowerEast,
    BIOBUZZ_REGIONS.flowerWest,
  ];
  for (const flowerId of flowerIds) {
    const { xIn, yIn } = centerOf(flowerId);
    CLUSTER_OFFSETS_IN.forEach(([dx, dy], index) => {
      staged.push(pollen(`pollen-${flowerId}-${index}`, xIn + dx, yIn + dy));
    });
  }

  for (const gardenId of [BIOBUZZ_REGIONS.redGarden, BIOBUZZ_REGIONS.blueGarden]) {
    const { xIn, yIn } = centerOf(gardenId);
    for (let index = 0; index < 4; index++) {
      staged.push(pollen(`pollen-${gardenId}-${index}`, xIn + (index - 1.5) * POLLEN_D, yIn));
    }
  }

  // 4 pre-loaded POLLEN at each alliance's own legal start — see the export's
  // doc comment for why both are staged rather than just one.
  for (const startAlliance of ['red', 'blue'] as const) {
    const start = BIOBUZZ_LEGAL_START_POSES[startAlliance];
    const startXIn = start.p.x / inchesToMeters(1);
    const startYIn = start.p.y / inchesToMeters(1);
    CLUSTER_OFFSETS_IN.forEach(([dx, dy], index) => {
      staged.push(pollen(`pollen-robot-${startAlliance}-${index}`, startXIn + dx, startYIn + dy));
    });
  }

  // 3 NECTAR of each alliance's own colour, pre-loaded in its own initially
  // up-facing CELL (index 0 — see BIOBUZZ_TIPPING_STRUCTURES), at the CELL's
  // resting height so they read as already inside it, not sitting on the
  // floor below.
  const redCell = centerOf(BIOBUZZ_REGIONS.redCellNear);
  for (let index = 0; index < 3; index++) {
    staged.push(
      nectar(`nectar-red-${index + 1}`, 'red', redCell.xIn + (index - 1) * NECTAR_D, redCell.yIn, HIVE_CELL_REST_HEIGHT_IN),
    );
  }
  const blueCell = centerOf(BIOBUZZ_REGIONS.blueCellNear);
  for (let index = 0; index < 3; index++) {
    staged.push(
      nectar(`nectar-blue-${index + 1}`, 'blue', blueCell.xIn + (index - 1) * NECTAR_D, blueCell.yIn, HIVE_CELL_REST_HEIGHT_IN),
    );
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
