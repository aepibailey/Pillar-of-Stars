import { weapons, enemies, playerDef, newShip } from './fixtures';
import { describe, expect, it } from 'vitest';
import configJson from '../data/config.json';
import eventsJson from '../data/events/core.json';
import { createRun, currentSector, isStranded, reduce, type Deps } from '../src/engine/reducer';
import { deriveSeed } from '../src/engine/rng';
import type { GameConfig, RunState } from '../src/engine/types';
import type { EventDef } from '../src/events/types';
import { nearestStationSystemId } from '../src/galaxy/search';
import type { Sector } from '../src/galaxy/types';

const config = configJson as GameConfig;
const events = eventsJson as unknown as EventDef[];
const deps: Deps = { events, config, weapons, enemies, playerDef };

/** A run stranded at its entry system: fuel 0, everything here surveyed. */
function strandedState(seed = 'stranding-seed'): RunState {
  let s = createRun(seed, config, newShip());
  s = reduce(s, { type: 'FINISH_INTRO' }, deps);
  s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, deps);
  s = reduce(s, { type: 'ACK_OUTCOME' }, deps);
  s = structuredClone(s);
  const sector = currentSector(s, config);
  s.exploredNodeIds = sector.systems[s.currentSystemId].nodes.map((n) => n.id);
  s.fuel = 0;
  expect(isStranded(s, config)).toBe(true);
  return s;
}

function withRoll(s: RunState, label: string): RunState {
  const varied = structuredClone(s);
  varied.rngState.events = deriveSeed('stranding-roll', label);
  return varied;
}

function firedTrigger(s: RunState): string | undefined {
  return events.find((e) => e.id === s.activeEvent?.defId)?.trigger.fixed;
}

/** Deps with rigged stranding odds, for forcing specific day outcomes. */
function riggedDeps(tow: number, robbery: number): Deps {
  const rigged = structuredClone(config);
  rigged.stranding.towChance = tow;
  rigged.stranding.robberyChance = robbery;
  return { ...deps, config: rigged };
}

describe('stranding preconditions', () => {
  it('WAIT_DAY is rejected when not stranded', () => {
    let s = createRun('not-stranded-seed', config, newShip());
    s = reduce(s, { type: 'FINISH_INTRO' }, deps);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, deps);
    s = reduce(s, { type: 'ACK_OUTCOME' }, deps);
    expect(isStranded(s, config)).toBe(false);
    const after = reduce(s, { type: 'WAIT_DAY' }, deps);
    expect(after).toBe(s);
  });
});

describe('the daily roll (mutually exclusive: 15% tow / 15% robbery / 70% quiet)', () => {
  it('frequencies track the configured chances', () => {
    const base = strandedState();
    const N = 3000;
    const counts = { tow: 0, robbery: 0, quiet: 0 };
    for (let i = 0; i < N; i++) {
      const after = reduce(withRoll(base, `dist:${i}`), { type: 'WAIT_DAY' }, deps);
      const trigger = firedTrigger(after);
      if (trigger === 'stranded-tow') counts.tow++;
      else if (trigger === 'stranded-robbery') counts.robbery++;
      else if (trigger === 'stranded-quiet') counts.quiet++;
    }
    expect(counts.tow + counts.robbery + counts.quiet).toBe(N);
    expect(counts.tow / N).toBeCloseTo(config.stranding.towChance, 1);
    expect(counts.robbery / N).toBeCloseTo(config.stranding.robberyChance, 1);
    expect(counts.quiet / N).toBeCloseTo(
      1 - config.stranding.towChance - config.stranding.robberyChance,
      1,
    );
  });

  it('is deterministic: same state, same day, same outcome', () => {
    const base = strandedState();
    const a = reduce(withRoll(base, 'det'), { type: 'WAIT_DAY' }, deps);
    const b = reduce(withRoll(base, 'det'), { type: 'WAIT_DAY' }, deps);
    expect(a).toEqual(b);
  });
});

