import { describe, expect, it } from 'vitest';
import {
  config,
  deps,
  enemies,
  events,
  makeDeps,
  newRun,
  newShip,
  playerDef,
  weapons,
  wakeShipNames,
} from './fixtures';
import { currentSector, reduce, type Deps } from '../src/engine/reducer';
import { combatReduce, planVolley, startCombat } from '../src/combat/engine';
import type {
  CombatConfig,
  EnemyArchetype,
  PlayerShipDef,
  TargetId,
  WeaponDef,
} from '../src/combat/types';
import type { EventDef } from '../src/events/types';
import type { RunState } from '../src/engine/types';

const combatConfig = (config as unknown as { combat: CombatConfig }).combat;
const weaponDefs = weapons as WeaponDef[];
const KIN = 0;
const LAS = 1;

function fight(enemyId: string) {
  const a = enemies.find((e) => e.id === enemyId) as EnemyArchetype;
  return startCombat({
    seed: 'patch-seed',
    encounterId: 'e0',
    playerDef: playerDef as PlayerShipDef,
    playerShip: newShip(),
    archetype: a,
    weaponDefs,
    config: combatConfig,
    origin: 'hostile-event',
  });
}

function targets(map: Partial<Record<number, TargetId>>): (TargetId | null)[] {
  return [0, 1, 2, 3].map((i) => map[i] ?? null);
}

describe('item 4/5 — no weapon fires silently', () => {
  it('planVolley classifies each weapon (fire / underpowered / hold)', () => {
    const s = fight('gunship');
    s.player.power = { engines: 0, weapons: 1, shields: 0 };
    // Kinetic (cost 1) targeted → fires; laser (cost 2) targeted → underpowered.
    const plan = planVolley(s.player, targets({ [KIN]: 'hull', [LAS]: 'hull' }), weaponDefs);
    expect(plan[KIN]).toBe('fire');
    expect(plan[LAS]).toBe('underpowered');
    expect(plan[2]).toBe('hold'); // untargeted
  });

  it('an underpowered weapon reports "NOT ENOUGH POWER" in the log, never silence', () => {
    const s = fight('gunship');
    const after = combatReduce(
      s,
      {
        type: 'FIRE',
        power: { engines: 0, weapons: 1, shields: 0 },
        targets: targets({ [LAS]: 'hull' }),
      },
      weaponDefs,
      combatConfig,
    );
    expect(after.log.some((l) => l.includes('NOT ENOUGH POWER'))).toBe(true);
  });

  it('every targeted weapon produces a log line every turn', () => {
    const s = fight('gunship');
    s.enemy.shieldLayers = 0;
    const after = combatReduce(
      s,
      {
        type: 'FIRE',
        power: { engines: 0, weapons: 3, shields: 0 },
        targets: targets({ [KIN]: 'hull', [LAS]: 'hull' }),
      },
      weaponDefs,
      combatConfig,
    );
    const kinLines = after.log.filter((l) => l.includes('Autocannon')).length;
    const lasLines = after.log.filter((l) => l.includes('Beam Laser')).length;
    expect(kinLines).toBeGreaterThan(0);
    expect(lasLines).toBeGreaterThan(0);
  });
});

const ION = 3;

