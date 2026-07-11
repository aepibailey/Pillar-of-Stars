import { weapons, enemies, playerDef, wakeShipNames, ground, threatRewards, newShip } from './fixtures';
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
import type { EventDef } from '../src/events/types';

const config = configJson as GameConfig;
const events = eventsJson as unknown as EventDef[];
const deps: Deps = { events, config, weapons, enemies, playerDef, wakeShipNames, ground, threatRewards };

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
    let s = createRun('wakespace-seed', config, newShip());
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
      // Contact now launches real ship combat (M2), not a placeholder event.
      if (jumpWithRngSeed('casual', i).phase === 'combat') casualFights++;
      if (jumpWithRngSeed('sneak', i).phase === 'combat') sneakFights++;
    }
    expect(casualFights / N).toBeCloseTo(0.7, 1);
    expect(sneakFights / N).toBeCloseTo(0.3, 1);
  });

  it('a triggered fight launches combat; the fast approach grants a flee head start', () => {
    for (let i = 0; i < 200; i++) {
      const after = jumpWithRngSeed('fast', i);
      if (after.phase === 'combat') {
        expect(after.combat).not.toBeNull();
        expect(after.combat?.origin).toBe('wake-space');
        expect(after.combat?.player.fleeCharge).toBe(config.combat.fastApproachFleeHeadstart);
        return;
      }
    }
    throw new Error('no fight triggered in 200 fast entries — statistically impossible');
  });

  it('a casual-approach fight starts with no flee head start', () => {
    for (let i = 0; i < 200; i++) {
      const after = jumpWithRngSeed('casual', i);
      if (after.phase === 'combat') {
        expect(after.combat?.player.fleeCharge).toBe(0);
        return;
      }
    }
    throw new Error('no fight triggered in 200 casual entries — statistically impossible');
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

describe('entering a system as the Wake consumes it (§4 — never silent death)', () => {
  /** Get to system B via A, with a spare-fuel state ready to backtrack to A. */
  function atNeighbour(): { atB: RunState; A: string; B: string } {
    let s = createRun('wake-arrival-seed', config, newShip());
    s = reduce(s, { type: 'FINISH_INTRO' }, deps);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, deps);
    s = reduce(s, { type: 'ACK_OUTCOME' }, deps);
    const A = s.currentSystemId;
    const B = currentSector(s, config).systems[A].links[0];
    s = structuredClone(s);
    s.fuel = 99;
    let atB = reduce(s, { type: 'JUMP', toSystemId: B }, deps);
    expect(atB.phase).toBe('map'); // grace absorbs the first jump — no consumption
    atB = structuredClone(atB);
    atB.fuel = 99;
    return { atB, A, B };
  }

  it('backtracking into a system the front consumes THIS turn → Wake-space fight, not death', () => {
    const { atB, A } = atNeighbour();
    // Grace spent, progress poised so this jump's +1 advance consumes A (oldest
    // unconsumed on the trail) — the system being jumped INTO, this very turn.
    atB.wake = { consumedIds: [], graceHundredths: 0, progressHundredths: 0 };
    const back = reduce(atB, { type: 'JUMP', toSystemId: A }, deps);
    expect(back.deathCause).toBeUndefined(); // the old bug: unconditional 'wake' death
    expect(back.phase).toBe('combat'); // forced encounter instead
    expect(back.combat?.origin).toBe('wake-space');
    expect(back.wake.consumedIds).toContain(A); // the system did fall
  });

  it('jumping into the last dark system (whole trail eaten) → forced fight, not death', () => {
    const { atB, A, B } = atNeighbour();
    atB.wake = { consumedIds: [A, B], graceHundredths: 0, progressHundredths: 0 };
    const back = reduce(atB, { type: 'JUMP', toSystemId: A }, deps);
    expect(back.deathCause).toBeUndefined();
    expect(back.phase).toBe('combat');
    expect(back.combat?.origin).toBe('wake-space');
  });

  it('the forced encounter is survivable — the player can still flee/fight (not a game-over)', () => {
    const { atB, A } = atNeighbour();
    atB.wake = { consumedIds: [], graceHundredths: 0, progressHundredths: 0 };
    const back = reduce(atB, { type: 'JUMP', toSystemId: A }, deps);
    expect(back.combat?.outcome).toBe('ongoing'); // a live fight with choices, not death
  });
});
