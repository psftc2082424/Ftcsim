/**
 * Possession, decided from simulated state rather than asserted by a test.
 *
 * Every case here drives a real `SimWorld` and lets the tracker read the
 * snapshot, because the thing being tested is exactly whether geometry and
 * velocity are enough to answer "who is holding this". A test that fed the
 * tracker hand-built snapshots would pass while the real pipeline credited
 * nobody.
 */

import { describe, expect, it } from 'vitest';
import { PossessionTracker, attributionFrom } from './possession.js';
import { DT_SECONDS, SimWorld, type GamePieceSpec } from '../sim/simWorld.js';
import { DEFAULT_ROBOT_CONFIG } from '../robot/robotConfig.js';
import { constantController } from '../control/scripted.js';
import { NeutralController } from '../control/controller.js';
import { createControlInput } from '../control/controlInput.js';
import { inchesToMeters } from '../units/convert.js';
import { vec2 } from '../math/vec2.js';
import type { SimEvent } from './events.js';

const at = (xIn: number, yIn: number) => vec2(inchesToMeters(xIn), inchesToMeters(yIn));

const artifact = (pieceId: string, xIn: number, yIn: number): GamePieceSpec => ({
  pieceId,
  pieceType: 'P',
  diameterIn: 4.9,
  massLb: 0.165,
  startPositionM: at(xIn, yIn),
});

interface Rig {
  readonly world: SimWorld;
  readonly tracker: PossessionTracker;
  step(ticks: number): SimEvent[];
}

/**
 * A robot at the origin facing +X, with pieces placed in inches.
 *
 * `drive` of `null` gives a robot that never commands anything, for the cases
 * about a robot that is merely *near* a piece.
 */
function rig(
  pieces: readonly GamePieceSpec[],
  drive: { x: number; y: number; turn: number } | null,
  robotXIn = 0,
): Rig {
  const world = new SimWorld({
    robots: [
      {
        config: DEFAULT_ROBOT_CONFIG,
        alliance: 'red',
        controller:
          drive === null
            ? new NeutralController()
            : constantController(createControlInput(drive.x, drive.y, drive.turn)),
        startPose: { p: at(robotXIn, 0), theta: 0 },
      },
    ],
    pieces,
    seed: 1,
  });

  const tracker = new PossessionTracker();

  return {
    world,
    tracker,
    step(ticks: number): SimEvent[] {
      const events: SimEvent[] = [];
      for (let i = 0; i < ticks; i++) {
        world.step();
        events.push(...tracker.update(world.snapshot(), world.tick));
      }
      return events;
    },
  };
}

const kinds = (events: readonly SimEvent[], kind: string): SimEvent[] =>
  events.filter((event) => event.kind === kind);

describe('what counts as possession', () => {
  it('credits nobody when the robot never reaches the piece', () => {
    const test = rig([artifact('a1', 40, 0)], { x: 1, y: 0, turn: 0 });
    const events = test.step(20);

    expect(kinds(events, 'PiecePossessed')).toHaveLength(0);
    expect(test.tracker.creditFor('a1')).toBeUndefined();
  });

  it('credits the robot that drives into a piece', () => {
    // Robot half-length is 9 in, so its face starts 2 in short of the artifact.
    const test = rig([artifact('a1', 14, 0)], { x: 1, y: 0, turn: 0 });
    const events = test.step(120);

    const possessed = kinds(events, 'PiecePossessed');
    expect(possessed.length).toBeGreaterThan(0);
    expect(test.tracker.creditFor('a1')).toEqual({ robotId: '0', alliance: 'red' });
    expect(test.tracker.heldBy('0')).toEqual(['a1']);
  });

  /**
   * Contact alone is not possession. A robot parked against a piece — or one a
   * piece has rolled up against — is not controlling it, and a model that said
   * otherwise would credit every accidental resting contact on the field.
   */
  it('does not credit a robot that is merely touching a stationary piece', () => {
    const test = rig([artifact('a1', 11.5, 0)], null);
    const events = test.step(120);

    expect(kinds(events, 'PiecePossessed')).toHaveLength(0);
    expect(test.tracker.creditFor('a1')).toBeUndefined();
  });

  it('does not credit a robot driving away from a piece it is touching', () => {
    const test = rig([artifact('a1', 12, 0)], { x: -1, y: 0, turn: 0 });
    const events = test.step(60);

    expect(kinds(events, 'PiecePossessed')).toHaveLength(0);
  });

  it('releases the piece once the robot stops pushing it', () => {
    const world = new SimWorld({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          alliance: 'red',
          controller: {
            id: 'push-then-stop',
            sample: (tick: number) =>
              tick < 100 ? createControlInput(1, 0, 0) : createControlInput(-1, 0, 0),
          },
          startPose: { p: at(0, 0), theta: 0 },
        },
      ],
      pieces: [artifact('a1', 14, 0)],
      seed: 1,
    });

    const tracker = new PossessionTracker();
    const events: SimEvent[] = [];
    for (let i = 0; i < 250; i++) {
      world.step();
      events.push(...tracker.update(world.snapshot(), world.tick));
    }

    expect(kinds(events, 'PiecePossessed').length).toBeGreaterThan(0);
    expect(kinds(events, 'PieceReleasedBy').length).toBeGreaterThan(0);
    expect(tracker.heldBy('0')).toEqual([]);
    // Credit survives release, which is what makes "who scored it" answerable.
    expect(tracker.creditFor('a1')).toEqual({ robotId: '0', alliance: 'red' });
  });

  /**
   * A pushed piece bounces: contact breaks and remakes over a few ticks as the
   * resolver separates it and the robot drives back in. Without the release
   * grace this test would see a burst of events rather than one.
   */
  it('reports one possession for one continuous push', () => {
    const test = rig([artifact('a1', 14, 0)], { x: 1, y: 0, turn: 0 });
    const events = test.step(200);

    expect(kinds(events, 'PiecePossessed')).toHaveLength(1);
    expect(kinds(events, 'PieceReleasedBy')).toHaveLength(0);
  });
});