describe('turn resolution is SIMULTANEOUS (locked-in architecture)', () => {
  it('the enemy still fires on the turn the player lands the killing blow', () => {
    const s = fight('gunship');
    s.enemy.hull = 1;
    s.enemy.shieldLayers = 0;
    s.player.shieldLayers = 0;
    const after = combatReduce(
      s,
      { type: 'FIRE', power: { engines: 0, weapons: 1, shields: 0 }, targets: targets({ [KIN]: 'hull' }) },
      weaponDefs,
      combatConfig,
    );
    expect(after.outcome).toBe('won');
    // Sequential would have skipped the enemy volley; simultaneous does not.
    expect(after.player.hull).toBeLessThan(after.player.hullMax);
  });

  it('disabling the enemy weapons THIS turn does not stop its shot THIS turn', () => {
    const s = fight('gunship');
    s.enemy.shieldLayers = 0;
    s.player.shieldLayers = 0;
    const after = combatReduce(
      s,
      { type: 'FIRE', power: { engines: 0, weapons: 1, shields: 0 }, targets: targets({ [ION]: 'weapons' }) },
      weaponDefs,
      combatConfig,
    );
    // Ion landed (weapons now damaged → bites NEXT turn)...
    expect(after.enemy.subsystems.weapons.damage).toBeGreaterThan(0);
    // ...but the enemy still got its simultaneous volley in this turn.
    expect(after.player.hull).toBeLessThan(after.player.hullMax);
  });

  it('mutual destruction resolves as a loss (player death takes precedence)', () => {
    const s = fight('gunship');
    s.enemy.hull = 1;
    s.player.hull = 1;
    s.enemy.shieldLayers = 0;
    s.player.shieldLayers = 0;
    const after = combatReduce(
      s,
      { type: 'FIRE', power: { engines: 0, weapons: 1, shields: 0 }, targets: targets({ [KIN]: 'hull' }) },
      weaponDefs,
      combatConfig,
    );
    expect(after.enemy.hull).toBeLessThanOrEqual(0);
    expect(after.player.hull).toBeLessThanOrEqual(0);
    expect(after.outcome).toBe('lost');
  });
});

describe('item 6 — the power cap is the subsystem level (kept, now surfaced)', () => {
  it('the weapons channel still caps at the weapons subsystem level', () => {
    const s = fight('gunship');
    // Player weapons subsystem is level 3; asking for 4 clamps to 3 in FIRE.
    const after = combatReduce(
      s,
      {
        type: 'FIRE',
        power: { engines: 0, weapons: 4, shields: 0 },
        targets: targets({ [KIN]: 'hull' }),
      },
      weaponDefs,
      combatConfig,
    );
    expect(after.player.power.weapons).toBe(3);
  });
});

describe('item 7 — threat band travels into combat', () => {
  it('CombatState carries the archetype threat band', () => {
    expect(fight('derelict-scavenger').enemyThreat).toBe('GREEN');
    expect(fight('shield-fortress').enemyThreat).toBe('VETERAN');
  });
});

describe('item 9 — Wake vessels get brutal generated names', () => {
  function firstWakeFight(): RunState {
    // Force contact on the casual approach, then jump into consumed space.
    const rigged: Deps = makeDeps({
      config: {
        ...config,
        wakeSpace: { ...config.wakeSpace, casual: { ...config.wakeSpace.casual, fightChance: 1 } },
      },
    });
    let s = newRun('wake-name-seed');
    s = reduce(s, { type: 'FINISH_INTRO' }, rigged);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, rigged);
    s = reduce(s, { type: 'ACK_OUTCOME' }, rigged);
    const sector = currentSector(s, config);
    const target = sector.systems[s.currentSystemId].links[0];
    s = structuredClone(s);
    s.fuel = 99;
    s.wake.consumedIds = [target];
    return reduce(s, { type: 'JUMP', toSystemId: target, approach: 'casual' }, rigged);
  }

  it('a wake-space fight names the ship "<brutal name> <class>"', () => {
    const s = firstWakeFight();
    expect(s.phase).toBe('combat');
    const name = s.combat!.enemy.name;
    const classNames = enemies.map((e) => e.className);
    const matchedClass = classNames.find((c) => name.endsWith(c));
    expect(matchedClass, `name '${name}' should end with a hull class`).toBeTruthy();
    const brutal = name.slice(0, name.length - (matchedClass as string).length).trim();
    expect(wakeShipNames).toContain(brutal);
  });

  it('non-Wake (hostile-event) fights keep the faction archetype name', () => {
    const d = makeDeps({
      config: { ...config, hostileEncounterChance: 1 },
      enemies: enemies.filter((e) => e.id === 'gunship'),
    });
    let s = newRun('hostile-name-seed');
    s = reduce(s, { type: 'FINISH_INTRO' }, d);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
    s = reduce(s, { type: 'ACK_OUTCOME' }, d);
    const sector = currentSector(s, config);
    const node = sector.systems[s.currentSystemId].nodes.find((n) => n.type !== 'ruin');
    s = reduce(s, { type: 'EXPLORE', nodeId: (node as { id: string }).id }, d);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
    s = reduce(s, { type: 'ACK_OUTCOME' }, d);
    expect(s.combat?.enemy.name).toBe('Void Jackal Skirmisher');
  });
});

