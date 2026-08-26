/**
 * PCG32 — the only source of randomness inside `core/`.
 *
 * `Math.random` is lint-banned in `core/` because it is unseeded and would make
 * replays and golden-hash tests impossible (ARCHITECTURE.md §9.1).
 *
 * PCG32 is used specifically for its **stream** parameter. Each subsystem draws
 * from its own sub-stream, so adding a random draw in one subsystem cannot shift
 * the sequence another subsystem sees. That property is what keeps determinism
 * tests stable as features land, rather than turning every new feature into a
 * golden-hash rebaseline.
 *
 * The 64-bit state is held as a `bigint`. This is the reference algorithm
 * transcribed exactly, so output is verifiable against the published PCG test
 * vectors. If profiling ever shows the generator hot, a split 32-bit
 * implementation can replace it while producing identical output — nothing in
 * the public surface would change. Phase 1 draws no random numbers at all inside
 * the physics loop.
 *
 * Reference: M.E. O'Neill, "PCG: A Family of Simple Fast Space-Efficient
 * Statistically Good Algorithms for Random Number Generation" (2014),
 * `pcg32_random_r` / `pcg32_srandom_r`.
 */

const MULTIPLIER = 6364136223846793005n;
const MASK_64 = (1n << 64n) - 1n;
const TWO_POW_32 = 0x1_0000_0000;

/**
 * Sub-stream identifiers. One per subsystem that may ever draw a random number.
 * Values must remain stable: changing one silently changes every replay that
 * depends on it.
 */
export const SubStream = {
  Physics: 1,
  Mechanism: 2,
  GamePiece: 3,
  Scenario: 4,
  /** Shooter accuracy spread. Added after Scenario, so no existing id moves. */
  Launch: 5,
} as const;

export type SubStreamId = (typeof SubStream)[keyof typeof SubStream];

export class Pcg32 {
  private state: bigint;
  /** Stream selector. Fixed at construction; only `clone()` ever reassigns it. */
  private inc: bigint;

  constructor(seed: bigint | number, stream: bigint | number = 0) {
    const initState = BigInt.asUintN(64, BigInt(seed));
    const initSeq = BigInt.asUintN(64, BigInt(stream));

    this.state = 0n;
    this.inc = ((initSeq << 1n) | 1n) & MASK_64;
    this.advance();
    this.state = (this.state + initState) & MASK_64;
    this.advance();
  }

  /** One step of the LCG; returns the permuted 32-bit output of the old state. */
  private advance(): number {
    const old = this.state;
    this.state = (old * MULTIPLIER + this.inc) & MASK_64;

    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
    const rot = Number((old >> 59n) & 31n);

    return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
  }

  /** Next raw 32-bit value, in [0, 2³²). */
  nextUint32(): number {
    return this.advance();
  }

  /** Next float in [0, 1). */
  nextFloat(): number {
    return this.advance() / TWO_POW_32;
  }

  /** Next float in [min, max). */
  nextRange(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }

  /**
   * Uniform integer in [0, boundExclusive), free of modulo bias.
   * Uses PCG's bounded method: reject the low block that would skew the result.
   */
  nextInt(boundExclusive: number): number {
    if (!Number.isInteger(boundExclusive) || boundExclusive <= 0) {
      throw new RangeError(`nextInt bound must be a positive integer, got ${boundExclusive}`);
    }
    const threshold = (TWO_POW_32 - boundExclusive) % boundExclusive;
    for (;;) {
      const r = this.advance();
      if (r >= threshold) return r % boundExclusive;
    }
  }

  nextBool(): boolean {
    return (this.advance() & 1) === 1;
  }

  /** Exact copy, including position in the sequence. */
  clone(): Pcg32 {
    const copy = new Pcg32(0, 0);
    copy.state = this.state;
    copy.inc = this.inc;
    return copy;
  }

  /** Internal state, for snapshotting and determinism assertions. */
  getState(): { state: bigint; inc: bigint } {
    return { state: this.state, inc: this.inc };
  }
}

/**
 * Build the generator for one subsystem from the simulation's master seed.
 * Every subsystem gets an independent sequence from the same seed.
 */
export function createSubStream(masterSeed: bigint | number, stream: SubStreamId): Pcg32 {
  return new Pcg32(masterSeed, stream);
}
