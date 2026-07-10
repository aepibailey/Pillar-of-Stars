import { describe, expect, it } from 'vitest';
import configJson from '../data/config.json';
import eventsJson from '../data/events/core.json';
import {
  createRun,
  currentSector,
  reduce,
  wakeFightChance,
  type Deps,
} from '../src/engine/reducer';
import { deriveSeed } from '../src/engine/rng';
import type { GameConfig, RunState, WakeApproach } from '../src/engine/types';
import type { EventDef, EventOption } from '../src/events/types';

const config = configJson as GameConfig;
const events = eventsJson as unknown as EventDef[];
const deps: Deps = { events, config };

describe('wake-space approach math (patch §6)', () => {
  it('base fight chances match the spec', () => {
    expect(wakeFightChance(config, 'casual', 0)).toBe(0.7);
    expect(wakeFightChance(config, 'fast', 0)).toBe(0.6);
    expect(wakeFightChance(config, 'sneak', 0)).toBe(0.3);
  });

  it('sneak improves with sensor level (5%/level), clamped at zero', () => {
    expect(wakeFightChance(config, 'sneak', 1)).toBeCloseTo(0.25, 10);
    expect(wakeFightChance(config, 'sneak', 3)).toBeCloseTo(0.15, 10);
    expect(wakeFightChance(config, 'sneak', 99)).toBe(0);
    // sensors never help the loud approaches
    expect(wakeFightChance(config, 'casual', 5)).toBe(0.7);
    expect(wakeFightChance(config, 'fast', 5)).toBe(0.6);
  });
});

describe('wake-space entry integration', () => {
  function baseState(): { s: RunState; targetId: string } {
    let s = createRun('wakespace-seed', config);
    s = reduce(s, { type: 'FINISH_INTRO' }, deps);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, deps);
    s = reduce(s, { type: 'ACK_OUTCOME' }, deps);
    const sector = currentSector(s, config);
    const targetId = sector.systems[s.currentSystemId].links[0];
    s = structuredClone(s);
    s.fuel = 99;
    s.wake.consumedIds = [targetId]; // the neighbor has fallen to the Wake
    return { s, targetId };
  }

  function jumpWithRngSeed(approach: WakeApproach, i: number): RunState {
    const { s, targetId } = baseState();
    const varied = structuredClone(s);
    varied.rngState.events = deriveSeed(`wakespace-roll:${i}`, approach);
    return reduce(varied, { type: 'JUMP', toSystemId: targetId, approach }, deps);
  }

  it('contact frequency tracks the configured chance (~70% casual, ~30% sneak)', () => {
    const N = 1500;
    let casualFights = 0;
    let sneakFights = 0;
    for (let i = 0; i < N; i++) {
      if (jumpWithRngSeed('casual', i).phase === 'event') casualFights++;
      if (jumpWithRngSeed('sneak', i).phase === 'event') sneakFights++;
    }
    expect(casualFights / N).toBeCloseTo(0.7, 1);
    expect(sneakFights / N).toBeCloseTo(0.3, 1);
  });

  it('a triggered fight fires the placeholder event matching the approach', () => {
    for (let i = 0; i < 200; i++) {
      const after = jumpWithRngSeed('fast', i);
      if (after.phase === 'event') {
        const def = events.find((e) => e.id === after.activeEvent?.defId);
        expect(def?.trigger.fixed).toBe('wake-fight-fast');
        return;
      }
    }
    throw new Error('no fight triggered in 200 fast entries — statistically impossible');
  });

  it('charges the approach fuel cost on entry', () => {
    const { s, targetId } = baseState();
    const after = reduce(s, { type: 'JUMP', toSystemId: targetId, approach: 'sneak' }, deps);
    expect(after.fuel).toBe(s.fuel - config.wakeSpace.sneak.fuelCost);
  });

  it('is deterministic: same state, same approach, same result', () => {
    const a = jumpWithRngSeed('casual', 7);
    const b = jumpWithRngSeed('casual', 7);
    expect(a).toEqual(b);
  });
});

describe('fight event data contracts', () => {
  const normal = events.find((e) => e.trigger.fixed === 'wake-fight') as EventDef;
  const fast = events.find((e) => e.trigger.fixed === 'wake-fight-fast') as EventDef;

  function expectedLoss(option: EventOption): number {
    const total = option.outcomes.reduce((sum, o) => sum + o.weight, 0);
    return option.outcomes.reduce((sum, o) => {
      const loss = -(o.effects?.fuel ?? 0) - (o.effects?.scrap ?? 0);
      return sum + (o.weight / total) * loss;
    }, 0);
  }

  it('both fight events exist with fight and flee options', () => {
    expect(normal.options.length).toBeGreaterThanOrEqual(2);
    expect(fast.options.length).toBeGreaterThanOrEqual(2);
  });

  it("the fast approach's flee option carries reduced consequences", () => {
    // Option order contract: [0] stand and fight, [1] break and run.
    expect(expectedLoss(fast.options[1])).toBeLessThan(expectedLoss(normal.options[1]));
  });
});