describe('item 8 — surrender is painful (half fuel, all scrap)', () => {
  it('surrender zeroes scrap and halves fuel', () => {
    const d = makeDeps({
      config: { ...config, hostileEncounterChance: 1 },
      enemies: enemies.filter((e) => e.id === 'gunship'),
    });
    let s = newRun('surrender-seed');
    s = reduce(s, { type: 'FINISH_INTRO' }, d);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
    s = reduce(s, { type: 'ACK_OUTCOME' }, d);
    const sector = currentSector(s, config);
    const node = sector.systems[s.currentSystemId].nodes.find((n) => n.type !== 'ruin');
    s = reduce(s, { type: 'EXPLORE', nodeId: (node as { id: string }).id }, d);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
    s = reduce(s, { type: 'ACK_OUTCOME' }, d);
    expect(s.phase).toBe('combat');
    s = structuredClone(s);
    s.fuel = 9;
    s.scrap = 6;
    s = reduce(s, { type: 'COMBAT_ACTION', combatAction: { type: 'SURRENDER' } }, d);
    expect(s.combat?.outcome).toBe('surrendered');
    s = reduce(s, { type: 'COMBAT_ACK' }, d);
    expect(s.fuel).toBe(4); // floor(9/2)
    expect(s.scrap).toBe(0);
  });
});

describe('item 1 — a derelict trap launches real combat', () => {
  it('the distress-bait outcome carries launchCombat vs the weak scavenger', () => {
    const distress = (events as EventDef[]).find((e) => e.id === 'derelict-distress') as EventDef;
    const bait = distress.options[0].outcomes.find((o) => o.effects?.launchCombat);
    expect(bait?.effects?.launchCombat).toBe('derelict-scavenger');
  });

  it('acking a launchCombat outcome starts a fight against that archetype', () => {
    const opener = events.find((e) => e.trigger.fixed === 'run-opener') as EventDef;
    const ruin = events.find((e) => e.trigger.fixed === 'sector-ruin') as EventDef;
    let s = newRun('trap-seed');
    // Set up on the map, then pick a concrete non-ruin node and spring the trap
    // on its exact node type so the rigged event actually matches.
    let d = makeDeps({ events: [opener, ruin], config: { ...config, hostileEncounterChance: 0 } });
    s = reduce(s, { type: 'FINISH_INTRO' }, d);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
    s = reduce(s, { type: 'ACK_OUTCOME' }, d);
    const sector = currentSector(s, config);
    const node = sector.systems[s.currentSystemId].nodes.find((n) => n.type !== 'ruin');
    const trap: EventDef = {
      id: 'test-trap',
      title: 'Trap',
      text: 't',
      trigger: { nodeTypes: [(node as { type: 'planet' }).type] },
      options: [
        {
          label: 'go',
          outcomes: [
            { weight: 1, text: 'sprung', effects: { launchCombat: 'derelict-scavenger' } },
          ],
        },
      ],
    };
    d = makeDeps({
      events: [opener, ruin, trap],
      config: { ...config, hostileEncounterChance: 0 },
    });
    s = reduce(s, { type: 'EXPLORE', nodeId: (node as { id: string }).id }, d);
    expect(s.phase).toBe('event');
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
    s = reduce(s, { type: 'ACK_OUTCOME' }, d);
    expect(s.phase).toBe('combat');
    expect(s.combat?.enemyArchetypeId).toBe('derelict-scavenger');
    expect(s.combat?.enemyThreat).toBe('GREEN');
  });
});

void deps;
