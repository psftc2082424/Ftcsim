/**
 * BIOBUZZ field layout and containment.
 *
 * Two kinds of check live here. The placement tests assert this fixture agrees
 * with the Event FIELD Setup Guide's own TILE coordinates — "[1] Red (on tile
 * A5)" is a sentence a test can hold the fixture to. The containment tests are
 * regressions for a bug that made every one of them meaningless: the fixture
 * gave its structures the same entity ids as the perimeter walls, so three of
 * the four walls were silently replaced in `SimWorld`'s body map and a robot
 * drove straight out of the FIELD.
 */

import { describe, expect, it } from 'vitest';
import { simulationFromDefinition } from '../matchSimulation.js';
import { LatchedController, NeutralController } from '../../control/controller.js';
import { metersToInches } from '../../units/convert.js';
import { vec2 } from '../../math/vec2.js';
import { getGameEntry } from '../registry.js';
import { BIOBUZZ_GAME } from './biobuzzGame.js';
import { createBiobuzzField } from './biobuzzCollision.js';
import { stageBiobuzzPieces } from './biobuzzStaging.js';
import { BIOBUZZ_FIELD_REGIONS, BIOBUZZ_FIELD_ZONES, BIOBUZZ_REGIONS, BIOBUZZ_ZONES } from './biobuzzField.js';
import { columnCenterXIn, rowCenterYIn, tileCenterIn, verticalSeamXIn, horizontalSeamYIn } from './biobuzzTiles.js';
import { FIELD_SIZE_IN } from './biobuzzDimensions.js';
import { BIOBUZZ_TIPPING_STRUCTURES } from './biobuzz.js';

const HALF = FIELD_SIZE_IN / 2;
const inOf = (m: number): number => metersToInches(m as never);

const regionCenter = (id: string) => {
  const place =
    BIOBUZZ_FIELD_REGIONS.find((r) => r.id === id) ?? BIOBUZZ_FIELD_ZONES.find((z) => z.id === id);
  if (place === undefined) throw new Error(`no region or zone ${id}`);
  return { xIn: inOf(place.centerM.x), yIn: inOf(place.centerM.y) };
};

const entry = () => getGameEntry(BIOBUZZ_GAME.id);

describe('BIOBUZZ TILE coordinates', () => {
  it('puts the grid corners where a 6 x 6 grid of 24 in TILES must sit', () => {
    expect(columnCenterXIn('A')).toBeCloseTo(-60);
    expect(columnCenterXIn('F')).toBeCloseTo(60);
    expect(rowCenterYIn(1)).toBeCloseTo(-60);
    expect(rowCenterYIn(6)).toBeCloseTo(60);
  });

  it('puts the centre seams on the field centre lines', () => {
    // The self-check the guide's own Figure 6-2 offers: the HIVE frame is
    // installed on the four centre TILES, so their shared corner is (0, 0).
    expect(verticalSeamXIn('X')).toBeCloseTo(0);
    expect(horizontalSeamYIn(3)).toBeCloseTo(0);
  });
});

