/**
 * FNV-1a state hashing, used by the golden determinism test.
 *
 * The point is not cryptographic strength — it is that the same simulation run
 * on the same machine must produce the same digest every time, and that any
 * accidental nondeterminism (unordered iteration, ambient entropy, a wall-clock
 * leak) changes it immediately and visibly.
 *
 * Doubles are absorbed by their exact IEEE-754 bytes rather than by decimal
 * formatting, so a difference in the last bit is caught rather than rounded
 * away.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export class StateHasher {
  private h = FNV_OFFSET_BASIS;
  private readonly buffer = new ArrayBuffer(8);
  private readonly f64 = new Float64Array(this.buffer);
  private readonly i32 = new Int32Array(this.buffer);
  private readonly bytes = new Uint8Array(this.buffer);

  pushByte(b: number): this {
    this.h = Math.imul(this.h ^ (b & 0xff), FNV_PRIME) >>> 0;
    return this;
  }

  pushInt32(v: number): this {
    this.i32[0] = v | 0;
    for (let i = 0; i < 4; i++) this.pushByte(this.bytes[i] ?? 0);
    return this;
  }

  /**
   * Absorb a double by its exact bit pattern.
   *
   * `-0` is normalised to `+0` first: the two are `===` equal and physically
   * identical, but have different bit patterns, so hashing them differently
   * would report a false determinism failure.
   */
  pushFloat(v: number): this {
    this.f64[0] = v === 0 ? 0 : v;
    for (let i = 0; i < 8; i++) this.pushByte(this.bytes[i] ?? 0);
    return this;
  }

  pushString(s: string): this {
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      this.pushByte(code & 0xff).pushByte((code >>> 8) & 0xff);
    }
    return this;
  }

  pushBigInt(v: bigint): this {
    return this.pushString(v.toString(16));
  }

  /** Digest as an unsigned 32-bit integer. */
  digest(): number {
    return this.h >>> 0;
  }

  /** Digest as 8 lower-case hex characters. */
  digestHex(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0');
  }
}

/** Convenience: hash a flat sequence of numbers. */
export function hashNumbers(values: readonly number[]): string {
  const hasher = new StateHasher();
  for (const v of values) hasher.pushFloat(v);
  return hasher.digestHex();
}
