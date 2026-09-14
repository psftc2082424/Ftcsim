/**
 * Stacked columns, exercised on a made-up tube holding made-up "small" and
 * "large" balls — proves the engine has no idea what a FLOWER is.
 *
 * The made-up geometry deliberately mirrors the shape of the problem rather
 * than any season's numbers: a tube 1 m tall with a sorter ring at 0.2 m that
 * a 0.05 m-radius small ball passes and a 0.1 m-radius large one does not.
 */

import { describe, expect, it } from 'vitest';
import {
  StackedColumns,
  columnCapacity,
  inScoringBand,
  resolveColumnRegions,
  stackedPieces,
  stackTopM,
  type ColumnWorld,
  type StackedColumnSpec,
} from './stackedColumn.js';
import { createCircleRegion } from './regions.js';
import { vec2, type Vec2 } from '../math/vec2.js';
import type { WorldSnapshot } from '../sim/snapshot.js';

const TUBE = createCircleRegion({ id: 'tube', centerXIn: 0, centerYIn: 0, radiusIn: 4 });

const SMALL_R = 0.05;
const LARGE_R = 0.1;
const RING_M = 0.2;
const TOP_M = 1;

const SPEC: StackedColumnSpec = {
  id: 'tube-column',
  regionId: 'tube',
  entryRadiusM: 0.1,
  entryHeightM: TOP_M,
  entryMarginM: 0.08,
  floorHeightM: 0,
  scoringBandM: { bottomM: RING_M, topM: TOP_M },
  // Only the large ball is stopped by the ring; the small one falls past it.
  seatFloorMByPieceType: { large: RING_M },
  ownershipByPieceType: { 'large-red': 'red', 'large-blue': 'blue' },
  retrievablePieceTypes: ['small'],
};

/** A spec whose two owning types are also the ones the ring stops. */
const ALLIANCE_SPEC: StackedColumnSpec = {
  ...SPEC,
  seatFloorMByPieceType: { 'large-red': RING_M, 'large-blue': RING_M },
};

class FakeWorld implements ColumnWorld {
  readonly held = new Map<string, { positionM: Vec2; heightM: number }>();
  readonly released: string[] = [];
  readonly completedTransfers: string[] = [];

  holdPieceAt(pieceId: string, positionM: Vec2, heightM: number): void {
    this.held.set(pieceId, { positionM, heightM });
    const index = this.released.indexOf(pieceId);
    if (index >= 0) this.released.splice(index, 1);
  }

  releasePiece(pieceId: string): void {
    this.held.delete(pieceId);
    if (!this.released.includes(pieceId)) this.released.push(pieceId);
  }

  completePieceTransfer(pieceId: string): void {
    this.completedTransfers.push(pieceId);
  }
}

interface FakePiece {
  readonly pieceType: string;
  readonly radiusM: number;
  readonly at?: Vec2;
  readonly heightM?: number;
  readonly verticalVelocityMps?: number;
  readonly heldByRobotId?: number | null;
  readonly transferring?: boolean;
}

function snapshot(pieces: ReadonlyMap<string, FakePiece>): WorldSnapshot {
  return {
    tick: 0,
    timeSec: 0,
    batteryVolts: 12,
    batteryCurrentA: 0,
    robots: [],
    pieces: [...pieces].map(([pieceId, piece], index) => ({
      id: 100 + index,
      pieceId,
      pieceType: piece.pieceType,
      pose: { p: piece.at ?? vec2(0, 0), theta: 0 },
      previousPose: { p: piece.at ?? vec2(0, 0), theta: 0 },
      vel: { v: vec2(0, 0), omega: 0 },
      radiusM: piece.radiusM,
      massKg: 0.04,
      heightM: piece.heightM ?? piece.radiusM,
      previousHeightM: piece.heightM ?? piece.radiusM,
      verticalVelocityMps: piece.verticalVelocityMps ?? 0,
      airborne: false,
      ...(piece.transferring === undefined ? {} : { transferring: piece.transferring }),
      heldByRobotId: piece.heldByRobotId ?? null,
    })),
  };
}

