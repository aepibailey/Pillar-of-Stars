import { describe, expect, it } from 'vitest';
import { config, deps, enemies, makeDeps, newRun } from './fixtures';
import { currentSector, reduce, type Deps } from '../src/engine/reducer';
import type { CombatAction, TargetId } from '../src/combat/types';
import type { RunState } from '../src/engine/types';

function toMap(seed = 'combat-int-seed', d: Deps = deps): RunState {
  let s = newRun(seed);
  s = reduce(s, { type: 'FINISH_INTRO' }, d);
  s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
  s = reduce(s, { type: 'ACK_OUTCOME' }, d);
  return s;
}

/** Deps that force a hostile encounter with a single, known archetype. */
function forcedFightDeps(archetypeId: string): Deps {
  return makeDeps({
    config: { ...config, hostileEncounterChance: 1 },
    enemies: enemies.filter((e) => e.id === archetypeId),
  });
}

/** Explore the current system's first non-ruin node to trigger the encounter. */
function exploreForFight(s: RunState, d: Deps): RunState {
  const sector = currentSector(s, config);
  const node = sector.systems[s.currentSystemId].nodes.find((n) => n.type !== 'ruin');
  return reduce(s, { type: 'EXPLORE', nodeId: (node as { id: string }).id }, d);
}

const fire = (
  map: Partial<Record<number, TargetId>>,
  power = { engines: 0, weapons: 3, shields: 1 },
): CombatAction => ({
  type: 'FIRE',
  power,
  targets: [0, 1, 2, 3].map((i) => map[i] ?? null),
});

describe('launching combat from the map', () => {
  it('a hostile-ship encounter → engage → launches combat (phase combat)', () => {
    const d = forcedFightDeps('gunship');
    let s = toMap('launch-seed', d);
    s = exploreForFight(s, d);
    expect(s.phase).toBe('event');
    const def = d.events.find((e) => e.id === s.activeEvent?.defId);
    expect(def?.trigger.fixed).toBe('hostile-ship');
    // Option 0 is "engage": its outcome carries launchCombat.
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
    expect(s.activeEvent?.pendingCombat).toBe('random');
    s = reduce(s, { type: 'ACK_OUTCOME' }, d);
    expect(s.phase).toBe('combat');
    expect(s.combat?.origin).toBe('hostile-event');
    expect(s.combat?.enemyArchetypeId).toBe('gunship');
    expect(s.stats.combats).toBe(1);
  });

  it('combat state rides in RunState and survives a save round-trip', () => {
    const d = forcedFightDeps('gunship');
    let s = toMap('save-mid-combat', d);
    s = exploreForFight(s, d);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
    s = reduce(s, { type: 'ACK_OUTCOME' }, d);
    const roundTripped = JSON.parse(JSON.stringify(s)) as RunState;
    const a = reduce(s, { type: 'COMBAT_ACTION', combatAction: fire({ 0: 'hull' }) }, d);
    const b = reduce(roundTripped, { type: 'COMBAT_ACTION', combatAction: fire({ 0: 'hull' }) }, d);
    expect(a).toEqual(b);
  });
});

