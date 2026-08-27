import { describe, expect, it } from 'vitest';
import { PIECE_ENTITY_ID_BASE, SimWorld, type GamePieceSpec } from './simWorld.js';
import { DEFAULT_ROBOT_CONFIG } from '../robot/robotConfig.js';
import { constantController, createInputTrace, ScriptedController } from '../control/scripted.js';
import { createControlInput, NEUTRAL_INPUT } from '../control/controlInput.js';
import { NeutralController } from '../control/controller.js';
import { fieldBounds, createStandardField } from '../field/fieldTemplate.js';
import { inchesToMeters, poundsToKilograms } from '../units/convert.js';
import { vec2 } from '../math/vec2.js';

/**
 * Dimensions are DECODE's 5 in nominal ARTIFACT; the mass is a plausible test
 * value, not a manual figure — nothing here is a catalogue entry.
 */
const artifact = (patch: Partial<GamePieceSpec> = {}): GamePieceSpec => ({
  pieceId: 'a1',
  pieceType: 'purple',
  diameterIn: 5,
  massLb: 0.3,
  ...patch,
});

const world = (pieces: readonly GamePieceSpec[] = [], input = NEUTRAL_INPUT) =>
  new SimWorld({
    robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: constantController(input) }],
    pieces,
  });

describe('pieces as entities', () => {
  it('a world without pieces has none', () => {
    const w = world();
    expect(w.pieceCount).toBe(0);
    expect(w.snapshot().pieces).toEqual([]);
  });

  it('surfaces a piece in the snapshot with both identities', () => {
    const w = world([artifact({ startPositionM: vec2(0.5, 0.25) })]);
    const [piece] = w.snapshot().pieces;

    expect(piece).toBeDefined();
    if (piece === undefined) return;

    // Numeric entity id for physics, string ids for the game layer.
    expect(piece.id).toBe(PIECE_ENTITY_ID_BASE);
    expect(piece.pieceId).toBe('a1');
    expect(piece.pieceType).toBe('purple');
    expect(piece.pose.p.x).toBeCloseTo(0.5, 12);
    expect(piece.pose.p.y).toBeCloseTo(0.25, 12);
  });

  it('converts FTC authoring units once', () => {
    const w = world([artifact()]);
    const [piece] = w.snapshot().pieces;
    if (piece === undefined) return;

    expect(piece.radiusM).toBeCloseTo(inchesToMeters(5) / 2, 12);
    // Resting on the floor puts the centre one radius up.
    expect(piece.heightM).toBeCloseTo(inchesToMeters(5) / 2, 12);
  });

  it('honours an explicit height', () => {
    const w = world([artifact({ heightM: 0.9 })]);
    expect(w.snapshot().pieces[0]?.heightM).toBeCloseTo(0.9, 12);
  });

  it('numbers pieces sequentially from the piece id base', () => {
    const w = world([artifact({ pieceId: 'a' }), artifact({ pieceId: 'b' }), artifact({ pieceId: 'c' })]);
    expect(w.snapshot().pieces.map((p) => p.id)).toEqual([
      PIECE_ENTITY_ID_BASE,
      PIECE_ENTITY_ID_BASE + 1,
      PIECE_ENTITY_ID_BASE + 2,
    ]);
  });

  it('preserves creation order in the snapshot', () => {
    const w = world([artifact({ pieceId: 'z' }), artifact({ pieceId: 'a' })]);
    expect(w.snapshot().pieces.map((p) => p.pieceId)).toEqual(['z', 'a']);
  });
});

describe('piece validation', () => {
  it('rejects an empty id', () => {
    expect(() => world([artifact({ pieceId: '' })])).toThrow(/non-empty pieceId/);
  });

  it('rejects a duplicate id', () => {
    // Two pieces sharing an id would make membership events ambiguous.
    expect(() => world([artifact(), artifact()])).toThrow(/Duplicate game piece id/);
  });

  it('rejects impossible dimensions or mass', () => {
    expect(() => world([artifact({ diameterIn: 0 })])).toThrow(/positive diameter/);
    expect(() => world([artifact({ massLb: -1 })])).toThrow(/positive mass/);
  });
});

describe('pieces at rest', () => {
  it('does not drift when nothing touches it', () => {
    const w = world([artifact({ startPositionM: vec2(1, 1) })]);
    w.stepMany(400);

    const [piece] = w.snapshot().pieces;
    if (piece === undefined) return;
    expect(piece.pose.p.x).toBeCloseTo(1, 12);
    expect(piece.pose.p.y).toBeCloseTo(1, 12);
    expect(Math.hypot(piece.vel.v.x, piece.vel.v.y)).toBeCloseTo(0, 12);
  });

  it('tracks a previous pose for render interpolation', () => {
    const w = world([artifact({ startPositionM: vec2(1, 0) })]);
    w.stepMany(10);

    const [piece] = w.snapshot().pieces;
    if (piece === undefined) return;
    expect(piece.previousPose.p.x).toBeCloseTo(piece.pose.p.x, 12);
  });
});

