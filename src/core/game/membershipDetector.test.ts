import { describe, expect, it } from 'vitest';
import {
  RegionMembershipDetector,
  occupancyFor,
  type Observation,
  type PieceObservation,
  type RobotObservation,
} from './membershipDetector.js';
import { createRectRegion, createRectZone } from './regions.js';
import { compareEvents, type SimEvent } from './events.js';
import { vec2 } from '../math/vec2.js';
import { createObb } from '../physics/shapes.js';
import { inchesToMeters } from '../units/convert.js';

const DT = 1 / 200;
const at = (xIn: number, yIn: number) => vec2(inchesToMeters(xIn), inchesToMeters(yIn));

/** Two 12 in goals, plus a 48 in area enclosing both, to exercise nesting. */
const goal = createRectRegion({ id: 'goal', centerXIn: 24, centerYIn: 0, widthIn: 12, lengthIn: 12 });
const farGoal = createRectRegion({
  id: 'far-goal',
  centerXIn: -24,
  centerYIn: 0,
  widthIn: 12,
  lengthIn: 12,
});
const arena = createRectRegion({
  id: 'arena',
  centerXIn: 0,
  centerYIn: 0,
  widthIn: 96,
  lengthIn: 96,
});
const raised = createRectRegion({
  id: 'high-goal',
  centerXIn: 24,
  centerYIn: 0,
  widthIn: 12,
  lengthIn: 12,
  bottomIn: 30,
});

const base = createRectZone({ id: 'base', centerXIn: 0, centerYIn: 0, widthIn: 36, lengthIn: 36 });
const ROBOT = createObb(inchesToMeters(18), inchesToMeters(18));

const detector = (regions = [goal, farGoal], zones = [base]) =>
  new RegionMembershipDetector({ regions, zones, dtSec: DT });

const piece = (xIn: number, yIn: number, patch: Partial<PieceObservation> = {}): PieceObservation => ({
  pieceId: 'p1',
  pieceType: 'purple',
  positionM: at(xIn, yIn),
  ...patch,
});

const robot = (xIn: number, yIn: number, patch: Partial<RobotObservation> = {}): RobotObservation => ({
  robotId: 'r1',
  alliance: 'red',
  shape: ROBOT,
  positionM: at(xIn, yIn),
  headingRad: 0,
  ...patch,
});

const kinds = (events: readonly SimEvent[]) => events.map((e) => e.kind);
const regionIdsIn = (events: readonly SimEvent[]) =>
  events.map((e) => ('regionId' in e ? e.regionId : 'zoneId' in e ? e.zoneId : '?'));

