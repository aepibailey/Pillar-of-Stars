import { describe, expect, it } from 'vitest';
import { config, deps, founders, newRun } from './fixtures';
import { reduce } from '../src/engine/reducer';

describe('founding couple at run creation (v0.7 §6.0)', () => {
  const s = newRun('founders-seed');

  it('creates TWO founding characters: captain + spouse', () => {
    expect(s.characters).toHaveLength(2);
    const captain = s.characters.find((c) => c.id === s.captainId)!;
    const spouse = s.characters.find((c) => c.id !== s.captainId)!;
    expect(captain.role).toBe('captain');
    expect(spouse.role).toBe('crew');
    expect(captain.name).toBe(founders.captain.name);
    expect(spouse.name).toBe(founders.spouse.name);
    expect(s.founderIds.sort()).toEqual([captain.id, spouse.id].sort());
  });

  it('the spouse pre-fills the §6.3 companion slot from minute one', () => {
    expect(s.companionId).not.toBeNull();
    expect(s.companionId).not.toBe(s.captainId);
    expect(s.founderIds).toContain(s.companionId);
  });

  it('both founders are desertion-immune while alive (v0.7 §6.2)', () => {
    for (const ch of s.characters) {
      expect(ch.isFounder).toBe(true);
      expect(ch.desertionImmune).toBe(true);
      expect(ch.alive).toBe(true);
    }
  });

  it('mechanical asymmetry comes from background: independent skills/traits', () => {
    const captain = s.characters.find((c) => c.id === s.captainId)!;
    const spouse = s.characters.find((c) => c.id !== s.captainId)!;
    expect(captain.background).toBe(founders.captain.background);
    expect(spouse.background).toBe(founders.spouse.background);
    expect(captain.skills).not.toEqual(spouse.skills);
  });

  it('ASCEND starts unlocked; ironman starts off', () => {
    expect(s.ascendLocked).toBe(false);
    expect(s.ironman).toBe(false);
  });
});

describe('begin-again meta-progression (§6.4: knowledge only)', () => {
  it('NEW_RUN carries the codex forward — and nothing else', () => {
    let s = newRun('carry-seed');
    s = structuredClone(s);
    s.codex.entries = ['morph:avian', 'gov:hive'];
    s.scrap = 999;
    s.characters[0].xp = 500;
    s.ascendLocked = true;
    const fresh = reduce(s, { type: 'NEW_RUN', seed: 'carry-seed-2' }, deps);
    expect(fresh.codex.entries).toEqual(['morph:avian', 'gov:hive']); // knowledge persists
    expect(fresh.scrap).toBe(config.startScrap); // economy does not
    expect(fresh.characters.every((c) => c.xp === 0)).toBe(true); // growth does not
    expect(fresh.ascendLocked).toBe(false); // the lock is per-run
    expect(fresh.seed).toBe('carry-seed-2');
  });

  it('the ironman preference sticks across runs (a setting, not progress)', () => {
    let s = newRun('iron-seed');
    s = structuredClone(s);
    s.ironman = true;
    const fresh = reduce(s, { type: 'NEW_RUN', seed: 'iron-seed-2' }, deps);
    expect(fresh.ironman).toBe(true);
  });
});