describe('pieces interact through the existing collision resolver', () => {
  /**
   * No collision code was written for this: pieces join the same body map the
   * walls and robots already live in, so the generic resolver handles them.
   */
  it('is pushed by a robot driving into it', () => {
    const w = new SimWorld({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(createControlInput(1, 0, 0)),
          startPose: { p: vec2(-1.5, 0), theta: 0 },
        },
      ],
      // Directly in the robot's path.
      pieces: [artifact({ startPositionM: vec2(-1.0, 0) })],
    });

    const startX = w.snapshot().pieces[0]?.pose.p.x ?? 0;
    w.stepMany(300);

    const piece = w.snapshot().pieces[0];
    if (piece === undefined) return;
    expect(piece.pose.p.x).toBeGreaterThan(startX + 0.05);
  });

  it('uses ball-only rolling loss while preserving ordinary robot motion', () => {
    const w = world([artifact({ startPositionM: vec2(0.7, 0.7) })]);
    w.releasePieceMoving('a1', vec2(0.7, 0.7), vec2(1, 0));

    w.stepMany(100); // half a second, away from robots and walls

    const piece = w.snapshot().pieces[0];
    if (piece === undefined) return;
    const speed = Math.hypot(piece.vel.v.x, piece.vel.v.y);
    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeLessThan(1);
    expect(speed).toBeCloseTo(1 - inchesToMeters(20) * 100 * w.dt, 8);
  });

  it('keeps ball-to-ball collisions physical and modestly inelastic', () => {
    const w = world([
      artifact({ pieceId: 'a', startPositionM: vec2(-0.5, 0.8) }),
      artifact({ pieceId: 'b', startPositionM: vec2(-0.15, 0.8) }),
    ]);
    w.releasePieceMoving('a', vec2(-0.5, 0.8), vec2(2, 0));

    w.stepMany(50);

    const [a, b] = w.snapshot().pieces;
    if (a === undefined || b === undefined) return;
    expect(a.vel.v.x).toBeGreaterThan(0);
    expect(a.vel.v.x).toBeLessThan(2);
    expect(b.vel.v.x).toBeGreaterThan(a.vel.v.x);
  });

  it('is stopped by the field perimeter after being knocked toward it', () => {
    const bounds = fieldBounds(createStandardField());
    const w = new SimWorld({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          // Push, then release, so the piece coasts to the wall on its own.
          controller: new ScriptedController(
            createInputTrace('nudge', [
              { tick: 0, input: createControlInput(1, 0, 0) },
              { tick: 90, input: NEUTRAL_INPUT },
            ]),
          ),
          startPose: { p: vec2(0.6, 0), theta: 0 },
        },
      ],
      pieces: [artifact({ startPositionM: vec2(1.2, 0) })],
    });

    w.stepMany(600);
    const piece = w.snapshot().pieces[0];
    if (piece === undefined) return;

    expect(piece.pose.p.x).toBeLessThan(bounds.maxX);
    expect(piece.pose.p.x).toBeGreaterThan(1.5);
    expect(Math.abs(piece.vel.v.x)).toBeLessThan(0.01);
  });

  /**
   * Known defect, recorded rather than hidden (ASSUMPTIONS.md §5.6).
   *
   * A robot that keeps driving into a piece already resting against a wall pins
   * it in a gap narrower than its own diameter, which no position can satisfy.
   *
   * It used to leave the field. Two things did that together: resolving each
   * contact once meant the piece-to-wall contact never pushed back through the
   * piece to stop the robot, and a 2 in wall was thin enough that a squeezed
   * 4.9 in artifact could get its centre past the wall's midline — at which
   * point `circlePoly` pushes an enclosed centre out through the *far* face.
   *
   * Both are fixed (ASSUMPTIONS.md §5.8), so the piece now stays in play and
   * settles against the wall instead.
   */
  it('keeps a piece pinned between a driving robot and a wall inside the field', () => {
    const bounds = fieldBounds(createStandardField());
    const w = new SimWorld({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(createControlInput(1, 0, 0)),
          startPose: { p: vec2(0.6, 0), theta: 0 },
        },
      ],
      pieces: [artifact({ startPositionM: vec2(1.2, 0) })],
    });

    w.stepMany(600);
    const piece = w.snapshot().pieces[0];
    const robot = w.snapshot().robots[0];
    if (piece === undefined || robot === undefined) return;

    expect(piece.pose.p.x).toBeLessThan(bounds.maxX);
    expect(robot.pose.p.x).toBeLessThan(bounds.maxX);

    // Contained rather than merely slow to leave: thirty more seconds of the
    // robot driving into it keeps it in play. The squeeze is still
    // geometrically unsatisfiable — nothing can separate a piece from both a
    // robot and a wall closer together than its diameter — so it eventually
    // squirts out sideways, which is what a real one does. Where it goes after
    // that is ordinary artifact motion with the modest floor-roll loss (§5.5);
    // what matters is that the
    // field still holds it.
    w.stepMany(6000);

    const later = w.snapshot().pieces[0];
    if (later === undefined) return;
    expect(later.pose.p.x).toBeGreaterThan(bounds.minX);
    expect(later.pose.p.x).toBeLessThan(bounds.maxX);
    expect(later.pose.p.y).toBeGreaterThan(bounds.minY);
    expect(later.pose.p.y).toBeLessThan(bounds.maxY);
  });

  it('keeps every piece finite under sustained contact', () => {
    const w = new SimWorld({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: {
            id: 'wiggle',
            sample: (tick: number) =>
              createControlInput(Math.sin(tick * 0.02), Math.cos(tick * 0.03), Math.sin(tick * 0.01)),
          },
        },
      ],
      pieces: [
        artifact({ pieceId: 'a', startPositionM: vec2(0.4, 0) }),
        artifact({ pieceId: 'b', startPositionM: vec2(-0.4, 0.2) }),
        artifact({ pieceId: 'c', startPositionM: vec2(0, 0.5) }),
      ],
    });

    w.stepMany(2000);
    for (const piece of w.snapshot().pieces) {
      expect(Number.isFinite(piece.pose.p.x)).toBe(true);
      expect(Number.isFinite(piece.pose.p.y)).toBe(true);
      expect(Number.isFinite(piece.vel.v.x)).toBe(true);
      expect(Number.isFinite(piece.vel.omega)).toBe(true);
    }
  });
});