const small = (): FakePiece => ({ pieceType: 'small', radiusM: SMALL_R });
const large = (type = 'large'): FakePiece => ({ pieceType: type, radiusM: LARGE_R });

/** A piece arriving through the mouth: on centre, at the ring, descending. */
const arriving = (piece: FakePiece): FakePiece => ({
  ...piece,
  heightM: TOP_M,
  verticalVelocityMps: -1,
});

const regions = resolveColumnRegions([SPEC], [TUBE]);

describe('stackedPieces', () => {
  it('rests each piece on the one below it', () => {
    const stacked = stackedPieces(SPEC, [
      { pieceId: 'a', pieceType: 'small', radiusM: SMALL_R },
      { pieceId: 'b', pieceType: 'small', radiusM: SMALL_R },
    ]);

    expect(stacked.map((piece) => piece.centerHeightM)).toEqual([SMALL_R, SMALL_R * 3]);
  });

  it('seats a piece the ring stops on the ring, however short the column below it', () => {
    // The single load-bearing rule: a large ball over an empty column, and one
    // over a single small ball, both land on the ring — so it is never below
    // the scoring band however little is underneath it.
    const overEmpty = stackedPieces(SPEC, [{ pieceId: 'a', pieceType: 'large', radiusM: LARGE_R }]);
    const overSmall = stackedPieces(SPEC, [
      { pieceId: 'a', pieceType: 'small', radiusM: SMALL_R },
      { pieceId: 'b', pieceType: 'large', radiusM: LARGE_R },
    ]);

    expect(overEmpty[0]?.centerHeightM).toBeCloseTo(RING_M + LARGE_R, 9);
    expect(overSmall[1]?.centerHeightM).toBeCloseTo(RING_M + LARGE_R, 9);
  });

  it('advances the column from the seated top, not past what a piece skipped', () => {
    // Anything on top of a ring-seated piece starts at that piece's own top.
    // Advancing from the old column top instead would leave a gap the size of
    // whatever clearance the ring gave it.
    const stacked = stackedPieces(SPEC, [
      { pieceId: 'a', pieceType: 'large', radiusM: LARGE_R },
      { pieceId: 'b', pieceType: 'small', radiusM: SMALL_R },
    ]);

    expect(stacked[1]?.centerHeightM).toBeCloseTo(RING_M + LARGE_R * 2 + SMALL_R, 9);
    expect(stackTopM(SPEC, stacked)).toBeCloseTo(RING_M + LARGE_R * 2 + SMALL_R * 2, 9);
  });
});

describe('inScoringBand', () => {
  it('counts a piece that only partly reaches into the band', () => {
    expect(inScoringBand(SPEC, RING_M - SMALL_R / 2, SMALL_R)).toBe(true);
  });

  it('excludes one entirely below it', () => {
    expect(inScoringBand(SPEC, SMALL_R, SMALL_R)).toBe(false);
  });
});

describe('columnCapacity', () => {
  it('fills by the stacking rule rather than by dividing the height', () => {
    // Small balls run floor to ring-free: seats at 0, 0.1, 0.2 ... and the
    // last one that fits seats below 1 m.
    expect(columnCapacity(SPEC, 'small', SMALL_R)).toBe(10);
  });

  it('charges a ring-stopped type for the clearance it cannot use', () => {
    // Large balls seat at 0.2, 0.4, 0.6, 0.8 — four, where dividing 1 m by a
    // 0.2 m diameter would have said five. A capacity helper with its own copy
    // of the stacking rule would go on saying five.
    expect(columnCapacity(SPEC, 'large', LARGE_R)).toBe(4);
  });
});