describe('BIOBUZZ element placement (Event FIELD Setup Guide)', () => {
  it('tapes the LOADING ZONES on TILE A5 (red) and F2 (blue), against their own walls', () => {
    const red = regionCenter(BIOBUZZ_ZONES.redLoadingZone);
    const blue = regionCenter(BIOBUZZ_ZONES.blueLoadingZone);

    expect(red.yIn).toBeCloseTo(tileCenterIn('A', 5).yIn);
    expect(blue.yIn).toBeCloseTo(tileCenterIn('F', 2).yIn);
    // 11 in deep from its own wall puts the centre 5.5 in inboard.
    expect(red.xIn).toBeCloseTo(-HALF + 5.5);
    expect(blue.xIn).toBeCloseTo(HALF - 5.5);
  });

  it('tapes the GARDENS on TILE A1 (red) and F6 (blue), in opposite corners', () => {
    const red = regionCenter(BIOBUZZ_REGIONS.redGarden);
    const blue = regionCenter(BIOBUZZ_REGIONS.blueGarden);

    expect(red.xIn).toBeCloseTo(tileCenterIn('A', 1).xIn);
    expect(blue.xIn).toBeCloseTo(tileCenterIn('F', 6).xIn);
    // Each hugs the long wall its own TILE touches: A1 the audience wall.
    expect(red.yIn).toBeLessThan(-HALF + 10);
    expect(blue.yIn).toBeGreaterThan(HALF - 10);
  });

  it('puts one FLOWER on each perimeter wall, rotationally symmetric', () => {
    const north = regionCenter(BIOBUZZ_REGIONS.flowerNorth);
    const south = regionCenter(BIOBUZZ_REGIONS.flowerSouth);
    const east = regionCenter(BIOBUZZ_REGIONS.flowerEast);
    const west = regionCenter(BIOBUZZ_REGIONS.flowerWest);

    // Figure 6-2 draws them on seams W / Y and 4 / 2 — a 180-degree rotation
    // of the field maps each onto the one opposite it.
    expect(north.xIn).toBeCloseTo(-south.xIn);
    expect(north.yIn).toBeCloseTo(-south.yIn);
    expect(east.xIn).toBeCloseTo(-west.xIn);
    expect(east.yIn).toBeCloseTo(-west.yIn);
    expect(north.xIn).toBeCloseTo(verticalSeamXIn('W'));
    expect(east.yIn).toBeCloseTo(horizontalSeamYIn(4));
  });

  it('tips red up on the audience side and blue up on the scoring side', () => {
    // §11.1 is explicit that the two HIVES are *not* set up as mirror images,
    // which is easy to lose to a shared "index 0" default. The audience is -Y.
    const upCellY = (alliance: 'red' | 'blue') => {
      const structure = BIOBUZZ_TIPPING_STRUCTURES.find((s) => s.alliance === alliance)!;
      return regionCenter(structure.cellRegionIds[structure.initialUpIndex]).yIn;
    };

    expect(upCellY('red')).toBeLessThan(0);
    expect(upCellY('blue')).toBeGreaterThan(0);
  });

  it('stages each alliance\'s 3 NECTAR in whichever CELL its own HIVE starts with up', () => {
    const staged = stageBiobuzzPieces();
    for (const alliance of ['red', 'blue'] as const) {
      const structure = BIOBUZZ_TIPPING_STRUCTURES.find((s) => s.alliance === alliance)!;
      const upCell = regionCenter(structure.cellRegionIds[structure.initialUpIndex]);
      const nectar = staged.filter(
        (piece) => piece.pieceType === `nectar-${alliance}` && piece.heightM !== undefined,
      );

      expect(nectar).toHaveLength(3);
      for (const piece of nectar) {
        expect(inOf(piece.startPositionM!.y)).toBeCloseTo(upCell.yIn);
      }
    }
  });

  it('keeps every region and zone inside the FIELD', () => {
    for (const place of [...BIOBUZZ_FIELD_REGIONS, ...BIOBUZZ_FIELD_ZONES]) {
      expect(Math.abs(inOf(place.centerM.x))).toBeLessThanOrEqual(HALF);
      expect(Math.abs(inOf(place.centerM.y))).toBeLessThanOrEqual(HALF);
    }
  });

  it('starts each alliance clear of its own LOADING ZONE and FLOWER', () => {
    for (const alliance of ['red', 'blue'] as const) {
      const start = entry().legalStartPoses[alliance];
      const loading = regionCenter(
        alliance === 'red' ? BIOBUZZ_ZONES.redLoadingZone : BIOBUZZ_ZONES.blueLoadingZone,
      );
      const flower = regionCenter(
        alliance === 'red' ? BIOBUZZ_REGIONS.flowerWest : BIOBUZZ_REGIONS.flowerEast,
      );
      // Clear by more than a robot's own half-width beyond each obstruction's
      // own half-extent — the LOADING ZONE is 23 in along the wall, a FLOWER
      // about 4 in across.
      expect(Math.abs(inOf(start.p.y) - loading.yIn)).toBeGreaterThan(9 + 23 / 2);
      expect(Math.abs(inOf(start.p.y) - flower.yIn)).toBeGreaterThan(9 + 9);
    }
  });
});