describe('the day-by-day sequence (all quiet days, rigged odds)', () => {
  it('Wake advances 1 jump on days 2 and 4 only; day 5 unrescued = adrift death', () => {
    const quietDeps = riggedDeps(0, 0);
    let s = strandedState();
    // Grace intact (3 jumps): the day-2/day-4 advances eat grace, which is
    // exactly measurable and keeps the front from reaching the drifter.
    const graceBefore = s.wake.graceHundredths;

    const expectedGraceSpentAfterDay = [0, 0, 100, 100, 200, 200]; // index = day
    for (let day = 1; day <= 5; day++) {
      s = reduce(s, { type: 'WAIT_DAY' }, quietDeps);
      expect(s.phase).toBe('event');
      expect(firedTrigger(s)).toBe('stranded-quiet');
      expect(s.strandedDays).toBe(day);
      expect(graceBefore - s.wake.graceHundredths).toBe(expectedGraceSpentAfterDay[day]);
      s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, quietDeps);
      s = reduce(s, { type: 'ACK_OUTCOME' }, quietDeps);
      if (day < 5) {
        expect(s.phase).toBe('map'); // still adrift, still alive
      }
    }
    expect(s.phase).toBe('dead');
    expect(s.deathCause).toBe('adrift');
  });

  it('with grace spent and the front at the door, the day-2 advance finds the drifter', () => {
    const quietDeps = riggedDeps(0, 0);
    let s = strandedState();
    // Trail is just the entry system the player is sitting on; no grace left.
    s.wake.graceHundredths = 0;
    s = reduce(s, { type: 'WAIT_DAY' }, quietDeps); // day 1: no advance due
    expect(s.phase).toBe('event');
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, quietDeps);
    s = reduce(s, { type: 'ACK_OUTCOME' }, quietDeps);
    expect(s.phase).toBe('map');
    s = reduce(s, { type: 'WAIT_DAY' }, quietDeps); // day 2: the front arrives
    expect(s.phase).toBe('dead');
    expect(s.deathCause).toBe('wake');
  });

  it('a 6th wait is impossible — the run is already over', () => {
    const quietDeps = riggedDeps(0, 0);
    let s = strandedState();
    for (let day = 1; day <= 5; day++) {
      s = reduce(s, { type: 'WAIT_DAY' }, quietDeps);
      s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, quietDeps);
      s = reduce(s, { type: 'ACK_OUTCOME' }, quietDeps);
    }
    expect(s.phase).toBe('dead');
    const after = reduce(s, { type: 'WAIT_DAY' }, quietDeps);
    expect(after).toBe(s);
  });
});

describe('tow (rigged to always fire)', () => {
  const towDeps = riggedDeps(1, 0);

  it('moves the player to the BFS-nearest station system and resets the clock', () => {
    const s = strandedState();
    s.strandedDays = 2; // mid-stranding
    const sector = currentSector(s, config);
    const expected = nearestStationSystemId(sector, s.currentSystemId);
    const after = reduce(s, { type: 'WAIT_DAY' }, towDeps);
    expect(firedTrigger(after)).toBe('stranded-tow');
    expect(after.strandedDays).toBe(0);
    if (expected) {
      expect(after.currentSystemId).toBe(expected);
      const there = sector.systems[after.currentSystemId];
      expect(there.nodes.some((n) => n.type === 'station')).toBe(true);
      expect(after.visitOrder).toContain(expected);
    }
  });

  it('fuel purchases respect data-driven requirements', () => {
    const s = strandedState();
    s.scrap = 2;
    let after = reduce(s, { type: 'WAIT_DAY' }, towDeps);
    // "Buy 6 fuel — 4 scrap" (option 1) needs 4 scrap: rejected.
    const denied = reduce(after, { type: 'RESOLVE_OPTION', optionIndex: 1 }, towDeps);
    expect(denied).toBe(after);
    // "Buy 3 fuel — 2 scrap" (option 0) is affordable: applied.
    after = reduce(after, { type: 'RESOLVE_OPTION', optionIndex: 0 }, towDeps);
    after = reduce(after, { type: 'ACK_OUTCOME' }, towDeps);
    expect(after.fuel).toBe(3);
    expect(after.scrap).toBe(0);
    expect(isStranded(after, config)).toBe(false); // fueled = stranding over
  });

  it('a broke player can decline, staying stranded with a fresh clock', () => {
    const s = strandedState();
    s.scrap = 0;
    s.strandedDays = 4;
    let after = reduce(s, { type: 'WAIT_DAY' }, towDeps);
    after = reduce(after, { type: 'RESOLVE_OPTION', optionIndex: 3 }, towDeps); // just the tow
    after = reduce(after, { type: 'ACK_OUTCOME' }, towDeps);
    // May or may not still be stranded (the station system can hold unexplored
    // nodes with a free closer); if stranded, the clock re-armed at 0.
    if (isStranded(after, config)) {
      expect(after.phase).toBe('map');
      expect(after.strandedDays).toBe(0);
    }
  });
});