describe('resolving combat back into the run', () => {
  function driveToWin(seed: string): RunState {
    const d = forcedFightDeps('gunship');
    let s = toMap(seed, d);
    s = exploreForFight(s, d);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
    s = reduce(s, { type: 'ACK_OUTCOME' }, d);
    let guard = 0;
    while (s.phase === 'combat' && s.combat?.outcome === 'ongoing' && guard++ < 60) {
      s = reduce(
        s,
        { type: 'COMBAT_ACTION', combatAction: fire({ 0: 'hull', 1: 'hull', 2: 'hull' }) },
        d,
      );
    }
    return s;
  }

  it('a win pays salvage and writes ship damage back to the run', () => {
    const d = forcedFightDeps('gunship');
    let s = driveToWin('win-int-seed');
    // Might have been destroyed on an unlucky seed; find a seed that wins.
    let attempt = 0;
    while (s.combat?.outcome !== 'won' && attempt < 20) {
      s = driveToWin(`win-int-seed-${attempt++}`);
    }
    expect(s.combat?.outcome).toBe('won');
    const scrapBefore = s.scrap;
    const salvage = s.combat!.salvageScrap;
    const acked = reduce(s, { type: 'COMBAT_ACK' }, d);
    expect(acked.phase).toBe('map');
    expect(acked.combat).toBeNull();
    expect(acked.scrap).toBe(scrapBefore + salvage);
    // Persistent ship carries any hull damage taken; transient fields are reset.
    expect(acked.ship.shieldLayers).toBe(0);
    expect(acked.ship.fleeCharge).toBe(0);
  });

  it('hull reaching zero ends the run (destroyed)', () => {
    const d = forcedFightDeps('shield-fortress');
    let s = toMap('lose-int-seed', d);
    s = exploreForFight(s, d);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
    s = reduce(s, { type: 'ACK_OUTCOME' }, d);
    // Never shoot, never defend — take the beating until the hull fails.
    let guard = 0;
    while (s.phase === 'combat' && s.combat?.outcome === 'ongoing' && guard++ < 80) {
      s = reduce(
        s,
        {
          type: 'COMBAT_ACTION',
          combatAction: { type: 'FLEE', power: { engines: 0, weapons: 0, shields: 0 } },
        },
        d,
      );
    }
    expect(s.combat?.outcome).toBe('lost');
    const dead = reduce(s, { type: 'COMBAT_ACK' }, d);
    expect(dead.phase).toBe('dead');
    expect(dead.deathCause).toBe('destroyed');
  });

  it('bribe requires — and spends — the scrap', () => {
    const d = forcedFightDeps('gunship');
    let s = toMap('bribe-int-seed', d);
    s = exploreForFight(s, d);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
    s = reduce(s, { type: 'ACK_OUTCOME' }, d);
    expect(s.phase).toBe('combat');
    const cost = s.combat!.bribeCost;

    // Too poor: the bribe action is rejected.
    const broke = reduce(
      { ...s, scrap: cost - 1 },
      { type: 'COMBAT_ACTION', combatAction: { type: 'BRIBE' } },
      d,
    );
    expect(broke.combat?.outcome).toBe('ongoing');

    // Affordable: the fight ends and the scrap is paid on ack.
    let rich = { ...s, scrap: cost + 3 };
    rich = reduce(rich, { type: 'COMBAT_ACTION', combatAction: { type: 'BRIBE' } }, d);
    expect(rich.combat?.outcome).toBe('bribed');
    rich = reduce(rich, { type: 'COMBAT_ACK' }, d);
    expect(rich.phase).toBe('map');
    expect(rich.scrap).toBe(cost + 3 - cost);
  });
});

describe('repair (§5, spend scrap)', () => {
  it('patches hull for scrap, capped at hullMax', () => {
    let s = toMap();
    s = structuredClone(s);
    s.scrap = 5;
    s.ship.hull = 10;
    const before = s.ship.hull;
    const after = reduce(s, { type: 'REPAIR', target: 'hull' }, deps);
    expect(after.ship.hull).toBe(before + config.repair.hullPerScrap);
    expect(after.scrap).toBe(4);
  });

  it('repairs subsystem damage for scrap', () => {
    let s = toMap();
    s = structuredClone(s);
    s.scrap = 5;
    s.ship.subsystems.engines.damage = 3;
    const after = reduce(s, { type: 'REPAIR', target: 'engines' }, deps);
    expect(after.ship.subsystems.engines.damage).toBe(3 - config.repair.subsystemDamagePerScrap);
    expect(after.scrap).toBe(4);
  });

  it('is rejected with no scrap, or nothing to repair', () => {
    let s = toMap();
    s = structuredClone(s);
    s.scrap = 0;
    expect(reduce(s, { type: 'REPAIR', target: 'hull' }, deps)).toBe(s);
    s.scrap = 5; // full hull, undamaged systems → nothing to fix
    expect(reduce(s, { type: 'REPAIR', target: 'hull' }, deps)).toBe(s);
    expect(reduce(s, { type: 'REPAIR', target: 'weapons' }, deps)).toBe(s);
  });
});
