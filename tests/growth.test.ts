import { describe, expect, it } from 'vitest';
import scarsJson from '../data/scars.json';
import { config, deps, enemies, growth, makeDeps, newRun } from './fixtures';
import { grantXp, tierForLevel, type GrowthHistory } from '../src/crew/growth';
import { currentSector, reduce, type Deps } from '../src/engine/reducer';
import { Rng } from '../src/engine/rng';
import type { Character, RunState } from '../src/engine/types';

const noHistory: GrowthHistory = { boarding: false, 'ship-combat': false, contact: false };

function fresh(): Character {
  return structuredClone(newRun('growth-seed').characters[0]);
}

describe('levels and tiers (§6.05)', () => {
  it('XP crosses the flat per-level cost → level up, banking a skill point', () => {
    const ch = fresh();
    grantXp(ch, growth.xpPerLevel - 1, growth, noHistory, Rng.fromString('g1'));
    expect(ch.level).toBe(1);
    grantXp(ch, 1, growth, noHistory, Rng.fromString('g2'));
    expect(ch.level).toBe(2);
    expect(ch.unspentSkillPoints).toBe(1);
    expect(ch.xp).toBe(0); // cost consumed
  });

  it('big grants resolve multiple level-ups at once', () => {
    const ch = fresh();
    grantXp(ch, growth.xpPerLevel * 4 + 5, growth, noHistory, Rng.fromString('g3'));
    expect(ch.level).toBe(5);
    expect(ch.unspentSkillPoints).toBe(4);
    expect(ch.xp).toBe(5);
  });

  it('veterancy tiers mirror the threat bands: GREEN → SEASONED → VETERAN → ELITE', () => {
    expect(tierForLevel(1, growth)).toBe('GREEN');
    expect(tierForLevel(growth.tierThresholds.SEASONED, growth)).toBe('SEASONED');
    expect(tierForLevel(growth.tierThresholds.VETERAN, growth)).toBe('VETERAN');
    expect(tierForLevel(growth.tierThresholds.ELITE, growth)).toBe('ELITE');
    expect(tierForLevel(99, growth)).toBe('ELITE');
  });

  it('the dead do not grow', () => {
    const ch = fresh();
    ch.alive = false;
    grantXp(ch, 500, growth, noHistory, Rng.fromString('g4'));
    expect(ch.xp).toBe(0);
    expect(ch.level).toBe(1);
  });
});

describe('milestone traits roll from HISTORY (§6.05)', () => {
  const toMilestone = (history: GrowthHistory, seed: string): Character => {
    const ch = fresh();
    ch.traits = []; // isolate the milestone roll from the founding trait
    grantXp(ch, growth.xpPerLevel * growth.milestoneLevels[0], growth, history, Rng.fromString(seed));
    return ch;
  };

  it('with no history, only requires-null traits can roll', () => {
    for (let i = 0; i < 25; i++) {
      const ch = toMilestone(noHistory, `nohist-${i}`);
      const rolled = ch.traits[ch.traits.length - 1];
      const def = growth.milestoneTraitPool.find((t) => t.id === rolled)!;
      expect(def.requires).toBeNull(); // "Boarding Veteran" never rolls unboarded
    }
  });

  it('history unlocks its gated traits (a boarder can roll Boarding Veteran)', () => {
    const history: GrowthHistory = { boarding: true, 'ship-combat': false, contact: false };
    let sawGated = false;
    for (let i = 0; i < 60 && !sawGated; i++) {
      const ch = toMilestone(history, `boarder-${i}`);
      if (ch.traits.includes('boarding-veteran')) sawGated = true;
    }
    expect(sawGated).toBe(true);
  });

  it('milestone rolls are deterministic for the same rng cursor', () => {
    const a = toMilestone(noHistory, 'det');
    const b = toMilestone(noHistory, 'det');
    expect(a.traits).toEqual(b.traits);
  });
});

describe('XP awards wired into the run (§6.05: XP from doing)', () => {
  function toMap(d: Deps, seed = 'xp-seed'): RunState {
    let s = reduce({} as RunState, { type: 'NEW_RUN', seed }, d);
    s = reduce(s, { type: 'FINISH_INTRO' }, d);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
    s = reduce(s, { type: 'ACK_OUTCOME' }, d);
    return s;
  }

  it('surveying a node grants discovery XP to every living participant', () => {
    const d = makeDeps({ config: { ...config, hostileEncounterChance: 0 } });
    let s = toMap(d);
    const before = s.characters.map((c) => c.xp);
    const sector = currentSector(s, config);
    const node = sector.systems[s.currentSystemId].nodes.find((n) => n.type !== 'ruin')!;
    s = reduce(s, { type: 'EXPLORE', nodeId: node.id }, d);
    s.characters.forEach((c, i) => expect(c.xp).toBe(before[i] + growth.awards.discovery));
  });

  it('winning a ship fight pays shipFightWon XP on the ack', () => {
    const d = makeDeps({
      config: { ...config, hostileEncounterChance: 1 },
      enemies: enemies.filter((e) => e.id === 'derelict-scavenger'),
    });
    let s = toMap(d, 'xp-fight-seed');
    const sector = currentSector(s, config);
    const node = sector.systems[s.currentSystemId].nodes.find((n) => n.type !== 'ruin')!;
    s = reduce(s, { type: 'EXPLORE', nodeId: node.id }, d);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
    s = reduce(s, { type: 'ACK_OUTCOME' }, d);
    expect(s.phase).toBe('combat');
    const xpBefore = s.characters[0].xp;
    s = structuredClone(s);
    s.combat!.outcome = 'won'; // force the win; the award is what's under test
    s = reduce(s, { type: 'COMBAT_ACK' }, d);
    expect(s.characters[0].xp).toBe(xpBefore + growth.awards.shipFightWon);
  });

  it('growth is strictly in-run: NEW_RUN builds level-1 people (already covered) — and the scar schema holds', () => {
    const scars = (scarsJson as { scars: { id: string; name: string }[] }).scars;
    expect(scars.length).toBeGreaterThanOrEqual(2);
    for (const sc of scars) {
      expect(sc.id.length).toBeGreaterThan(0);
      expect(sc.name.length).toBeGreaterThan(0);
    }
    // Character.scars is the carrier — empty at creation, in-run only.
    expect(newRun('scar-seed').characters.every((c) => c.scars.length === 0)).toBe(true);
    void deps;
  });
});
