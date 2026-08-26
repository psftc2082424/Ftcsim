/**
 * The starting field: 24 ARTIFACTS where §10.3.1 and the setup guide put them.
 *
 * The composition was transcribed long before anything could place it, so these
 * assert that the two halves agree — the manual's counts and colour order
 * against the guide's coordinates.
 */

import { describe, expect, it } from 'vitest';
import { DECODE_PIECES_OFF_FIELD, stageDecodePieces } from './decodeStaging.js';
import { DECODE_REGIONS, DECODE_SETUP, DECODE_ZONES, spikeMarkIds } from './decode.js';
import { DECODE_FIELD_REGIONS, DECODE_FIELD_ZONES } from './decodeField.js';
import { ARTIFACT, FIELD } from './decodeDimensions.js';
import { totalStagedPieces } from '../gameDefinition.js';
import { regionContains } from '../regions.js';
import { inchesToMeters } from '../../units/convert.js';
import { SimWorld } from '../../sim/simWorld.js';
import { NeutralController } from '../../control/controller.js';
import { DEFAULT_ROBOT_CONFIG } from '../../robot/robotConfig.js';
import { vec2 } from '../../math/vec2.js';

const staged = stageDecodePieces();
const HALF_FIELD_M = inchesToMeters(FIELD.sideIn.value / 2);

const countByType = (pieces: readonly { pieceType: string }[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const piece of pieces) counts[piece.pieceType] = (counts[piece.pieceType] ?? 0) + 1;
  return counts;
};

const idsStartingWith = (prefix: string) => staged.filter((p) => p.pieceId.startsWith(prefix));

describe('what starts on the field', () => {
  it('stages three ARTIFACTS on each SPIKE MARK and three per LOADING ZONE', () => {
    expect(staged).toHaveLength(6 * 3 + 2 * 3);
    expect(idsStartingWith('spike-')).toHaveLength(18);
    expect(idsStartingWith('loading-')).toHaveLength(6);
  });

  /**
   * The 12 in the ALLIANCE AREAS are outside the perimeter, so they are counted
   * rather than placed — and 24 + 12 has to be the 36 the game declares.
   */
  it('accounts for every ARTIFACT the game has', () => {
    const declared = totalStagedPieces(DECODE_SETUP);
    const total = Object.values(declared).reduce((sum, n) => sum + n, 0);

    expect(total).toBe(ARTIFACT.purpleCount.value + ARTIFACT.greenCount.value);
    expect(staged.length + DECODE_PIECES_OFF_FIELD).toBe(total);
  });

  it('gives every piece a distinct id', () => {
    expect(new Set(staged.map((p) => p.pieceId)).size).toBe(staged.length);
  });

  it('uses the ARTIFACT diameter and the sourced mass', () => {
    for (const piece of staged) {
      expect(piece.diameterIn).toBe(ARTIFACT.specifiedDiameterIn.value);
      expect(piece.massLb).toBe(0.165);
    }
  });
});

