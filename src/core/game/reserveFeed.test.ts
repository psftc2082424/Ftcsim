/**
 * Reserve feeds, exercised on a made-up trigger with no season attached.
 */

import { describe, expect, it } from 'vitest';
import { ReserveFeeds, resolveReserveFeedPlaces, type ReserveFeedSpec, type ReserveFeedWorld } from './reserveFeed.js';
import { createRectZone } from './regions.js';
import { vec2, type Vec2 } from '../math/vec2.js';

const SPAWN = createRectZone({ id: 'spawn', centerXIn: 10, centerYIn: 0, widthIn: 10, lengthIn: 10 });

const SPEC: ReserveFeedSpec = {
  id: 'reserve',
  pieceIds: ['r1', 'r2', 'r3'],
  spawnZoneId: 'spawn',
  triggerStructureId: 'seesaw',
  perTriggerCount: 1,
  releaseAllAtState: 'ENDGAME',
};

class FakeWorld implements ReserveFeedWorld {
  readonly released: string[] = [];

  releasePieceMoving(pieceId: string, _positionM: Vec2, _velocityM: Vec2): void {
    this.released.push(pieceId);
  }
}

describe('ReserveFeeds', () => {
  it('releases nothing until the trigger fires', () => {
    const feeds = new ReserveFeeds([SPEC], resolveReserveFeedPlaces([SPEC], [SPAWN]));
    const world = new FakeWorld();
    feeds.update(() => 0, 'AUTO', world);
    expect(world.released).toEqual([]);
    expect(feeds.remaining('reserve')).toEqual(['r1', 'r2', 'r3']);
  });

  it('releases one reserve piece per new trigger count, in order', () => {
    const feeds = new ReserveFeeds([SPEC], resolveReserveFeedPlaces([SPEC], [SPAWN]));
    const world = new FakeWorld();

    feeds.update(() => 1, 'AUTO', world);
    expect(world.released).toEqual(['r1']);

    feeds.update(() => 1, 'AUTO', world);
    expect(world.released).toEqual(['r1']);

    feeds.update(() => 3, 'AUTO', world);
    expect(world.released).toEqual(['r1', 'r2', 'r3']);
    expect(feeds.remaining('reserve')).toEqual([]);
  });

  it('releases every remaining reserve piece once, at the declared match state', () => {
    const feeds = new ReserveFeeds([SPEC], resolveReserveFeedPlaces([SPEC], [SPAWN]));
    const world = new FakeWorld();

    feeds.update(() => 1, 'TELEOP', world);
    expect(world.released).toEqual(['r1']);

    feeds.update(() => 1, 'ENDGAME', world);
    expect(world.released).toEqual(['r1', 'r2', 'r3']);

    // Staying in ENDGAME does not release anything a second time.
    feeds.update(() => 1, 'ENDGAME', world);
    expect(world.released).toEqual(['r1', 'r2', 'r3']);
  });

  it('never releases more than the reserve holds', () => {
    const feeds = new ReserveFeeds([SPEC], resolveReserveFeedPlaces([SPEC], [SPAWN]));
    const world = new FakeWorld();

    feeds.update(() => 100, 'AUTO', world);
    expect(world.released).toEqual(['r1', 'r2', 'r3']);
  });
});

describe('resolveReserveFeedPlaces', () => {
  it('throws when a feed names a zone that does not exist', () => {
    expect(() => resolveReserveFeedPlaces([SPEC], [])).toThrow(/spawn/);
  });
});