describe('BIOBUZZ field containment', () => {
  it('gives every collision body a distinct entity id', () => {
    // The bug this guards: the HIVE and the four FLOWER posts were numbered
    // from the same first id as the perimeter, so they replaced three walls.
    const ids = createBiobuzzField().bodies.map((body) => body.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('holds a robot inside the FIELD when it drives full-tilt at every wall', () => {
    const controller = new LatchedController();
    const sim = simulationFromDefinition(BIOBUZZ_GAME, {
      robots: [
        {
          config: entry().defaultRobotConfig,
          controller,
          alliance: 'red',
          startPose: { p: vec2(0, 0), theta: 0 },
        },
      ],
      pieces: stageBiobuzzPieces(),
      field: createBiobuzzField(),
    });

    const directions: readonly [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
    ];
    for (const [x, y] of directions) {
      controller.set({ drive: { x, y, turn: 0 }, buttons: {}, axes: {} });
      for (let tick = 0; tick < 600; tick++) {
        sim.step();
        const robot = sim.world.snapshot().robots[0]!;
        expect(Math.abs(inOf(robot.pose.p.x))).toBeLessThan(HALF);
        expect(Math.abs(inOf(robot.pose.p.y))).toBeLessThan(HALF);
      }
    }
  });

  it('leaves no staged piece outside the FIELD once the world settles', () => {
    // The FLOWER posts used to sit on top of their own staged POLLEN and eject
    // them through the perimeter (see `biobuzzCollision.ts`).
    const sim = simulationFromDefinition(BIOBUZZ_GAME, {
      robots: [
        {
          config: entry().defaultRobotConfig,
          controller: new NeutralController(),
          alliance: 'red',
          startPose: entry().legalStartPoses.red,
        },
      ],
      pieces: stageBiobuzzPieces(),
      field: createBiobuzzField(),
    });

    sim.advanceTo(5);

    const escaped = sim.world
      .snapshot()
      .pieces.filter((piece) => Math.abs(inOf(piece.pose.p.x)) > HALF || Math.abs(inOf(piece.pose.p.y)) > HALF);
    expect(escaped.map((piece) => piece.pieceId)).toEqual([]);
  });

  it('stages every piece inside the FIELD to begin with', () => {
    for (const piece of stageBiobuzzPieces()) {
      expect(Math.abs(inOf(piece.startPositionM!.x))).toBeLessThan(HALF);
      expect(Math.abs(inOf(piece.startPositionM!.y))).toBeLessThan(HALF);
    }
  });
});

describe('BIOBUZZ robot', () => {
  it('carries 4 pieces, the number a BIOBUZZ ROBOT must start the match holding', () => {
    const intake = entry()
      .defaultRobotConfig.mechanisms.flatMap((mechanism) => mechanism.capabilities)
      .find((capability) => capability.kind === 'acquire');
    expect(intake).toBeDefined();
    expect(intake?.kind === 'acquire' ? intake.capacity : 0).toBe(4);
  });

  it('collects its 4 pre-loaded POLLEN, which a preload staged inside the chassis could not', () => {
    const controller = new LatchedController();
    const sim = simulationFromDefinition(BIOBUZZ_GAME, {
      robots: [
        {
          config: entry().defaultRobotConfig,
          controller,
          alliance: 'red',
          startPose: entry().legalStartPoses.red,
        },
      ],
      pieces: stageBiobuzzPieces(),
      field: createBiobuzzField(),
    });

    controller.set({ drive: { x: 0, y: 0, turn: 0 }, buttons: { intake: true }, axes: {} });
    for (let tick = 0; tick < 400; tick++) sim.step();

    expect(sim.world.snapshot().robots[0]!.mechanisms.held).toHaveLength(4);
  });

  it('drives, collects and fires a real POLLEN into its own HIVE until it tips', () => {
    // The whole product path in one test: intake -> hopper -> launch -> real
    // ballistic arc -> CELL catches it -> calibrated load -> tip -> score.
    const controller = new LatchedController();
    const sim = simulationFromDefinition(BIOBUZZ_GAME, {
      robots: [
        {
          config: entry().defaultRobotConfig,
          controller,
          alliance: 'red',
          startPose: entry().legalStartPoses.red,
        },
      ],
      pieces: stageBiobuzzPieces(),
      field: createBiobuzzField(),
    });

    controller.set({ drive: { x: 0, y: 0, turn: 0 }, buttons: { intake: true }, axes: {} });
    for (let tick = 0; tick < 400; tick++) sim.step();
    expect(sim.tippers.tipCount('red-hive')).toBe(0);

    controller.set({ drive: { x: 0, y: 0, turn: 0 }, buttons: { launch: true }, axes: {} });
    for (let tick = 0; tick < 2000 && sim.tippers.tipCount('red-hive') === 0; tick++) sim.step();

    expect(sim.tippers.tipCount('red-hive')).toBe(1);
    expect(sim.score.red).toBeGreaterThanOrEqual(20);

    // And once everything has landed, every piece it fired is an ordinary body
    // again rather than a permanently collision-exempt ghost left over from
    // its protected flight — including the shot that was still in the air when
    // the CELL flipped out from under it and so was never caught at all.
    controller.set({ drive: { x: 0, y: 0, turn: 0 }, buttons: {}, axes: {} });
    for (let tick = 0; tick < 600; tick++) sim.step();

    const ghosts = sim.world.snapshot().pieces.filter((piece) => piece.transferring === true);
    expect(ghosts.map((piece) => piece.pieceId)).toEqual([]);
  });
});
