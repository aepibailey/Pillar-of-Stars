import { describe, expect, it } from 'vitest';
import { advanceWake, createWakeState, isConsumed, jumpsBehind } from '../src/threat/wake';

describe('the Wake (path-following pursuit)', () => {
  it('holds during the grace period', () => {
    let wake = createWakeState(2);
    const r1 = advanceWake(wake, ['a', 'b'], 'b', 1);
    expect(r1.wake.consumedIds).toEqual([]);
    expect(r1.wake.graceRemaining).toBe(1);
    expect(r1.caught).toBe(false);
    wake = r1.wake;
    const r2 = advanceWake(wake, ['a', 'b', 'c'], 'c', 1);
    expect(r2.wake.consumedIds).toEqual([]);
    expect(r2.wake.graceRemaining).toBe(0);
  });

  it('consumes the trail oldest-first after grace', () => {
    let wake = createWakeState(0);
    const r1 = advanceWake(wake, ['a', 'b', 'c'], 'c', 1);
    expect(r1.wake.consumedIds).toEqual(['a']);
    wake = r1.wake;
    const r2 = advanceWake(wake, ['a', 'b', 'c', 'd'], 'd', 1);
    expect(r2.wake.consumedIds).toEqual(['a', 'b']);
  });

  it('catches the player when their current system is consumed', () => {
    const wake = { consumedIds: ['a'], graceRemaining: 0 };
    // Player backtracked to b, which is next on the trail.
    const r = advanceWake(wake, ['a', 'b', 'c'], 'b', 1);
    expect(r.caught).toBe(true);
  });

  it('a player who keeps finding new systems stays ahead', () => {
    let wake = createWakeState(0);
    const order = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let i = 1; i < order.length; i++) {
      const r = advanceWake(wake, order.slice(0, i + 1), order[i], 1);
      wake = r.wake;
      expect(r.caught).toBe(false);
    }
    expect(wake.consumedIds).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('milling around visited systems lets the Wake eat the whole trail', () => {
    let wake = createWakeState(0);
    const order = ['a', 'b', 'c'];
    let r = advanceWake(wake, order, 'b', 1); // Wake eats a
    expect(r.caught).toBe(false);
    wake = r.wake;
    r = advanceWake(wake, order, 'c', 1); // Wake eats b
    expect(r.caught).toBe(false);
    wake = r.wake;
    // Player desperately transits back into consumed b; Wake eats c behind them.
    // Not caught — transit through consumed space is a survivable gamble.
    r = advanceWake(wake, order, 'b', 1);
    expect(r.caught).toBe(false);
    expect(r.wake.consumedIds).toEqual(['a', 'b', 'c']);
    wake = r.wake;
    // But once the whole trail is eaten, the next advance finds YOU.
    r = advanceWake(wake, order, 'c', 1);
    expect(r.caught).toBe(true);
  });

  it('is caught when the front arrives at the system the player occupies', () => {
    const wake = { consumedIds: ['a', 'b'], graceRemaining: 0 };
    // Player stands on c (next on the trail) as the Wake advances onto it.
    const r = advanceWake(wake, ['a', 'b', 'c'], 'c', 1);
    expect(r.caught).toBe(true);
  });

  it('respects consumesPerJump (the surge knob for §6.4 later)', () => {
    const wake = createWakeState(0);
    const r = advanceWake(wake, ['a', 'b', 'c', 'd'], 'd', 2);
    expect(r.wake.consumedIds).toEqual(['a', 'b']);
  });

  it('isConsumed and jumpsBehind report correctly', () => {
    const wake = { consumedIds: ['a'], graceRemaining: 1 };
    expect(isConsumed(wake, 'a')).toBe(true);
    expect(isConsumed(wake, 'b')).toBe(false);
    // trail a,b,c; a eaten; player at c → grace(1) + unconsumed before/incl c (b,c = 2) = 3
    expect(jumpsBehind(wake, ['a', 'b', 'c'], 'c')).toBe(3);
  });
});