describe('StackedColumns', () => {
  it('takes in a descending piece arriving through the mouth', () => {
    const columns = new StackedColumns([SPEC]);
    const world = new FakeWorld();

    columns.update(regions, snapshot(new Map([['a', arriving(small())]])), world);

    expect(columns.contents('tube-column')).toEqual(['a']);
  });

  it('ignores a piece rolling past the base at floor height', () => {
    const columns = new StackedColumns([SPEC]);
    const world = new FakeWorld();

    columns.update(regions, snapshot(new Map([['a', small()]])), world);

    expect(columns.contents('tube-column')).toEqual([]);
  });

  it('ignores a piece rising through the mouth rather than dropping into it', () => {
    const columns = new StackedColumns([SPEC]);
    const world = new FakeWorld();
    const rising: FakePiece = { ...small(), heightM: TOP_M, verticalVelocityMps: 1 };

    columns.update(regions, snapshot(new Map([['a', rising]])), world);

    expect(columns.contents('tube-column')).toEqual([]);
  });

  it('ignores a descending piece that is off to one side of the mouth', () => {
    const columns = new StackedColumns([SPEC]);
    const world = new FakeWorld();
    const offCentre: FakePiece = { ...arriving(small()), at: vec2(0.5, 0) };

    columns.update(regions, snapshot(new Map([['a', offCentre]])), world);

    expect(columns.contents('tube-column')).toEqual([]);
  });

  it('refuses a piece once the column is full to its entry ring', () => {
    const columns = new StackedColumns([SPEC]);
    const world = new FakeWorld();
    const full = new Map<string, FakePiece>();
    for (let index = 0; index < 12; index++) full.set(`p${index}`, arriving(small()));

    columns.update(regions, snapshot(full), world);

    expect(columns.contents('tube-column')).toHaveLength(columnCapacity(SPEC, 'small', SMALL_R));
  });

  it('ends the protected flight of a shot it has caught', () => {
    const columns = new StackedColumns([SPEC]);
    const world = new FakeWorld();

    columns.update(
      regions,
      snapshot(new Map([['shot', { ...arriving(small()), transferring: true }]])),
      world,
    );

    expect(world.completedTransfers).toEqual(['shot']);
  });

  it('claims its declared starting contents before anything else can', () => {
    const staged: StackedColumnSpec = { ...SPEC, initialPieceIds: ['s0', 's1'] };
    const columns = new StackedColumns([staged]);
    const world = new FakeWorld();

    columns.update(
      resolveColumnRegions([staged], [TUBE]),
      snapshot(new Map([['s0', small()], ['s1', small()]])),
      world,
    );

    expect(columns.contents('tube-column')).toEqual(['s0', 's1']);
    // The bottom one is retrievable, so it is presented rather than parked;
    // the one above it is held at its stacked height.
    expect(world.released).toEqual(['s0']);
    expect(world.held.get('s1')?.heightM).toBeCloseTo(SMALL_R * 3, 9);
  });

  it('presents the bottom piece for retrieval only when its type can pass the opening', () => {
    const columns = new StackedColumns([SPEC]);
    const world = new FakeWorld();
    const locked: StackedColumnSpec = { ...SPEC, initialPieceIds: ['blocker', 'above'] };
    const lockedColumns = new StackedColumns([locked]);
    const lockedWorld = new FakeWorld();

    columns.update(regions, snapshot(new Map([['a', arriving(small())]])), world);
    expect(world.released).toEqual(['a']);

    // A large piece at the bottom is wider than the retrieval opening, so it
    // is parked like the rest and nothing in the column can come out.
    lockedColumns.update(
      resolveColumnRegions([locked], [TUBE]),
      snapshot(new Map([['blocker', large()], ['above', small()]])),
      lockedWorld,
    );
    expect(lockedWorld.released).toEqual([]);
    expect(lockedWorld.held.has('blocker')).toBe(true);
  });

  it('lets go of a piece a robot has taken, and re-presents the next one', () => {
    const staged: StackedColumnSpec = { ...SPEC, initialPieceIds: ['s0', 's1'] };
    const columns = new StackedColumns([staged]);
    const places = resolveColumnRegions([staged], [TUBE]);
    const world = new FakeWorld();

    columns.update(places, snapshot(new Map([['s0', small()], ['s1', small()]])), world);
    columns.update(
      places,
      snapshot(new Map([['s0', { ...small(), heldByRobotId: 0 }], ['s1', small()]])),
      world,
    );

    // The taken piece is gone from the column, and the one above it has
    // become the new bottom — presented for retrieval in its turn rather than
    // still parked at the height it had while something was underneath it.
    expect(columns.contents('tube-column')).toEqual(['s1']);
    expect(world.released).toContain('s1');
    expect(world.held.has('s1')).toBe(false);
  });
});

