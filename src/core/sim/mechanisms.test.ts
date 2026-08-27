/**
 * Functional mechanism chain: field -> intake -> storage -> shoot -> real flight.
 *
 * The mechanism itself stays a deterministic state machine — capture on
 * contact, fire on command — but both capture and fire now happen on a real,
 * configured cadence rather than instantly, and a fired piece leaves on a real
 * ballistic arc rather than teleporting (`launchPieceTowards`).
 */

import { describe, expect, it } from 'vitest';
import { SimWorld, type GamePieceSpec, type RobotSpec } from './simWorld.js';
import {
  INTAKE_BUTTON,
  LAUNCH_BUTTON,
  OUTTAKE_BUTTON,
} from './shooter.js';
import { COMPETITION_ROBOT_CONFIG, type RobotConfig } from '../robot/robotConfig.js';
import { ScriptedController, constantController, createInputTrace } from '../control/scripted.js';
import { NEUTRAL_INPUT, createControlInput } from '../control/controlInput.js';
import { inchesToMeters } from '../units/convert.js';
import { vec2 } from '../math/vec2.js';
import type { FieldTemplate } from '../field/fieldTemplate.js';
import type { Capability } from '../mechanism/capability.js';

const OPEN_FIELD: FieldTemplate = { id: 'open', name: 'Open', widthM: 1000, lengthM: 1000, bodies: [] };

const artifact = (pieceId: string, xIn: number, yIn: number): GamePieceSpec => ({
  pieceId,
  pieceType: 'P',
  diameterIn: 4.9,
  massLb: 0.165,
  startPositionM: vec2(inchesToMeters(xIn), inchesToMeters(yIn)),
});

const input = (...buttons: string[]) =>
  createControlInput(0, 0, 0, Object.fromEntries(buttons.map((button) => [button, true])));

function world(
  pieces: readonly GamePieceSpec[],
  controller = constantController(NEUTRAL_INPUT),
  config: RobotConfig = COMPETITION_ROBOT_CONFIG,
): SimWorld {
  const robot: RobotSpec = {
    config,
    controller,
    startPose: { p: vec2(0, 0), theta: 0 },
  };
  return new SimWorld({ robots: [robot], pieces, field: OPEN_FIELD, seed: 11 });
}

/**
 * A robot whose intake and shooter rates are picked for the test, rather than
 * the competition defaults — so a test of shooting cadence is not entangled
 * with intake cadence, and vice versa.
 */
function robotWithRates(acquisitionRatePerSec: number, shotsPerSecond: number): RobotConfig {
  return {
    ...COMPETITION_ROBOT_CONFIG,
    mechanisms: COMPETITION_ROBOT_CONFIG.mechanisms.map((mechanism) => ({
      ...mechanism,
      capabilities: mechanism.capabilities.map((capability): Capability => {
        if (capability.kind === 'acquire') return { ...capability, acquisitionRatePerSec };
        if (capability.kind === 'launch') return { ...capability, shotsPerSecond };
        return capability;
      }),
    })),
  };
}

describe('functional intake and storage', () => {
  it('acquires an eligible ball when intake is active', () => {
    const sim = world([artifact('a', 11, 0)], constantController(input(INTAKE_BUTTON)));
    sim.step();
    expect(sim.heldPieces(0)).toEqual(['a']);
    expect(sim.snapshot().pieces[0]?.heldByRobotId).toBe(0);
  });

  /**
   * Four balls sit in the mouth at once, but capacity is three and captures
   * happen one per acquisition-rate interval, not all at once — the same
   * cadence rule firing uses. Competition's intake is 2/s, so three captures
   * (immediate, then two 100-tick gaps) finish by tick 200.
   */
  it('stops at capacity three and leaves the fourth ball on the field', () => {
    const sim = world(
      [artifact('a', 11, 0), artifact('b', 11, 4), artifact('c', 11, -4), artifact('d', 11, 2)],
      constantController(input(INTAKE_BUTTON)),
    );
    sim.stepMany(210);
    expect(sim.heldPieces(0)).toHaveLength(3);
    expect(
      sim.snapshot().pieces.filter((piece) => piece.heldByRobotId === null).map((piece) => piece.pieceId),
    ).toEqual(['d']);
  });

  /** A slower rate genuinely takes longer: one capture every half second at 2/s. */
  it('captures more slowly at a lower acquisition rate', () => {
    const config = robotWithRates(1, 2);
    const sim = world([artifact('a', 11, 0), artifact('b', 11, 4)], constantController(input(INTAKE_BUTTON)), config);

    sim.stepMany(50);
    expect(sim.heldPieces(0)).toEqual(['a']);

    sim.stepMany(151);
    expect(sim.heldPieces(0)).toEqual(['a', 'b']);
  });

  it('ejects the oldest stored ball when outtake is active', () => {
    const controller = new ScriptedController(createInputTrace('collect then outtake', [
      { tick: 0, input: input(INTAKE_BUTTON) },
      { tick: 1, input: input(OUTTAKE_BUTTON) },
    ]));
    const sim = world([artifact('a', 11, 0)], controller);
    sim.stepMany(2);
    expect(sim.heldPieces(0)).toEqual([]);
    expect(sim.snapshot().pieces[0]?.heldByRobotId).toBeNull();
  });
});

