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
import { createDefaultRegistry, type PredicateContext } from '../predicates.js';
import { evaluateRules, createAwardState } from '../rulesEngine.js';
import { validateRegions } from '../regions.js';
import type { SimEvent } from '../events.js';
import { DEFAULT_ROBOT_CONFIG } from '../../robot/robotConfig.js';
import { NeutralController } from '../../control/controller.js';
import { inchesToMeters } from '../../units/convert.js';
import { vec2 } from '../../math/vec2.js';
import { BIOBUZZ_GAME } from './biobuzzGame.js';
import { createBiobuzzField } from './biobuzzCollision.js';
import { stageBiobuzzPieces } from './biobuzzStaging.js';
import { BIOBUZZ_REGIONS, BIOBUZZ_FIELD_REGIONS, BIOBUZZ_LEGAL_START_POSES } from './biobuzzField.js';
import {
  HIVE_CELL_REST_HEIGHT_IN,
  BIOBUZZ_HIVE_TIP_LOAD_LB,
  BIOBUZZ_TIPPING_STRUCTURES,
  BIOBUZZ_RULE_SET,
  BIOBUZZ_SETUP,
  BIOBUZZ_PIECES,
} from './biobuzz.js';
import { NECTAR_MASS_LB, POLLEN_DIAMETER_IN, POLLEN_MASS_LB } from './biobuzzDimensions.js';

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

    for (let i = 0; i < 40; i++) sim.step();

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

    for (let i = 0; i < 40; i++) sim.step();

    expect(sim.tippers.tipCount('red-hive')).toBe(0);
    expect(sim.score.red).toBe(0);
  });

  it('tips the red HIVE on the 4th POLLEN (220 g), scores the tip, and feeds a reserve piece', () => {
    const sim = build(pollenInCell(redUpCell(), 4));
    expect(sim.tippers.tipCount('red-hive')).toBe(0);

    for (let i = 0; i < 40 && sim.tippers.tipCount('red-hive') === 0; i++) sim.step();

    expect(sim.tippers.tipCount('red-hive')).toBe(1);
    expect(sim.tippers.currentUpRegionId('red-hive')).toBe(BIOBUZZ_REGIONS.redCellFar);
    expect(sim.score.red).toBe(20);
    // One reserve NECTAR should have been released toward the red LOADING ZONE.
    expect(sim.reserves.remaining('red-nectar-reserve')).toHaveLength(4);
  });

  it('tips on 8 POLLEN with no NECTAR, the guide\'s other calibration load', () => {
    // Only the up-facing CELL is weighed, and red's starts with the staged 3
    // NECTAR in it — so reaching the "[8] Pollen + [0] Nectar" case means
    // tipping once to bring the empty far CELL up, with 8 POLLEN waiting in it.
    // 8 * 25 g = 200 g, exactly the calibrated threshold.
    const sim = build([
      ...pollenInCell(redUpCell(), 4),
      ...pollenInCell(BIOBUZZ_REGIONS.redCellFar, 8).map((piece, index) => ({
        ...piece,
        pieceId: `far-pollen-${index}`,
      })),
    ]);

    for (let i = 0; i < 40 && sim.tippers.tipCount('red-hive') < 2; i++) sim.step();

    // Two tips: 3 NECTAR + 4 POLLEN, then 8 POLLEN alone.
    expect(sim.tippers.tipCount('red-hive')).toBe(2);
    expect(sim.tippers.currentUpRegionId('red-hive')).toBe(redUpCell());
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
   * FLOWER ownership and the bottom bonus, tested directly against the real
   * rule set rather than through full physics: this engine has no true 3D
   * stacking (see `BIOBUZZ_ELEVATED_REGIONS`'s doc comment), so "two pieces
   * resting in one FLOWER, one on top of the other" cannot be produced by
   * simulated flight without fighting the physics rather than testing the
   * rules. `regionContents`/`pieceTypeById` are exactly what the real
   * pipeline builds from a genuine arrival, so asserting against them
   * directly still proves this fixture's rule wiring (ids, filters,
   * conditions) end to end.
   */
  it('awards FLOWER ownership to whichever alliance arrived last, and the bottom bonus to whichever arrived first', () => {
    const registry = createDefaultRegistry();
    const awards = createAwardState();

    const restEvent = (pieceId: string, pieceType: string): SimEvent => ({
      kind: 'PieceCameToRest',
      tick: 30000,
      timeSec: 150,
      pieceId,
      pieceType,
      regionIds: [BIOBUZZ_REGIONS.flowerNorth],
    });

    // red-1 arrived first (bottom); blue-1 arrived second (top).
    const context: PredicateContext = {
      event: restEvent('red-1', 'nectar-red'),
      matchState: 'ENDGAME',
      regionSlots: {},
      regionContents: { [BIOBUZZ_REGIONS.flowerNorth]: ['red-1', 'blue-1'] },
      variables: {},
      robotsFullyInZone: {},
      robotsPartiallyInZone: {},
      pieceTypeById: { 'red-1': 'nectar-red', 'blue-1': 'nectar-blue' },
    };

    const sumByAlliance = (deltas: readonly { alliance: 'red' | 'blue'; points: number }[], alliance: 'red' | 'blue') =>
      deltas.filter((d) => d.alliance === alliance).reduce((total, d) => total + d.points, 0);

    const redRest = evaluateRules({
      rules: BIOBUZZ_RULE_SET,
      event: restEvent('red-1', 'nectar-red'),
      matchState: 'ENDGAME',
      registry,
      context,
      awards,
    });
    const blueRest = evaluateRules({
      rules: BIOBUZZ_RULE_SET,
      event: restEvent('blue-1', 'nectar-blue'),
      matchState: 'ENDGAME',
      registry,
      context: { ...context, event: restEvent('blue-1', 'nectar-blue') },
      awards,
    });

    const totalRed = sumByAlliance(redRest.deltas, 'red') + sumByAlliance(blueRest.deltas, 'red');
    const totalBlue = sumByAlliance(redRest.deltas, 'blue') + sumByAlliance(blueRest.deltas, 'blue');

    // Blue owns the FLOWER (topmost NECTAR): 2 pts for each of the 2 pieces
    // present, regardless of who placed them (§10.5.2). Red gets the bottom
    // bonus exactly once, since only its own rest event can be the region's
    // first arrival.
    expect(totalBlue).toBe(4);
    expect(totalRed).toBe(5);
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