describe('possession counts', () => {
  it('counts every piece a robot is pushing at once', () => {
    const test = rig(
      [artifact('a1', 14, -4), artifact('a2', 14, 0), artifact('a3', 14, 4)],
      { x: 1, y: 0, turn: 0 },
    );
    const events = test.step(150);

    const possessed = kinds(events, 'PiecePossessed');
    expect(possessed.length).toBe(3);
    expect(test.tracker.heldBy('0')).toEqual(['a1', 'a2', 'a3']);

    // The count on the events rises as the robot gathers them, which is what
    // lets a possession-limit rule be an ordinary filtered rule.
    const counts = possessed.map((event) =>
      'possessedCount' in event ? event.possessedCount : -1,
    );
    expect(counts.sort()).toEqual([1, 2, 3]);
  });

  it('reports how long a piece has been held', () => {
    const test = rig([artifact('a1', 14, 0)], { x: 1, y: 0, turn: 0 });
    test.step(120);

    const heldFor = test.tracker.heldForSec('a1', test.world.tick, DT_SECONDS);
    expect(heldFor).toBeGreaterThan(0);
    expect(heldFor).toBeLessThan(120 * DT_SECONDS);
  });
});

describe('attribution reaches the observation bridge', () => {
  it('exposes the tracker as an attribution function', () => {
    const test = rig([artifact('a1', 14, 0)], { x: 1, y: 0, turn: 0 });
    test.step(120);

    const attribution = attributionFrom(test.tracker);
    expect(attribution('a1')).toEqual({ robotId: '0', alliance: 'red' });
    expect(attribution('never-touched')).toBeUndefined();
  });
});

describe('determinism', () => {
  it('produces the same events every run', () => {
    const play = (): string => {
      const test = rig(
        [artifact('a1', 14, -4), artifact('a2', 14, 4)],
        { x: 1, y: 0, turn: 0 },
      );
      return JSON.stringify(test.step(200));
    };

    const first = play();
    for (let i = 0; i < 3; i++) expect(play()).toBe(first);
  });

  /** Two robots equidistant from one piece must resolve the same way each run. */
  it('breaks a contested piece deterministically', () => {
    const build = (): PossessionTracker => {
      const world = new SimWorld({
        robots: [
          {
            config: DEFAULT_ROBOT_CONFIG,
            alliance: 'red',
            controller: constantController(createControlInput(1, 0, 0)),
            startPose: { p: at(-14, 0), theta: 0 },
          },
          {
            config: DEFAULT_ROBOT_CONFIG,
            alliance: 'blue',
            controller: constantController(createControlInput(1, 0, 0)),
            startPose: { p: at(14, 0), theta: Math.PI },
          },
        ],
        pieces: [artifact('a1', 0, 0)],
        seed: 1,
      });

      const tracker = new PossessionTracker();
      for (let i = 0; i < 120; i++) {
        world.step();
        tracker.update(world.snapshot(), world.tick);
      }
      return tracker;
    };

    const first = build().creditFor('a1');
    expect(first).toBeDefined();
    for (let i = 0; i < 3; i++) expect(build().creditFor('a1')).toEqual(first);
  });
});
