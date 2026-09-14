/**
 * End-to-end BIOBUZZ match scenarios.
 *
 * Runs the real BIOBUZZ rule set, field layout, tipping structures and
 * reserve feeds through the whole pipeline. As with `decodeMatch.test.ts`:
 * the *rules and point values* are transcribed from the manual and cited; the
 * *field layout* is `inferred`/`assumed` (`biobuzzField.ts`'s banner) because
 * the manual defers element positions to figures this pass cannot read. These
 * tests verify the engine applies BIOBUZZ's rules correctly to the positions
 * it was given, not that the positions themselves are CAD-accurate.
 */

import { describe, expect, it } from 'vitest';
import { simulationFromDefinition } from '../matchSimulation.js';
import { definitionErrors, validateGameDefinition, totalStagedPieces } from '../gameDefinition.js';
import { createDefaultRegistry } from '../predicates.js';
import { validateRegions } from '../regions.js';
import { COMPETITION_ROBOT_CONFIG, DEFAULT_ROBOT_CONFIG } from '../../robot/robotConfig.js';
import { NeutralController, LatchedController } from '../../control/controller.js';
import { constantController } from '../../control/scripted.js';
import { createControlInput } from '../../control/controlInput.js';
import { INTAKE_BUTTON } from '../../sim/shooter.js';
import { inchesToMeters } from '../../units/convert.js';
import { DT_SECONDS, SimWorld } from '../../sim/simWorld.js';
import { vec2 } from '../../math/vec2.js';
import { getGameEntry } from '../registry.js';
import { BIOBUZZ_GAME } from './biobuzzGame.js';
import { createBiobuzzField } from './biobuzzCollision.js';
import { stageBiobuzzPieces } from './biobuzzStaging.js';
import { BIOBUZZ_REGIONS, BIOBUZZ_FIELD_REGIONS, BIOBUZZ_LEGAL_START_POSES } from './biobuzzField.js';
import {
  HIVE_CELL_REST_HEIGHT_IN,
  BIOBUZZ_HIVE_TIP_DURATION_SEC,
  flowerPollenIds,
  BIOBUZZ_HIVE_TIP_LOAD_LB,
  BIOBUZZ_TIPPING_STRUCTURES,
  BIOBUZZ_SETUP,
  BIOBUZZ_PIECES,
  reserveNectarIds,
} from './biobuzz.js';
import { FLOWER, HIVE_FRAME, NECTAR_DIAMETER_IN, NECTAR_MASS_LB, POLLEN_DIAMETER_IN, POLLEN_MASS_LB } from './biobuzzDimensions.js';

const cellCenterIn = (regionId: string): { xIn: number; yIn: number } => {
  const region = BIOBUZZ_FIELD_REGIONS.find((r) => r.id === regionId);
  if (region === undefined) throw new Error(`no region ${regionId}`);
  return { xIn: region.centerM.x / inchesToMeters(1), yIn: region.centerM.y / inchesToMeters(1) };
};

describe('BIOBUZZ_GAME definition', () => {
  it('validates cleanly against the default predicate registry', () => {
    const problems = validateGameDefinition(BIOBUZZ_GAME, createDefaultRegistry());
    expect(definitionErrors(problems)).toEqual([]);
  });

  it('has field geometry with no degenerate shapes', () => {
    expect(validateRegions(BIOBUZZ_GAME.regions)).toEqual([]);
    expect(validateRegions(BIOBUZZ_GAME.zones.map((z) => ({ ...z })))).toEqual([]);
  });

  it('declares the manual\'s full piece counts (§9.8)', () => {
    const byId = new Map(BIOBUZZ_PIECES.map((p) => [p.id, p.count.value]));
    expect(byId.get('pollen')).toBe(40);
    expect(byId.get('nectar-red')).toBe(8);
    expect(byId.get('nectar-blue')).toBe(8);
  });

  it('stages a setup composition that adds up to the declared piece counts', () => {
    const staged = totalStagedPieces(BIOBUZZ_SETUP);
    expect(staged['pollen']).toBe(40);
    expect(staged['nectar-red']).toBe(8);
    expect(staged['nectar-blue']).toBe(8);
  });
});