describe('piece transitions', () => {
  it('emits nothing for a piece that never enters anything', () => {
    const d = detector();
    expect(d.update({ pieces: [piece(60, 60)] }, 1)).toEqual([]);
  });

  it('emits an entry when a piece arrives', () => {
    const d = detector();
    d.update({ pieces: [piece(60, 0)] }, 1);

    const events = d.update({ pieces: [piece(24, 0)] }, 2);
    expect(kinds(events)).toEqual(['PieceEnteredRegion']);
    expect(regionIdsIn(events)).toEqual(['goal']);
  });

  /** A piece resting in a goal for a hundred ticks must score once, not a hundred times. */
  it('stays silent while a piece remains inside', () => {
    const d = detector();
    expect(d.update({ pieces: [piece(24, 0)] }, 1)).toHaveLength(1);

    for (let tick = 2; tick < 100; tick++) {
      expect(d.update({ pieces: [piece(24, 0)] }, tick)).toEqual([]);
    }
  });

  it('emits an exit when a piece leaves', () => {
    const d = detector();
    d.update({ pieces: [piece(24, 0)] }, 1);

    const events = d.update({ pieces: [piece(60, 0)] }, 2);
    expect(kinds(events)).toEqual(['PieceExitedRegion']);
    expect(regionIdsIn(events)).toEqual(['goal']);
  });

  it('emits both sides of a move between regions on one tick', () => {
    const d = detector();
    d.update({ pieces: [piece(24, 0)] }, 1);

    const events = d.update({ pieces: [piece(-24, 0)] }, 2);
    expect(kinds(events)).toEqual(['PieceEnteredRegion', 'PieceExitedRegion']);
    expect(regionIdsIn(events)).toEqual(['far-goal', 'goal']);
  });

  it('treats a piece first seen inside a region as having entered', () => {
    const d = detector();
    const events = d.update({ pieces: [piece(24, 0)] }, 1);
    expect(kinds(events)).toEqual(['PieceEnteredRegion']);
  });

  /**
   * Pieces pre-placed at match start are already in their regions. Treating that
   * as a scoring transition would award points for the setup crew.
   */
  it('primes an initial position without emitting', () => {
    const d = detector();
    d.prime({ pieces: [piece(24, 0)] });

    expect(d.update({ pieces: [piece(24, 0)] }, 1)).toEqual([]);
    expect(d.regionsOf('p1')).toEqual(['goal']);

    // Leaving afterwards is still a real transition.
    expect(kinds(d.update({ pieces: [piece(60, 0)] }, 2))).toEqual(['PieceExitedRegion']);
  });

  it('carries attribution through to the event', () => {
    const d = detector();
    const events = d.update(
      { pieces: [piece(24, 0, { byRobotId: 'r1', byAlliance: 'blue' })] },
      5,
    );

    const [event] = events;
    expect(event?.kind).toBe('PieceEnteredRegion');
    if (event?.kind !== 'PieceEnteredRegion') return;
    expect(event.byRobotId).toBe('r1');
    expect(event.byAlliance).toBe('blue');
    expect(event.pieceType).toBe('purple');
  });

  it('derives timeSec from the tick, never a clock', () => {
    const d = detector();
    const [event] = d.update({ pieces: [piece(24, 0)] }, 400);
    expect(event?.tick).toBe(400);
    expect(event?.timeSec).toBeCloseTo(2, 12);
  });

  it('rejects a non-integer or negative tick', () => {
    const d = detector();
    expect(() => d.update({}, 1.5)).toThrow(/non-negative integer/);
    expect(() => d.update({}, -1)).toThrow(/non-negative integer/);
  });
});

describe('multiple and nested regions', () => {
  it('reports every region a piece enters at once', () => {
    const d = detector([arena, goal]);
    const events = d.update({ pieces: [piece(24, 0)] }, 1);

    expect(kinds(events)).toEqual(['PieceEnteredRegion', 'PieceEnteredRegion']);
    expect(regionIdsIn(events).sort()).toEqual(['arena', 'goal']);
  });

  /** Moving out of a goal but staying in the arena exits only the goal. */
  it('exits only the regions actually left', () => {
    const d = detector([arena, goal]);
    d.update({ pieces: [piece(24, 0)] }, 1);

    const events = d.update({ pieces: [piece(40, 0)] }, 2);
    expect(kinds(events)).toEqual(['PieceExitedRegion']);
    expect(regionIdsIn(events)).toEqual(['goal']);
    expect(d.regionsOf('p1')).toEqual(['arena']);
  });

  it('respects vertical spans', () => {
    const d = detector([raised]);
    // On the floor beneath a raised goal: not in it.
    expect(d.update({ pieces: [piece(24, 0)] }, 1)).toEqual([]);

    const lifted = d.update(
      { pieces: [piece(24, 0, { heightM: inchesToMeters(36) })] },
      2,
    );
    expect(kinds(lifted)).toEqual(['PieceEnteredRegion']);

    // Falling back to the floor leaves it.
    expect(kinds(d.update({ pieces: [piece(24, 0)] }, 3))).toEqual(['PieceExitedRegion']);
  });

  it('counts the boundary as inside, matching regions.ts', () => {
    const d = detector();
    // The goal spans 18–30 in; exactly 18 is inside.
    expect(kinds(d.update({ pieces: [piece(18, 0)] }, 1))).toEqual(['PieceEnteredRegion']);
    expect(d.update({ pieces: [piece(18, 0)] }, 2)).toEqual([]);
  });
});