describe('functional shooting', () => {
  const threeBalls = [artifact('a', 11, 0), artifact('b', 11, 4), artifact('c', 11, -4)];

  /** A near-instant intake isolates the shooter's own cadence for these tests. */
  const shooterOnly = (shotsPerSecond: number) => robotWithRates(1000, shotsPerSecond);

  it('fires exactly one ball on a tap shorter than the fire interval', () => {
    const controller = new ScriptedController(createInputTrace('tap', [
      { tick: 0, input: input(INTAKE_BUTTON) },
      { tick: 10, input: input(LAUNCH_BUTTON) },
      { tick: 13, input: input() },
    ]));
    const sim = world(threeBalls, controller, shooterOnly(2));
    sim.stepMany(20);

    expect(sim.heldPieces(0)).toEqual(['b', 'c']);
    expect(sim.drainPieceActions()).toMatchObject([{ kind: 'launch', pieceId: 'a' }]);
  });

  /**
   * Holding fire empties the hopper on its own, at the configured cadence —
   * the feature this session adds. At 2 shots/s (100-tick interval), three
   * shots starting once the button is first seen (tick 10) land at
   * approximately 10, 110 and 210.
   */
  it('fires all three sequentially while fire is held, at the configured rate', () => {
    const controller = new ScriptedController(createInputTrace('hold to fire', [
      { tick: 0, input: input(INTAKE_BUTTON) },
      { tick: 10, input: input(LAUNCH_BUTTON) },
    ]));
    const sim = world(threeBalls, controller, shooterOnly(2));
    sim.stepMany(250);

    expect(sim.heldPieces(0)).toEqual([]);
    expect(sim.drainPieceActions().map((action) => action.pieceId)).toEqual(['a', 'b', 'c']);
  });

  /** Releasing the command stops it: no fourth shot appears from nowhere. */
  it('stops firing the instant the command is released', () => {
    const controller = new ScriptedController(createInputTrace('hold then release', [
      { tick: 0, input: input(INTAKE_BUTTON) },
      { tick: 10, input: input(LAUNCH_BUTTON) },
      { tick: 15, input: input() },
    ]));
    // A fast rate (10/s = 20-tick interval) that would fire a second shot by
    // tick 30 if the release did not actually stop it.
    const sim = world(threeBalls, controller, shooterOnly(10));
    sim.stepMany(60);

    expect(sim.heldPieces(0)).toEqual(['b', 'c']);
    expect(sim.drainPieceActions()).toHaveLength(1);
  });

  it('fires faster at a higher configured rate', () => {
    const secondShotTick = (shotsPerSecond: number): number => {
      const controller = new ScriptedController(
        createInputTrace('hold', [{ tick: 0, input: input(INTAKE_BUTTON, LAUNCH_BUTTON) }]),
      );
      const sim = world(threeBalls, controller, shooterOnly(shotsPerSecond));

      let tick = 0;
      let fired = 0;
      while (fired < 2 && tick < 2000) {
        sim.step();
        fired += sim.drainPieceActions().length;
        tick++;
      }
      return tick;
    };

    expect(secondShotTick(4)).toBeLessThan(secondShotTick(1));
  });

  /**
   * Once released, a fired piece is an ordinary game piece on a real arc: it
   * has left the floor, and it has not been teleported to any destination —
   * there is no destination without a `MechanismActionRoute`, which this bare
   * `SimWorld` test deliberately has none of (`matchSimulation.test.ts` and
   * `decodeMatch.test.ts` cover the routed, scoring path).
   */
  it('leaves a fired piece parked at the robot until the game layer routes it', () => {
    const controller = new ScriptedController(createInputTrace('single shot', [
      { tick: 0, input: input(INTAKE_BUTTON) },
      { tick: 10, input: input(LAUNCH_BUTTON) },
    ]));
    const sim = world([artifact('a', 11, 0)], controller, shooterOnly(2));
    sim.stepMany(11);

    const action = sim.drainPieceActions()[0];
    expect(action).toMatchObject({ kind: 'launch', pieceId: 'a' });
    // Nothing has moved it anywhere yet — that is the match layer's job.
    expect(sim.snapshot().pieces[0]?.pose.p).toEqual(vec2(0, 0));
  });
});