describe('BIOBUZZ end-to-end scenarios', () => {
  const build = (extraPieces: ReturnType<typeof stageBiobuzzPieces> = []) =>
    simulationFromDefinition(BIOBUZZ_GAME, {
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: new NeutralController(),
          alliance: 'red',
          startPose: BIOBUZZ_LEGAL_START_POSES.red,
        },
      ],
      pieces: [...stageBiobuzzPieces(), ...extraPieces],
      field: createBiobuzzField(),
    });

  /**
   * POLLEN resting in a named CELL, at the height the CELL holds them.
   *
   * The setup guide's calibration is stated in POLLEN "gently placed" into a
   * CELL that already holds the staged 3 NECTAR, so that is what these build.
   */
  const pollenInCell = (regionId: string, count: number) => {
    const { xIn, yIn } = cellCenterIn(regionId);
    const d = POLLEN_DIAMETER_IN.value;
    // Laid out as a grid rather than one row: the CELL opening is 20 x 12 in,
    // and eight POLLEN in a single row would reach past its edge and stop
    // counting as inside it.
    const perRow = 4;
    return Array.from({ length: count }, (_unused, index) => ({
      pieceId: `extra-pollen-${index}`,
      pieceType: 'pollen',
      diameterIn: d,
      massLb: POLLEN_MASS_LB.value,
      startPositionM: vec2(
        inchesToMeters(xIn + ((index % perRow) - (perRow - 1) / 2) * d),
        inchesToMeters(yIn + (Math.floor(index / perRow) - 0.5) * d),
      ),
      heightM: inchesToMeters(HIVE_CELL_REST_HEIGHT_IN),
    }));
  };

  /**
   * Ticks to allow a HIVE to actually come over: a tip is a timed swing now
   * (`tipper.ts`), so every "did it tip" case has to run past its duration
   * rather than one tick past the load arriving.
   */
  const TIP_TICKS = Math.ceil((BIOBUZZ_HIVE_TIP_DURATION_SEC.value / DT_SECONDS) * 1.2);

  const redUpCell = () => {
    const structure = BIOBUZZ_TIPPING_STRUCTURES.find((s) => s.alliance === 'red')!;
    return structure.cellRegionIds[structure.initialUpIndex];
  };

  /**
   * The setup guide's own calibration requirement (§12.3), run as gameplay.
   *
   * "[3] Nectar + [2] Pollen ... No Tip Necessary" and "[3] Nectar + [2] Pollen,
   * 3rd Pollen is Gently Placed ... Tip". The 3 NECTAR are the staged kickoff
   * load, so this is exactly the field-calibration test a volunteer performs.
   */
  it('does not tip the red HIVE on the staged 3 NECTAR plus 2 POLLEN (Setup Guide §12.3)', () => {
    const sim = build(pollenInCell(redUpCell(), 2));

    for (let i = 0; i < TIP_TICKS; i++) sim.step();

    expect(sim.tippers.tipCount('red-hive')).toBe(0);
    expect(sim.score.red).toBe(0);
  });

  /**
   * With POLLEN and NECTAR weighed individually (25 g / 40 g) rather than
   * inferred from the guide's ball-count examples, 3 NECTAR + 3 POLLEN comes
   * to 195 g — 5 g short of the team-calibrated 200 g threshold. Recorded
   * honestly rather than forced to match: see `biobuzzDimensions.ts`'s file
   * banner. It takes a 4th POLLEN (220 g) to actually tip.
   */
  it('still does not tip on 3 NECTAR plus 3 POLLEN — 195 g falls 5 g short of the 200 g threshold', () => {
    const sim = build(pollenInCell(redUpCell(), 3));

    for (let i = 0; i < TIP_TICKS; i++) sim.step();

    expect(sim.tippers.tipCount('red-hive')).toBe(0);
    expect(sim.score.red).toBe(0);
  });

  it('tips the red HIVE on the 4th POLLEN (220 g), scores the tip, and feeds a reserve piece', () => {
    const sim = build(pollenInCell(redUpCell(), 4));
    expect(sim.tippers.tipCount('red-hive')).toBe(0);

    for (let i = 0; i < TIP_TICKS && sim.tippers.tipCount('red-hive') === 0; i++) sim.step();

    expect(sim.tippers.tipCount('red-hive')).toBe(1);
    expect(sim.tippers.currentUpRegionId('red-hive')).toBe(BIOBUZZ_REGIONS.redCellFar);
    expect(sim.score.red).toBe(20);
    // One reserve NECTAR should have been released toward the red LOADING ZONE.
    expect(sim.reserves.remaining('red-nectar-reserve')).toHaveLength(4);
  });

  it('tips on 8 POLLEN with no NECTAR, the guide\'s other calibration load', () => {
    // The guide's second calibration is a CELL holding "[8] Pollen + [0]
    // Nectar", so the staged 3 NECTAR are taken back out of red's up CELL
    // first — 8 * 25 g is exactly the calibrated 200 g threshold, and adding
    // them would be testing a different load. The reserve NECTAR (ids 4-8)
    // stay: a reserve feed holds them by id from tick zero.
    const withoutStagedNectar = stageBiobuzzPieces().filter(
      (piece) => !['nectar-red-1', 'nectar-red-2', 'nectar-red-3'].includes(piece.pieceId),
    );
    const sim = simulationFromDefinition(BIOBUZZ_GAME, {
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: new NeutralController(),
          alliance: 'red',
          startPose: BIOBUZZ_LEGAL_START_POSES.red,
        },
      ],
      pieces: [...withoutStagedNectar, ...pollenInCell(redUpCell(), 8)],
      field: createBiobuzzField(),
    });

    for (let i = 0; i < TIP_TICKS && sim.tippers.tipCount('red-hive') === 0; i++) sim.step();

    expect(sim.tippers.tipCount('red-hive')).toBe(1);
    expect(sim.tippers.currentUpRegionId('red-hive')).toBe(BIOBUZZ_REGIONS.redCellFar);
  });

  it('scores nothing at kickoff merely from the pre-staged layout', () => {
    // Priming makes the starting layout a baseline. In particular the 3
    // pre-loaded NECTAR weigh less than BIOBUZZ_HIVE_TIP_LOAD_LB, so no tip fires
    // on tick 1 either.
    const sim = build();
    sim.step();
    expect(sim.score.red).toBe(0);
    expect(sim.score.blue).toBe(0);
    expect(sim.tippers.tipCount('red-hive')).toBe(0);
    expect(sim.tippers.tipCount('blue-hive')).toBe(0);
  });

  /**
   * FLOWER ownership and the bottom bonus, run through the real column.
   *
   * Every piece here arrives the way a scored one does: dropped in through the
   * FLOWER's own top ring while descending, taken by `stackedColumn.ts`, and
   * stacked at the height the FLOWER's geometry puts it at. Nothing asserts
   * against a hand-built predicate context — the scores below come from the
   * real events, the real rule set and the real match clock.
   */
  const dropIntoFlower = (
    flowerId: string,
    entries: readonly { readonly pieceId: string; readonly pieceType: string }[],
  ) => {
    const region = BIOBUZZ_FIELD_REGIONS.find((r) => r.id === flowerId);
    if (region === undefined) throw new Error(`no region ${flowerId}`);
    return entries.map(({ pieceId, pieceType }) => ({
      pieceId,
      pieceType,
      diameterIn: pieceType === 'pollen' ? POLLEN_DIAMETER_IN.value : NECTAR_DIAMETER_IN.value,
      massLb: pieceType === 'pollen' ? POLLEN_MASS_LB.value : NECTAR_MASS_LB.value,
      startPositionM: region.centerM,
      // Just over the top ring, so ordinary gravity carries each one down
      // through the entry band rather than a test placing it in the column.
      heightM: inchesToMeters(FLOWER.topOpeningHeightIn.value + 1),
    }));
  };

  /** Run a whole match, so the ENDGAME-phase FLOWER rules are assessed. */
  const runToEnd = (extraPieces: ReturnType<typeof stageBiobuzzPieces>) => {
    const sim = build(extraPieces);
    sim.run();
    return sim;
  };

  it('stacks a FLOWER\'s pre-loaded POLLEN from the tiles up rather than piling them at one height', () => {
    const sim = build();
    sim.step();

    const contents = sim.columns.contents(`${BIOBUZZ_REGIONS.flowerNorth}-column`);
    expect(contents).toEqual(flowerPollenIds(BIOBUZZ_REGIONS.flowerNorth));

    const heights = contents.map(
      (pieceId) => sim.world.snapshot().pieces.find((piece) => piece.pieceId === pieceId)?.heightM ?? 0,
    );
    // 2.8 in balls from the tiles: centres at 1.4, 4.2, 7.0, 9.8 in.
    [1.4, 4.2, 7.0, 9.8].forEach((expectedIn, index) => {
      expect(heights[index]).toBeCloseTo(inchesToMeters(expectedIn), 6);
    });
  });

  it('drops a NECTAR in through the top ring and stacks it on the staged POLLEN', () => {
    const sim = runToEnd(
      dropIntoFlower(BIOBUZZ_REGIONS.flowerSouth, [{ pieceId: 'drop-red', pieceType: 'nectar-red' }]),
    );

    const stacked = sim.events.filter(
      (event) => event.kind === 'PieceStackedInColumn' && event.pieceId === 'drop-red',
    );
    expect(stacked.length).toBeGreaterThan(0);
    // Four staged POLLEN reach 11.2 in, which is already above the 3.95 in
    // sorter ring, so this NECTAR rests on them rather than on the ring:
    // 11.2 + 1.8 = 13 in. (The ring's own effect on a short column is
    // exercised season-blind in `stackedColumn.test.ts`.)
    expect((stacked[0] as { heightM: number }).heightM).toBeCloseTo(
      inchesToMeters(4 * POLLEN_DIAMETER_IN.value + NECTAR_DIAMETER_IN.value / 2),
      6,
    );
  });

  it('gives every scoring element to the alliance whose NECTAR is topmost, and the bonus to the lowest', () => {
    // Red goes in first (bottom), blue second (top): blue owns the FLOWER and
    // every element in the volume scores 2 for blue; red takes the 5-point
    // bottom bonus (§10.5.2).
    const sim = runToEnd(
      dropIntoFlower(BIOBUZZ_REGIONS.flowerEast, [
        { pieceId: 'drop-red', pieceType: 'nectar-red' },
        { pieceId: 'drop-blue', pieceType: 'nectar-blue' },
      ]),
    );

    const flowerAwards = sim.score.deltas.filter(
      (delta) => delta.ruleId === 'flower-owned' || delta.ruleId === 'bottom-nectar-bonus',
    );
    const sumFor = (alliance: 'red' | 'blue') =>
      flowerAwards
        .filter((delta) => delta.alliance === alliance)
        .reduce((total, delta) => total + delta.points, 0);

    // Five elements stand in the volume: the two NECTAR plus three of the
    // four staged POLLEN (the lowest sits below the 3.95 in ring). All five
    // score 2 apiece for blue, whoever put them there; red takes the flat
    // 5-point bottom bonus.
    expect(sumFor('blue')).toBe(10);
    expect(sumFor('red')).toBe(5);
  });

  it('lets a ROBOT draw the bottom POLLEN back out of a FLOWER', () => {
    // Retrieval needs no new driver action: the bottom POLLEN is the one the
    // real 3.55 in opening can pass, so the column puts it back in play at the
    // FLOWER's base and an ordinary intake takes it (G418's "only the bottom
    // most element" falls out of the geometry rather than out of a rule).
    const flowerId = BIOBUZZ_REGIONS.flowerWest;
    const flower = BIOBUZZ_FIELD_REGIONS.find((region) => region.id === flowerId);
    if (flower === undefined) throw new Error(`no region ${flowerId}`);

    const sim = simulationFromDefinition(BIOBUZZ_GAME, {
      robots: [
        {
          config: COMPETITION_ROBOT_CONFIG,
          controller: constantController(
            createControlInput(0, 0, 0, { [INTAKE_BUTTON]: true }),
          ),
          alliance: 'red',
          // Parked beside the FLOWER, facing it, so its mouth is over the base.
          startPose: { p: vec2(flower.centerM.x + inchesToMeters(11), flower.centerM.y), theta: Math.PI },
        },
      ],
      pieces: [...stageBiobuzzPieces()],
      field: createBiobuzzField(),
    });

    const columnId = `${flowerId}-column`;
    const staged = flowerPollenIds(flowerId);

    for (let i = 0; i < 200; i++) sim.step();

    // Taken from the bottom, one at a time: whatever is left is the top of the
    // original column, in the original order. The FLOWER's own 2/sec
    // chokepoint (`BIOBUZZ_INTAKE_THROTTLE_REGIONS`) is why a second of
    // driving does not simply empty it.
    const after = sim.columns.contents(columnId);
    const held = sim.world.snapshot().robots[0]?.mechanisms.held ?? [];
    expect(after.length).toBeLessThan(staged.length);
    expect(after).toEqual(staged.slice(staged.length - after.length));
    expect(held).toContain(staged[0]);
  });

  it('scores nothing for a FLOWER holding only POLLEN, however full it is', () => {
    const sim = runToEnd([]);

    const flowerAwards = sim.score.deltas.filter(
      (delta) => delta.ruleId === 'flower-owned' || delta.ruleId === 'bottom-nectar-bonus',
    );
    expect(flowerAwards).toEqual([]);
  });

  it('awards LEAVE once the robot is clear of every perimeter wall at the end of AUTO', () => {
    const sim = simulationFromDefinition(BIOBUZZ_GAME, {
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: new NeutralController(),
          alliance: 'red',
          // Not touching any wall.
          startPose: { p: vec2(0, 0), theta: 0 },
        },
      ],
      pieces: stageBiobuzzPieces(),
      field: createBiobuzzField(),
    });

    sim.advanceTo(30);
    const leaveAwards = sim.events.filter((e) => e.kind === 'PhaseChanged' || e.kind === 'RobotAssessed');
    expect(leaveAwards.length).toBeGreaterThan(0);
    expect(sim.score.red).toBeGreaterThanOrEqual(3);
  });

  it('does not let a ROBOT intake the opposing alliance\'s own NECTAR', () => {
    const entry = getGameEntry(BIOBUZZ_GAME.id);
    const controller = new LatchedController();
    const blueCell = BIOBUZZ_FIELD_REGIONS.find((r) => r.id === BIOBUZZ_REGIONS.blueCellNear)!;
    const sim = simulationFromDefinition(BIOBUZZ_GAME, {
      robots: [
        {
          config: entry.defaultRobotConfig,
          controller,
          alliance: 'red',
          startPose: { p: vec2(blueCell.centerM.x - inchesToMeters(6), blueCell.centerM.y), theta: 0 },
        },
      ],
      pieces: [
        ...stageBiobuzzPieces(),
        {
          pieceId: 'opponent-nectar',
          pieceType: 'nectar-blue',
          diameterIn: 3.6,
          massLb: 0.09,
          startPositionM: blueCell.centerM,
        },
      ],
      field: createBiobuzzField(),
    });

    controller.set({ drive: { x: 0, y: 0, turn: 0 }, buttons: { intake: true }, axes: {} });
    for (let tick = 0; tick < 300; tick++) sim.step();

    expect(sim.world.snapshot().robots[0]!.mechanisms.held).toEqual([]);
  });

  it('still lets a ROBOT intake its own alliance\'s NECTAR', () => {
    const entry = getGameEntry(BIOBUZZ_GAME.id);
    const controller = new LatchedController();
    const redCell = BIOBUZZ_FIELD_REGIONS.find((r) => r.id === BIOBUZZ_REGIONS.redCellNear)!;
    const sim = simulationFromDefinition(BIOBUZZ_GAME, {
      robots: [
        {
          config: entry.defaultRobotConfig,
          controller,
          alliance: 'red',
          startPose: { p: vec2(redCell.centerM.x - inchesToMeters(6), redCell.centerM.y), theta: 0 },
        },
      ],
      pieces: [
        ...stageBiobuzzPieces(),
        {
          pieceId: 'own-nectar',
          pieceType: 'nectar-red',
          diameterIn: 3.6,
          massLb: 0.09,
          startPositionM: redCell.centerM,
        },
      ],
      field: createBiobuzzField(),
    });

    controller.set({ drive: { x: 0, y: 0, turn: 0 }, buttons: { intake: true }, axes: {} });
    for (let tick = 0; tick < 300; tick++) sim.step();

    expect(sim.world.snapshot().robots[0]!.mechanisms.held).toEqual(['own-nectar']);
  });

  it('caps FLOWER intake at 2/sec regardless of the robot\'s own configured rate', () => {
    const entry = getGameEntry(BIOBUZZ_GAME.id);
    // A near-instant intake isolates the FLOWER's own zone cap.
    const fastRobot: typeof entry.defaultRobotConfig = {
      ...entry.defaultRobotConfig,
      mechanisms: entry.defaultRobotConfig.mechanisms.map((mechanism) => ({
        ...mechanism,
        capabilities: mechanism.capabilities.map((capability) =>
          capability.kind === 'acquire' ? { ...capability, acquisitionRatePerSec: 1000 } : capability,
        ),
      })),
    };
    const controller = new LatchedController();
    const flower = BIOBUZZ_FIELD_REGIONS.find((r) => r.id === BIOBUZZ_REGIONS.flowerNorth)!;
    const flowerXIn = flower.centerM.x / inchesToMeters(1);
    const flowerYIn = flower.centerM.y / inchesToMeters(1);

    // A minimal, uncontaminated piece list: just the two test balls at the
    // FLOWER, plus every id a reserve feed parks at construction (required
    // for any real BIOBUZZ match to build at all) parked well away from it.
    const reserveIds = [
      ...reserveNectarIds('red'),
      ...reserveNectarIds('blue'),
    ];
    const sim = simulationFromDefinition(BIOBUZZ_GAME, {
      robots: [
        {
          config: fastRobot,
          controller,
          alliance: 'red',
          startPose: { p: vec2(inchesToMeters(flowerXIn), inchesToMeters(flowerYIn - 10)), theta: Math.PI / 2 },
        },
      ],
      pieces: [
        ...reserveIds.map((pieceId, index) => ({
          pieceId,
          pieceType: `nectar-${pieceId.includes('red') ? 'red' : 'blue'}`,
          diameterIn: 3.6,
          massLb: 0.09,
          startPositionM: vec2(inchesToMeters(60), inchesToMeters(60 - index)),
        })),
        {
          pieceId: 'flower-a',
          pieceType: 'pollen',
          diameterIn: 2.8,
          massLb: 0.02,
          startPositionM: vec2(inchesToMeters(flowerXIn - 2), inchesToMeters(flowerYIn)),
        },
        {
          pieceId: 'flower-b',
          pieceType: 'pollen',
          diameterIn: 2.8,
          massLb: 0.02,
          startPositionM: vec2(inchesToMeters(flowerXIn + 2), inchesToMeters(flowerYIn)),
        },
      ],
      field: createBiobuzzField(),
    });

    controller.set({ drive: { x: 0, y: 0.15, turn: 0 }, buttons: { intake: true }, axes: {} });

    // Find the tick of the first capture. The near-instant intake would
    // otherwise take both balls on that very same tick.
    let firstCaptureTick = -1;
    for (let tick = 0; tick < 500 && firstCaptureTick === -1; tick++) {
      sim.step();
      if (sim.world.snapshot().robots[0]!.mechanisms.held.length > 0) firstCaptureTick = tick;
    }
    expect(firstCaptureTick).toBeGreaterThanOrEqual(0);
    expect(sim.world.snapshot().robots[0]!.mechanisms.held.length).toBe(1);

    // Just short of the zone's 0.5 s (2/sec) cooldown from that capture, the
    // second ball is still withheld even though the intake itself is instant.
    for (let tick = 0; tick < 90; tick++) sim.step();
    expect(sim.world.snapshot().robots[0]!.mechanisms.held.length).toBe(1);

    // Past the cooldown, the second ball is finally allowed.
    for (let tick = 0; tick < 20; tick++) sim.step();
    expect(sim.world.snapshot().robots[0]!.mechanisms.held.length).toBe(2);
  });
});

