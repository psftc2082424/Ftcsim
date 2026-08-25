import { describe, expect, it } from 'vitest';
import { StateHasher, hashNumbers } from './hash.js';

describe('StateHasher — reference behaviour', () => {
  /**
   * FNV-1a 32-bit published test vectors. Matching these proves the constants
   * and the byte-at-a-time loop are right, not merely self-consistent.
   */
  it('reproduces published FNV-1a 32-bit vectors', () => {
    const hashAscii = (s: string): string => {
      const h = new StateHasher();
      for (let i = 0; i < s.length; i++) h.pushByte(s.charCodeAt(i));
      return h.digestHex();
    };

    expect(hashAscii('')).toBe('811c9dc5');
    expect(hashAscii('a')).toBe('e40c292c');
    expect(hashAscii('foobar')).toBe('bf9cf968');
  });
});

describe('StateHasher — determinism', () => {
  it('returns the same digest for the same input sequence', () => {
    const build = (): string =>
      new StateHasher().pushFloat(1.5).pushInt32(-42).pushString('robot').digestHex();

    expect(build()).toBe(build());
  });

  it('produces a fixed-width lower-case hex digest', () => {
    for (const v of [0, 1, -1, 1e30, Math.PI]) {
      expect(new StateHasher().pushFloat(v).digestHex()).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

describe('StateHasher — sensitivity', () => {
  it('detects a one-bit difference in a double', () => {
    const a = new StateHasher().pushFloat(1.0).digestHex();
    const b = new StateHasher().pushFloat(1.0000000000000002).digestHex();
    expect(a).not.toBe(b);
  });

  it('detects reordering', () => {
    expect(hashNumbers([1, 2, 3])).not.toBe(hashNumbers([3, 2, 1]));
  });

  it('detects a changed length', () => {
    expect(hashNumbers([1, 2, 3])).not.toBe(hashNumbers([1, 2, 3, 0]));
  });

  it('distinguishes an integer pushed as int32 from the same value as a float', () => {
    const asInt = new StateHasher().pushInt32(7).digestHex();
    const asFloat = new StateHasher().pushFloat(7).digestHex();
    expect(asInt).not.toBe(asFloat);
  });
});

describe('StateHasher — negative zero normalisation', () => {
  /**
   * -0 and +0 are `===` equal and physically identical, but have different bit
   * patterns. Hashing them differently would report a false determinism failure
   * whenever a velocity happened to settle on -0.
   */
  it('hashes -0 and +0 identically', () => {
    expect(new StateHasher().pushFloat(-0).digestHex()).toBe(
      new StateHasher().pushFloat(0).digestHex(),
    );
  });

  it('still distinguishes -0 from other small values', () => {
    expect(new StateHasher().pushFloat(-0).digestHex()).not.toBe(
      new StateHasher().pushFloat(-1e-300).digestHex(),
    );
  });
});

describe('StateHasher — bigint absorption', () => {
  it('distinguishes different bigints', () => {
    const a = new StateHasher().pushBigInt(0xdeadbeefn).digestHex();
    const b = new StateHasher().pushBigInt(0xdeadbeefn + 1n).digestHex();
    expect(a).not.toBe(b);
  });
});