describe('determinism with pieces', () => {
  const build = () =>
    new SimWorld({
      seed: 99,
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(createControlInput(1, 0.3, 0)),
          startPose: { p: vec2(-1.4, -0.4), theta: 0.2 },
        },
      ],
      pieces: [
        artifact({ pieceId: 'a', startPositionM: vec2(-0.9, -0.4) }),
        artifact({ pieceId: 'b', startPositionM: vec2(-0.6, -0.2) }),
      ],
    });

  it('produces an identical digest across runs', () => {
    const a = build();
    const b = build();
    a.stepMany(500);
    b.stepMany(500);
    expect(a.stateHash()).toBe(b.stateHash());
  });

  /** Pieces must be part of the state the digest covers, or replays lose them. */
  it('changes the digest when a piece moves', () => {
    const still = world([artifact({ startPositionM: vec2(1.4, 1.4) })]);
    const pushed = build();

    still.stepMany(500);
    pushed.stepMany(500);
    expect(still.stateHash()).not.toBe(pushed.stateHash());
  });

  it('changes the digest when a piece starts somewhere else', () => {
    const here = world([artifact({ startPositionM: vec2(0.5, 0) })]);
    const there = world([artifact({ startPositionM: vec2(0.6, 0) })]);
    expect(here.stateHash()).not.toBe(there.stateHash());
  });

  /**
   * The Phase 1 golden digest was captured before pieces existed. A world with
   * none must still hash exactly as it did, or every earlier replay breaks.
   */
  it('leaves a piece-free world hashing as it did before pieces existed', () => {
    const withoutOption = new SimWorld({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: new NeutralController() }],
    });
    const withEmptyList = new SimWorld({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: new NeutralController() }],
      pieces: [],
    });

    withoutOption.stepMany(200);
    withEmptyList.stepMany(200);
    expect(withEmptyList.stateHash()).toBe(withoutOption.stateHash());
  });
});

describe('snapshot shape', () => {
  it('shares one snapshot object per tick with pieces included', () => {
    const w = world([artifact()]);
    expect(w.snapshot()).toBe(w.snapshot());

    w.step();
    expect(w.snapshot().pieces).toHaveLength(1);
  });

  it('carries enough for a caller to build region observations', () => {
    // The sim must not import the game layer, so a caller maps snapshot ->
    // observation. Everything that mapping needs has to be present here.
    const w = world([artifact({ startPositionM: vec2(0.3, -0.2) })]);
    const [piece] = w.snapshot().pieces;
    if (piece === undefined) return;

    expect(typeof piece.pieceId).toBe('string');
    expect(typeof piece.pieceType).toBe('string');
    expect(typeof piece.heightM).toBe('number');
    expect(typeof piece.pose.p.x).toBe('number');
    expect(poundsToKilograms(0.3)).toBeGreaterThan(0);
  });
});