it('weighs POLLEN at 25 g, NECTAR at 40 g, and the HIVE tip load at 200 g', () => {
  // Team-measured values (`biobuzzDimensions.ts`), not derived from the setup
  // guide's ball-count examples — so the guide's own "[8] Pollen + [0] Nectar"
  // and "[3] Pollen + [3] Nectar" calibrations are no longer required to land
  // on exactly the same weight (200 g vs 195 g respectively). See
  // `biobuzzGame.test.ts`'s 195 g / 220 g tests for that in gameplay.
  const gramsToLb = (g: number) => g / 1000 / 0.45359237;

  expect(POLLEN_MASS_LB.value).toBeCloseTo(gramsToLb(25), 10);
  expect(NECTAR_MASS_LB.value).toBeCloseTo(gramsToLb(40), 10);
  expect(BIOBUZZ_HIVE_TIP_LOAD_LB.value).toBeCloseTo(gramsToLb(200), 10);
});

/**
 * The HIVE stands in the way of a shot fired through it.
 *
 * There is no "no-shoot zone" rule in BIOBUZZ and none is invented here: the
 * reason a ROBOT cannot score from behind the HIVE is that the HIVE is
 * physically there. Its baskets are declared as shot blockers
 * (`biobuzzAssemblies.ts`), so a piece crossing one on its way somewhere else
 * hits it — while the CELL a shot is actually aimed into never blocks its own
 * arrival, and nothing about a ROBOT or a resting piece changes at all.
 */