describe('pieces leaving play', () => {
  /** The snapshot is complete: anything previously seen and now absent is gone. */
  it('exits everything a vanished piece was in', () => {
    const d = detector([arena, goal]);
    d.update({ pieces: [piece(24, 0)] }, 1);

    const events = d.update({ pieces: [] }, 2);
    expect(kinds(events)).toEqual(['PieceExitedRegion', 'PieceExitedRegion']);
    expect(regionIdsIn(events).sort()).toEqual(['arena', 'goal']);
    expect(d.regionsOf('p1')).toEqual([]);
  });

  it('says nothing about a vanished piece that was in no region', () => {
    const d = detector();
    d.update({ pieces: [piece(60, 60)] }, 1);
    expect(d.update({ pieces: [] }, 2)).toEqual([]);
  });

  it('treats a returning piece as a fresh arrival', () => {
    const d = detector();
    d.update({ pieces: [piece(24, 0)] }, 1);
    d.update({ pieces: [] }, 2);
    expect(kinds(d.update({ pieces: [piece(24, 0)] }, 3))).toEqual(['PieceEnteredRegion']);
  });
});

describe('robot zone occupancy', () => {
  it('buckets support exactly as the runner does', () => {
    expect(occupancyFor(0)).toBe('outside');
    expect(occupancyFor(0.25)).toBe('partial');
    expect(occupancyFor(0.75)).toBe('partial');
    expect(occupancyFor(1)).toBe('full');
  });

  it('emits an entry when a robot arrives fully inside', () => {
    const d = detector();
    d.update({ robots: [robot(80, 0)] }, 1);

    const events = d.update({ robots: [robot(0, 0)] }, 2);
    expect(kinds(events)).toEqual(['RobotEnteredZone']);

    const [event] = events;
    if (event?.kind !== 'RobotEnteredZone') return;
    expect(event.zoneId).toBe('base');
    expect(event.alliance).toBe('red');
    expect(event.supportFraction).toBe(1);
    expect(d.occupancyOfRobot('r1', 'base')).toBe('full');
  });

  it('stays silent while occupancy is unchanged', () => {
    const d = detector();
    d.update({ robots: [robot(0, 0)] }, 1);
    for (let tick = 2; tick < 50; tick++) {
      expect(d.update({ robots: [robot(0, 0)] }, tick)).toEqual([]);
    }
  });

  /**
   * The bucket, not the raw fraction, is what the rules can observe — so a
   * partial-to-full change is a transition and must be reported, while drift
   * within a bucket is not.
   */
  it('reports a change of occupancy bucket without leaving', () => {
    const d = detector();
    // Zone spans -18..18 in; a robot at 18 in has half its corners inside.
    d.update({ robots: [robot(18, 0)] }, 1);
    expect(d.occupancyOfRobot('r1', 'base')).toBe('partial');

    const events = d.update({ robots: [robot(0, 0)] }, 2);
    expect(kinds(events)).toEqual(['RobotOverlapsZone']);
    expect(d.occupancyOfRobot('r1', 'base')).toBe('full');
  });

  it('reports the real support fraction, not a representative one', () => {
    const d = detector();
    const [event] = d.update({ robots: [robot(18, 0)] }, 1);
    if (event?.kind !== 'RobotEnteredZone') return;
    expect(event.supportFraction).toBeCloseTo(0.5, 9);
  });

  it('emits an exit when a robot leaves', () => {
    const d = detector();
    d.update({ robots: [robot(0, 0)] }, 1);

    const events = d.update({ robots: [robot(80, 0)] }, 2);
    expect(kinds(events)).toEqual(['RobotExitedZone']);
    expect(d.occupancyOfRobot('r1', 'base')).toBe('outside');
  });

  it('accounts for heading', () => {
    const d = detector();
    // Square in the corner fits; rotated 45 degrees it does not.
    d.update({ robots: [robot(9, 9)] }, 1);
    expect(d.occupancyOfRobot('r1', 'base')).toBe('full');

    const events = d.update({ robots: [robot(9, 9, { headingRad: Math.PI / 4 })] }, 2);
    expect(kinds(events)).toEqual(['RobotOverlapsZone']);
    expect(d.occupancyOfRobot('r1', 'base')).toBe('partial');
  });

  it('primes a robot already in a zone without emitting', () => {
    const d = detector();
    d.prime({ robots: [robot(0, 0)] });
    expect(d.update({ robots: [robot(0, 0)] }, 1)).toEqual([]);
  });

  it('exits a robot that leaves the field', () => {
    const d = detector();
    d.update({ robots: [robot(0, 0)] }, 1);
    expect(kinds(d.update({ robots: [] }, 2))).toEqual(['RobotExitedZone']);
  });
});

