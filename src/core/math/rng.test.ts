import { describe, expect, it } from 'vitest';
import { Pcg32, SubStream, createSubStream } from './rng.js';

describe('Pcg32 — known-answer test', () => {
  /**
   * Reference output of `pcg32-demo.c` from M.E. O'Neill's PCG distribution,
   * seeded with `pcg32_srandom_r(&rng, 42u, 54u)`. Matching this proves the
   * transcription is faithful, not merely self-consistent.
   */
  it('reproduces the published reference vector for seed=42, stream=54', () => {
    const rng = new Pcg32(42, 54);
    const actual = Array.from({ length: 6 }, () => rng.nextUint32());

    expect(actual).toEqual([
      0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293, 0xbfa4784b, 0xcbed606e,
    ]);
  });
});

describe('Pcg32 — determinism', () => {
  it('produces an identical sequence for an identical seed and stream', () => {
    const a = new Pcg32(12345, 7);
    const b = new Pcg32(12345, 7);
    for (let i = 0; i < 1000; i++) {
      expect(a.nextUint32()).toBe(b.nextUint32());
    }
  });

  it('clone() continues the sequence from the same position', () => {
    const original = new Pcg32(999, 1);
    for (let i = 0; i < 50; i++) original.nextUint32();

    const copy = original.clone();
    for (let i = 0; i < 100; i++) {
      expect(copy.nextUint32()).toBe(original.nextUint32());
    }
  });

  it('accepts bigint seeds beyond Number.MAX_SAFE_INTEGER', () => {
    const a = new Pcg32(0xdeadbeefcafef00dn, 3);
    const b = new Pcg32(0xdeadbeefcafef00dn, 3);
    expect(a.nextUint32()).toBe(b.nextUint32());
  });
});

describe('Pcg32 — sub-stream independence', () => {
  /**
   * This is the property that keeps determinism tests stable as features land:
   * a new random draw in one subsystem must not shift what another subsystem
   * sees.
   */
  it('gives different sequences to different streams from the same seed', () => {
    const physics = createSubStream(2024, SubStream.Physics);
    const mechanism = createSubStream(2024, SubStream.Mechanism);

    const a = Array.from({ length: 32 }, () => physics.nextUint32());
    const b = Array.from({ length: 32 }, () => mechanism.nextUint32());

    expect(a).not.toEqual(b);
  });

  it('leaves one stream untouched when another is advanced', () => {
    const seed = 4242;

    const untouched = createSubStream(seed, SubStream.GamePiece);
    const expected = Array.from({ length: 10 }, () => untouched.nextUint32());

    const other = createSubStream(seed, SubStream.Physics);
    for (let i = 0; i < 500; i++) other.nextUint32();

    const rerun = createSubStream(seed, SubStream.GamePiece);
    const actual = Array.from({ length: 10 }, () => rerun.nextUint32());

    expect(actual).toEqual(expected);
  });
});

describe('Pcg32 — output ranges', () => {
  it('nextUint32 stays within [0, 2^32)', () => {
    const rng = new Pcg32(7, 7);
    for (let i = 0; i < 5000; i++) {
      const v = rng.nextUint32();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  it('nextFloat stays within [0, 1)', () => {
    const rng = new Pcg32(8, 8);
    for (let i = 0; i < 5000; i++) {
      const v = rng.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextRange stays within [min, max)', () => {
    const rng = new Pcg32(9, 9);
    for (let i = 0; i < 5000; i++) {
      const v = rng.nextRange(-3.5, 2.25);
      expect(v).toBeGreaterThanOrEqual(-3.5);
      expect(v).toBeLessThan(2.25);
    }
  });

  it('nextInt stays within [0, bound) and covers every value', () => {
    const rng = new Pcg32(10, 10);
    const bound = 6;
    const counts = new Array<number>(bound).fill(0);

    for (let i = 0; i < 60_000; i++) {
      const v = rng.nextInt(bound);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(bound);
      counts[v] = (counts[v] ?? 0) + 1;
    }

    // Uniformity is not the point of the test; total absence of a bucket, or a
    // grossly skewed one, would indicate a broken bounded-draw implementation.
    for (const c of counts) {
      expect(c).toBeGreaterThan(60_000 / bound / 2);
    }
  });

  it('rejects a non-positive or non-integer bound', () => {
    const rng = new Pcg32(11, 11);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(-4)).toThrow(RangeError);
    expect(() => rng.nextInt(2.5)).toThrow(RangeError);
  });
});
