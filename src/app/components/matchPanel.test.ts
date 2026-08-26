/**
 * The two derived values the match panel shows.
 *
 * Presentation is not tested here — there is no DOM in this suite by design
 * (ARCHITECTURE.md §3.1) — but a clock that rounds the wrong way or a remaining
 * time that goes negative is a real bug, and both are pure functions.
 */

import { describe, expect, it } from 'vitest';
import { clock, remainingLabel } from './MatchPanel.js';
import { DECODE_GAME } from '../../core/game/fixtures/decodeGame.js';
import { totalMatchDurationSec } from '../../core/game/matchStructure.js';
import type { MatchStatus } from '../simRunner.js';

const status = (matchTimeSec: number): MatchStatus => ({
  state: 'AUTO',
  matchTimeSec,
  red: 0,
  blue: 0,
  recentAwards: [],
});

describe('match clock formatting', () => {
  it('reads as minutes and seconds', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(9)).toBe('0:09');
    expect(clock(60)).toBe('1:00');
    expect(clock(158)).toBe('2:38');
  });

  /** A clock counts elapsed whole seconds; it does not round up to the next. */
  it('floors rather than rounds', () => {
    expect(clock(9.99)).toBe('0:09');
    expect(clock(59.999)).toBe('0:59');
  });

  it('never shows a negative time', () => {
    expect(clock(-5)).toBe('0:00');
  });
});

describe('remaining time', () => {
  const total = totalMatchDurationSec(DECODE_GAME.match);

  it('starts at the full match duration', () => {
    // 30 s AUTO + 8 s transition + 120 s TELEOP.
    expect(total).toBe(158);
    expect(remainingLabel(DECODE_GAME, status(0))).toBe('2:38');
  });

  it('counts down as the match runs', () => {
    expect(remainingLabel(DECODE_GAME, status(38))).toBe('2:00');
    expect(remainingLabel(DECODE_GAME, status(total - 1))).toBe('0:01');
  });

  it('holds at zero past the end rather than going negative', () => {
    expect(remainingLabel(DECODE_GAME, status(total))).toBe('0:00');
    expect(remainingLabel(DECODE_GAME, status(total + 30))).toBe('0:00');
  });
});