describe('where they start', () => {
  it('keeps every ARTIFACT inside the perimeter', () => {
    for (const piece of staged) {
      const p = piece.startPositionM;
      expect(p).toBeDefined();
      if (p === undefined) continue;
      expect(Math.abs(p.x)).toBeLessThan(HALF_FIELD_M);
      expect(Math.abs(p.y)).toBeLessThan(HALF_FIELD_M);
    }
  });

  it('puts a triple on each SPIKE MARK, with the middle one on the mark', () => {
    for (const alliance of ['red', 'blue'] as const) {
      spikeMarkIds(alliance).forEach((markId, markIndex) => {
        const mark = DECODE_FIELD_REGIONS.find((r) => r.id === markId);
        expect(mark, markId).toBeDefined();
        if (mark === undefined) return;

        const triple = idsStartingWith(`spike-${alliance}-${markIndex}-`);
        expect(triple).toHaveLength(3);

        const middle = triple[1]?.startPositionM;
        expect(middle).toBeDefined();
        if (middle !== undefined) expect(regionContains(mark, middle)).toBe(true);
      });
    }
  });

  /**
   * §10.3.1: "Near (audience side): GPP, Middle: PGP, Far (GOAL side): PPG",
   * read "starting from the middle of the FIELD and continuing toward the FIELD
   * perimeter" — so each triple reads inboard first.
   */
  it('arranges each SPIKE MARK triple inboard first', () => {
    const arrangements = ['GPP', 'PGP', 'PPG'];

    for (const alliance of ['red', 'blue'] as const) {
      arrangements.forEach((expected, markIndex) => {
        const triple = idsStartingWith(`spike-${alliance}-${markIndex}-`);
        expect(triple.map((p) => p.pieceType).join('')).toBe(expected);

        // Slot 0 is nearest the centre line, slot 2 nearest the wall.
        const xs = triple.map((p) => Math.abs(p.startPositionM?.x ?? 0));
        expect(xs[0]).toBeLessThan(xs[2] as number);
      });
    }
  });

  /** "3 ARTIFACTS (2P, 1G) in each LOADING ZONE ... arranged PGP". */
  it('arranges each LOADING ZONE trio PGP, starting inside the zone', () => {
    for (const alliance of ['red', 'blue'] as const) {
      const trio = idsStartingWith(`loading-${alliance}-`);

      expect(trio.map((p) => p.pieceType).join('')).toBe('PGP');
      expect(countByType(trio)).toEqual({ P: 2, G: 1 });

      const zoneId =
        alliance === 'red' ? DECODE_ZONES.redLoadingZone : DECODE_ZONES.blueLoadingZone;
      const zone = DECODE_FIELD_ZONES.find((z) => z.id === zoneId);
      expect(zone, zoneId).toBeDefined();
      if (zone === undefined) continue;

      const first = trio[0]?.startPositionM;
      if (first !== undefined) expect(regionContains(zone, first)).toBe(true);
    }
  });

  it('mirrors the two alliances', () => {
    for (const piece of staged.filter((p) => p.pieceId.includes('-red-'))) {
      const twinId = piece.pieceId.replace('-red-', '-blue-');
      const twin = staged.find((p) => p.pieceId === twinId);

      expect(twin, twinId).toBeDefined();
      if (twin === undefined) continue;
      expect(twin.pieceType).toBe(piece.pieceType);
      expect(twin.startPositionM?.x).toBeCloseTo(-(piece.startPositionM?.x ?? 0), 9);
      expect(twin.startPositionM?.y).toBeCloseTo(piece.startPositionM?.y ?? 0, 9);
    }
  });
});

describe('the staged field settles', () => {
  const stagedWorld = () =>
    new SimWorld({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: new NeutralController(),
          startPose: { p: vec2(0, 0), theta: 0 },
        },
      ],
      pieces: staged,
      seed: 1,
    });

  /**
   * Twenty-four bodies placed a diameter apart start in contact. If the layout
   * were wrong they would shove each other across the field, so the check is
   * that nothing travels far and nothing leaves.
   */
  it('holds its layout when the world runs', () => {
    const world = stagedWorld();
    world.stepMany(400);

    for (const piece of world.snapshot().pieces) {
      const start = staged.find((s) => s.pieceId === piece.pieceId)?.startPositionM;
      expect(start, piece.pieceId).toBeDefined();
      if (start === undefined) continue;

      expect(Math.hypot(piece.pose.p.x - start.x, piece.pose.p.y - start.y)).toBeLessThan(
        inchesToMeters(6),
      );
      expect(Math.abs(piece.pose.p.x)).toBeLessThan(HALF_FIELD_M);
      expect(Math.abs(piece.pose.p.y)).toBeLessThan(HALF_FIELD_M);
    }
  });

  it('starts every ARTIFACT on the floor, not in the air', () => {
    for (const piece of stagedWorld().snapshot().pieces) {
      expect(piece.airborne).toBe(false);
      expect(piece.heightM).toBeCloseTo(piece.radiusM, 9);
    }
  });

  /** Nothing may start inside a GOAL and score before the match begins. */
  it('starts no ARTIFACT already in a GOAL', () => {
    for (const goalId of [DECODE_REGIONS.redGoal, DECODE_REGIONS.blueGoal]) {
      const goal = DECODE_FIELD_REGIONS.find((r) => r.id === goalId);
      expect(goal, goalId).toBeDefined();
      if (goal === undefined) continue;

      const restingHeightM = inchesToMeters(ARTIFACT.specifiedDiameterIn.value / 2);
      for (const piece of staged) {
        const p = piece.startPositionM;
        if (p === undefined) continue;
        expect(regionContains(goal, p, restingHeightM)).toBe(false);
      }
    }
  });
});
