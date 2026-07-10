import { describe, expect, it } from 'vitest';
import {
  advanceWake,
  createWakeState,
  isConsumed,
  jumpsBehind,
  toHundredths,
} from '../src/threat/wake';

describe('the Wake (path-following pursuit, fractional advance)', () => {
  it('toHundredths is exact for the tuning values in play', () => {
    expect(toHundredths(1)).toBe(100);
    expect(toHundredths(0.2)).toBe(20);
    expect(toHundredths(3)).toBe(300);
  });

  it('holds during the grace period', () => {
    let wake = createWakeState(2);
    const r1 = advanceWake(wake, ['a', 'b'], 'b', 1);
    expect(r1.wake.consumedIds).toEqual([]);
    expect(r1.wake.graceHundredths).toBe(100);
    expect(r1.caught).toBe(false);
    wake = r1.wake;
    const r2 = advanceWake(wake, ['a', 'b', 'c'], 'c', 1);
    expect(r2.wake.consumedIds).toEqual([]);
    expect(r2.wake.graceHundredths).toBe(0);
  });

  it('fractional advances eat grace exactly', () => {
    const wake = createWakeState(0.5);
    const r = advanceWake(wake, ['a', 'b'], 'b', 0.2);
    expect(r.wake.graceHundredths).toBe(30);
    expect(r.wake.progressHundredths).toBe(0);
    expect(r.wake.consumedIds).toEqual([]);
  });

  it('an advance spilling past grace carries the remainder into progress', () => {
    const wake = createWakeState(0.5);
    const r = advanceWake(wake, ['a', 'b'], 'b', 1);
    expect(r.wake.graceHundredths).toBe(0);
    expect(r.wake.progressHundredths).toBe(50);
    expect(r.wake.consumedIds).toEqual([]);
  });

  it('consumes the trail oldest-first after grace', () => {
    let wake = createWakeState(0);
    const r1 = advanceWake(wake, ['a', 'b', 'c'], 'c', 1);
    expect(r1.wake.consumedIds).toEqual(['a']);
    wake = r1.wake;
    const r2 = advanceWake(wake, ['a', 'b', 'c', 'd'], 'd', 1);
    expect(r2.wake.consumedIds).toEqual(['a', 'b']);
  });

  it('five 0.2 explorations add up to exactly one consumption (no float drift)', () => {
    let wake = createWakeState(0);
    for (let i = 0; i < 4; i++) {
      const r = advanceWake(wake, ['a', 'b'], 'b', 0.2);
      wake = r.wake;
      expect(wake.consumedIds).toEqual([]);
    }
    const r = advanceWake(wake, ['a', 'b'], 'b', 0.2);
    expect(r.wake.consumedIds).toEqual(['a']);
    expect(r.wake.progressHundredths).toBe(0);
  });

  it('catches the player when the front arrives where they stand', () => {
    const wake = { consumedIds: ['a'], graceHundredths: 0, progressHundredths: 0 };
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

  it('transiting already-consumed space is a survivable gamble', () => {
    let wake = createWakeState(0);
    const order = ['a', 'b', 'c'];
    let r = advanceWake(wake, order, 'b', 1); // Wake eats a
    expect(r.caught).toBe(false);
    wake = r.wake;
    r = advanceWake(wake, order, 'c', 1); // Wake eats b
    expect(r.caught).toBe(false);
    wake = r.wake;
    // Player desperately transits back into consumed b; Wake eats c behind them.
    r = advanceWake(wake, order, 'b', 1);
    expect(r.caught).toBe(false);
    expect(r.wake.consumedIds).toEqual(['a', 'b', 'c']);
    wake = r.wake;
    // But once the whole trail is eaten, the next due consumption finds YOU.
    r = advanceWake(wake, order, 'c', 1);
    expect(r.caught).toBe(true);
  });

  it('a fractional advance with a fully-eaten trail does NOT catch (no consumption due)', () => {
    const wake = { consumedIds: ['a', 'b'], graceHundredths: 0, progressHundredths: 0 };
    const r = advanceWake(wake, ['a', 'b'], 'b', 0.2);
    expect(r.caught).toBe(false);
    expect(r.wake.progressHundredths).toBe(20);
  });

  it('a multi-jump advance (probe transmission) consumes several at once', () => {
    const wake = createWakeState(0);
    const r = advanceWake(wake, ['a', 'b', 'c', 'd'], 'd', 2);
    expect(r.wake.consumedIds).toEqual(['a', 'b']);
    expect(r.caught).toBe(false);
  });

  it('isConsumed and jumpsBehind report correctly', () => {
    const wake = { consumedIds: ['a'], graceHundredths: 100, progressHundredths: 20 };
    expect(isConsumed(wake, 'a')).toBe(true);
    expect(isConsumed(wake, 'b')).toBe(false);
    // trail a,b,c; a eaten; player at c → 1 grace + 2 unconsumed - 0.2 progress = 2.8
    expect(jumpsBehind(wake, ['a', 'b', 'c'], 'c')).toBeCloseTo(2.8, 10);
  });
});