describe('shooting through the HIVE', () => {
  const cellCenter = (regionId: string) => {
    const region = BIOBUZZ_FIELD_REGIONS.find((r) => r.id === regionId);
    if (region === undefined) throw new Error(`no region ${regionId}`);
    return region.centerM;
  };

  /**
   * Fire one piece at the red near CELL from a given point and report how
   * close it ever came to that CELL.
   */
  const closestApproachToNearCell = (fromM: ReturnType<typeof cellCenter>) => {
    const target = cellCenter(BIOBUZZ_REGIONS.redCellNear);
    const world = new SimWorld({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: new NeutralController() }],
      pieces: [
        {
          pieceId: 'shot',
          pieceType: 'nectar-red',
          diameterIn: NECTAR_DIAMETER_IN.value,
          massLb: NECTAR_MASS_LB.value,
          startPositionM: fromM,
        },
      ],
      field: createBiobuzzField(),
    });

    world.launchPieceTowards(
      'shot',
      target,
      inchesToMeters(HIVE_FRAME.pivotHeightIn.value + 4),
      inchesToMeters(18),
    );

    let closest = Number.POSITIVE_INFINITY;
    for (let tick = 0; tick < 400; tick++) {
      world.step();
      const piece = world.snapshot().pieces[0];
      if (piece === undefined) break;
      closest = Math.min(closest, Math.hypot(piece.pose.p.x - target.x, piece.pose.p.y - target.y));
    }
    return closest;
  };

  it('lets a shot from the open side reach the CELL it is aimed at', () => {
    // Straight in from the audience side, with nothing between the shooter
    // and the near CELL.
    const from = vec2(cellCenter(BIOBUZZ_REGIONS.redCellNear).x, inchesToMeters(-60));
    expect(closestApproachToNearCell(from)).toBeLessThan(inchesToMeters(2));
  });

  it('stops a shot fired at the near CELL from behind the far one', () => {
    // Same alliance, same CELL, but lined up on the far side of the HIVE: the
    // far basket is now directly on the flight path.
    const from = vec2(cellCenter(BIOBUZZ_REGIONS.redCellFar).x, inchesToMeters(60));
    expect(closestApproachToNearCell(from)).toBeGreaterThan(inchesToMeters(6));
  });
});