describe('StackedColumns.assess', () => {
  const places = resolveColumnRegions([ALLIANCE_SPEC], [TUBE]);

  const load = (columns: StackedColumns, pieces: ReadonlyMap<string, FakePiece>, world: FakeWorld) => {
    // One arrival per update, against a snapshot that grows: stack order is
    // the order the caller wrote them in, and a piece already taken stays in
    // the world so the column does not drop it again next tick.
    const present = new Map<string, FakePiece>();
    for (const [id, piece] of pieces) {
      present.set(id, arriving(piece));
      columns.update(places, snapshot(present), world);
      present.set(id, piece);
    }
    return snapshot(present);
  };

  it('gives the column\'s ownership to its highest owning piece and the bonus to its lowest', () => {
    const columns = new StackedColumns([ALLIANCE_SPEC]);
    const world = new FakeWorld();
    const resting = load(
      columns,
      new Map([['red', large('large-red')], ['blue', large('large-blue')]]),
      world,
    );

    const events = columns.assess(places, resting, 10, 0.05);
    const stacked = events.filter((event) => event.kind === 'PieceStackedInColumn');
    const assessed = events.find((event) => event.kind === 'ColumnAssessed');

    // Red went in first, so blue is on top and owns every element; red, at the
    // bottom, takes the separate bonus.
    expect(stacked).toHaveLength(2);
    expect(stacked.every((event) => 'alliance' in event && event.alliance === 'blue')).toBe(true);
    expect(assessed).toMatchObject({ scoringCount: 2, alliance: 'red' });
  });

  it('leaves a column with no owning piece unowned, so no rule can award for it', () => {
    const columns = new StackedColumns([ALLIANCE_SPEC]);
    const world = new FakeWorld();
    const resting = load(columns, new Map([['a', small()], ['b', small()]]), world);

    const events = columns.assess(places, resting, 10, 0.05);
    const assessed = events.find((event) => event.kind === 'ColumnAssessed');

    for (const event of events.filter((candidate) => candidate.kind === 'PieceStackedInColumn')) {
      expect('alliance' in event && event.alliance).toBeFalsy();
    }
    expect(assessed !== undefined && 'alliance' in assessed && assessed.alliance).toBeFalsy();
  });

  it('omits a piece that sits entirely below the scoring band', () => {
    const columns = new StackedColumns([ALLIANCE_SPEC]);
    const world = new FakeWorld();
    // One small ball resting on the floor tops out at 0.1 m, below the 0.2 m
    // band; the ring-seated large one above it is inside.
    const resting = load(columns, new Map([['low', small()], ['high', large('large-red')]]), world);

    const events = columns.assess(places, resting, 10, 0.05);
    const stacked = events.filter((event) => event.kind === 'PieceStackedInColumn');

    expect(stacked.map((event) => (event as { pieceId: string }).pieceId)).toEqual(['high']);
  });
});

describe('resolveColumnRegions', () => {
  it('throws when a spec names a region that does not exist', () => {
    expect(() => resolveColumnRegions([SPEC], [])).toThrow(/tube/);
  });
});