describe('robbery (rigged to always fire)', () => {
  const robDeps = riggedDeps(0, 1);

  it('data contract: the win pays scrap + 4 fuel; the loss is death (designer ruling)', () => {
    const def = events.find((e) => e.trigger.fixed === 'stranded-robbery') as EventDef;
    const win = def.options[0].outcomes.find((o) => o.tags?.includes('win'));
    const lose = def.options[0].outcomes.find((o) => o.tags?.includes('lose'));
    expect(win?.effects?.fuel).toBe(4);
    expect((win?.effects?.scrap ?? 0) > 0).toBe(true);
    expect(lose?.effects?.death).toBe('robbed');
  });

  it('winning the fight refuels and ends the stranding', () => {
    const base = strandedState();
    for (let i = 0; i < 100; i++) {
      let s = reduce(withRoll(base, `rob-win:${i}`), { type: 'WAIT_DAY' }, robDeps);
      s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, robDeps);
      if (!s.deathCause) {
        s = reduce(s, { type: 'ACK_OUTCOME' }, robDeps);
        expect(s.phase).toBe('map');
        expect(s.fuel).toBe(4);
        expect(s.strandedDays).toBe(0); // fueled again — stranding over
        return;
      }
    }
    throw new Error('no winning fight in 100 rolls — statistically impossible');
  });

  it('losing the fight kills on acknowledgement', () => {
    const base = strandedState();
    for (let i = 0; i < 100; i++) {
      let s = reduce(withRoll(base, `rob-lose:${i}`), { type: 'WAIT_DAY' }, robDeps);
      s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, robDeps);
      if (s.deathCause === 'robbed') {
        expect(s.phase).toBe('event'); // the player reads the outcome first
        s = reduce(s, { type: 'ACK_OUTCOME' }, robDeps);
        expect(s.phase).toBe('dead');
        expect(s.deathCause).toBe('robbed');
        return;
      }
    }
    throw new Error('no losing fight in 100 rolls — statistically impossible');
  });
});

describe('nearestStationSystemId (BFS)', () => {
  function miniSector(links: Record<string, string[]>, stations: string[]): Sector {
    const systemIds = Object.keys(links);
    return {
      index: 0,
      name: 'Test',
      systems: Object.fromEntries(
        systemIds.map((id) => [
          id,
          {
            id,
            name: id,
            x: 0.5,
            y: 0.5,
            links: links[id],
            nodes: stations.includes(id)
              ? [{ id: `${id}-n0`, type: 'station' as const, name: 'Station' }]
              : [{ id: `${id}-n0`, type: 'planet' as const, name: 'Planet' }],
          },
        ]),
      ),
      systemIds,
      entrySystemId: systemIds[0],
      gateSystemId: systemIds[systemIds.length - 1],
      ruinSystemId: systemIds[0],
      extraRuinSystemIds: [],
      grid: { cols: 4, rows: 4 },
      waypointCell: { col: 0, row: 0 },
    };
  }

  it('finds the closest station by hop count, including the start system', () => {
    const sector = miniSector({ a: ['b'], b: ['a', 'c'], c: ['b', 'd'], d: ['c'] }, ['c']);
    expect(nearestStationSystemId(sector, 'a')).toBe('c');
    expect(nearestStationSystemId(sector, 'c')).toBe('c');
  });

  it('prefers the nearer of two stations', () => {
    const sector = miniSector({ a: ['b'], b: ['a', 'c'], c: ['b', 'd'], d: ['c'] }, ['b', 'd']);
    expect(nearestStationSystemId(sector, 'a')).toBe('b');
  });

  it('returns null when the sector rolled no stations', () => {
    const sector = miniSector({ a: ['b'], b: ['a'] }, []);
    expect(nearestStationSystemId(sector, 'a')).toBeNull();
  });
});