describe('several objects on one tick', () => {
  it('reports every object that transitioned', () => {
    const d = detector();
    const events = d.update(
      {
        pieces: [
          piece(24, 0, { pieceId: 'a' }),
          piece(-24, 0, { pieceId: 'b' }),
          piece(70, 70, { pieceId: 'c' }),
        ],
        robots: [robot(0, 0), robot(0, 0, { robotId: 'r2', alliance: 'blue' })],
      },
      7,
    );

    expect(events).toHaveLength(4); // two pieces, two robots; 'c' is nowhere
    expect(kinds(events).filter((k) => k === 'PieceEnteredRegion')).toHaveLength(2);
    expect(kinds(events).filter((k) => k === 'RobotEnteredZone')).toHaveLength(2);
  });

  it('keeps each object independent', () => {
    const d = detector();
    d.update({ pieces: [piece(24, 0, { pieceId: 'a' }), piece(-24, 0, { pieceId: 'b' })] }, 1);

    // Only 'a' moves.
    const events = d.update(
      { pieces: [piece(60, 0, { pieceId: 'a' }), piece(-24, 0, { pieceId: 'b' })] },
      2,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('PieceExitedRegion');
    expect(d.regionsOf('b')).toEqual(['far-goal']);
  });
});

describe('determinism', () => {
  /**
   * Replay depends on the same snapshot sequence producing the same event
   * sequence, whatever order the caller happened to list objects in.
   */
  it('is independent of the order objects are listed', () => {
    const build = (reversed: boolean) => {
      const d = detector();
      const pieces = [
        piece(24, 0, { pieceId: 'a' }),
        piece(-24, 0, { pieceId: 'b' }),
        piece(24, 2, { pieceId: 'c' }),
      ];
      const observation: Observation = { pieces: reversed ? [...pieces].reverse() : pieces };
      return d.update(observation, 3);
    };

    expect(JSON.stringify(build(false))).toBe(JSON.stringify(build(true)));
  });

  it('returns events already in compareEvents order', () => {
    const d = detector([arena, goal, farGoal]);
    d.update({ pieces: [piece(24, 0, { pieceId: 'a' })] }, 1);

    const events = d.update(
      {
        pieces: [piece(-24, 0, { pieceId: 'a' }), piece(24, 0, { pieceId: 'b' })],
        robots: [robot(0, 0)],
      },
      2,
    );

    expect([...events].sort(compareEvents)).toEqual(events);
  });

  it('produces identical output for identical input sequences', () => {
    const run = () => {
      const d = detector();
      const out: SimEvent[] = [];
      for (let tick = 1; tick <= 20; tick++) {
        const x = tick % 2 === 0 ? 24 : 60;
        out.push(...d.update({ pieces: [piece(x, 0)], robots: [robot(x - 24, 0)] }, tick));
      }
      return out;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('reset() clears state so the next update sees fresh arrivals', () => {
    const d = detector();
    d.update({ pieces: [piece(24, 0)] }, 1);
    expect(d.update({ pieces: [piece(24, 0)] }, 2)).toEqual([]);

    d.reset();
    expect(kinds(d.update({ pieces: [piece(24, 0)] }, 3))).toEqual(['PieceEnteredRegion']);
  });
});

describe('construction validation', () => {
  it('refuses duplicate region ids', () => {
    // Duplicates would make membership contradictory — the same id both entered
    // and not — so this fails at load, as the rest of the game layer does.
    expect(() => detector([goal, goal])).toThrow(/invalid geometry/);
    expect(() => detector([goal, goal])).toThrow(/Duplicate region id/);
  });

  it('refuses duplicate zone ids', () => {
    expect(() => detector([goal], [base, base])).toThrow(/invalid geometry/);
  });

  it('refuses a non-positive timestep', () => {
    expect(
      () => new RegionMembershipDetector({ regions: [], zones: [], dtSec: 0 }),
    ).toThrow(/positive timestep/);
  });

  it('accepts an empty world', () => {
    const d = new RegionMembershipDetector({ regions: [], zones: [], dtSec: DT });
    expect(d.update({ pieces: [piece(0, 0)], robots: [robot(0, 0)] }, 1)).toEqual([]);
  });
});
