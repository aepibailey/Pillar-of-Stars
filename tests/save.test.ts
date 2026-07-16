import { weapons, enemies, playerDef, wakeShipNames, ground, threatRewards, founders, speciesParts, newShip } from './fixtures';
import { describe, expect, it } from 'vitest';
import configJson from '../data/config.json';
import eventsJson from '../data/events/core.json';
import { createRun, currentSector, reduce, type Deps } from '../src/engine/reducer';
import { clearRun, loadRun, saveRun, type KeyValueStorage } from '../src/engine/save';
import type { GameConfig, RunState } from '../src/engine/types';
import type { EventDef } from '../src/events/types';

const config = configJson as GameConfig;
const events = eventsJson as unknown as EventDef[];
const deps: Deps = { events, config, weapons, enemies, playerDef, wakeShipNames, ground, threatRewards, founders, speciesParts };

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('save/resume (§13: at every decision point)', () => {
  it('round-trips a fresh run losslessly', () => {
    const storage = memoryStorage();
    const state = createRun('save-seed', config, newShip(), founders);
    saveRun(state, storage);
    expect(loadRun(storage)).toEqual(state);
  });

  it('round-trips mid-run state, and play continues identically after resume', () => {
    const storage = memoryStorage();
    let s = createRun('save-mid-seed', config, newShip(), founders);
    s = reduce(s, { type: 'FINISH_INTRO' }, deps);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 1 }, deps); // riskier option: uses rng
    s = reduce(s, { type: 'ACK_OUTCOME' }, deps);
    saveRun(s, storage);

    const resumed = loadRun(storage);
    expect(resumed).toEqual(s);

    // The next decision plays out identically from the saved copy — the rng
    // stream position survives serialization.
    const sector = currentSector(s, config);
    const node = sector.systems[s.currentSystemId].nodes[0];
    const a = reduce(s, { type: 'EXPLORE', nodeId: node.id }, deps);
    const b = reduce(resumed as RunState, { type: 'EXPLORE', nodeId: node.id }, deps);
    expect(a).toEqual(b);
  });

  it('returns null for missing, corrupt, or wrong-version saves', () => {
    const storage = memoryStorage();
    expect(loadRun(storage)).toBeNull();

    storage.setItem('pillar-of-stars.run', 'not json{{{');
    expect(loadRun(storage)).toBeNull();

    const state = createRun('ver-seed', config, newShip(), founders);
    saveRun({ ...state, schemaVersion: 999 }, storage);
    expect(loadRun(storage)).toBeNull();
  });

  it('clearRun removes the save', () => {
    const storage = memoryStorage();
    saveRun(createRun('clear-seed', config, newShip(), founders), storage);
    clearRun(storage);
    expect(loadRun(storage)).toBeNull();
  });
});
