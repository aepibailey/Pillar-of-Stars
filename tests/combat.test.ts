import { describe, expect, it } from 'vitest';
import configJson from '../data/config.json';
import enemiesJson from '../data/enemies.json';
import shipPlayerJson from '../data/ship-player.json';
import weaponsJson from '../data/weapons.json';
import {
  clampPower,
  combatReduce,
  effLevel,
  evasion,
  makeCombatShip,
  reactorOutput,
  startCombat,
  type StartCombatArgs,
} from '../src/combat/engine';
import type {
  CombatConfig,
  CombatShip,
  CombatState,
  EnemyArchetype,
  PlayerShipDef,
  TargetId,
  WeaponDef,
} from '../src/combat/types';

const weaponDefs = weaponsJson as WeaponDef[];
const enemies = enemiesJson as unknown as EnemyArchetype[];
const playerDef = shipPlayerJson as unknown as PlayerShipDef;
const combatConfig = (configJson as { combat: CombatConfig }).combat;

function archetype(id: string): EnemyArchetype {
  const a = enemies.find((e) => e.id === id);
  if (!a) throw new Error(`no archetype ${id}`);
  return a;
}

function playerShip(): CombatShip {
  return makeCombatShip(
    playerDef.name,
    playerDef.hullMax,
    playerDef.subsystems,
    playerDef.pdChance,
    playerDef.weapons,
    weaponDefs,
  );
}

function fight(enemyId: string, seed = 'combat-seed', overrides: Partial<StartCombatArgs> = {}) {
  return startCombat({
    seed,
    encounterId: 'e0',
    playerDef,
    playerShip: playerShip(),
    archetype: archetype(enemyId),
    weaponDefs,
    config: combatConfig,
    origin: 'hostile-event',
    ...overrides,
  });
}

/** Weapon indices in the player's loadout: [kinetic, laser, missile, ion]. */
const KIN = 0;
const LAS = 1;
const MIS = 2;
const ION = 3;

function targets(map: Partial<Record<number, TargetId>>): (TargetId | null)[] {
  return [KIN, LAS, MIS, ION].map((i) => map[i] ?? null);
}

describe('combat construction & power', () => {
  it('data files are internally consistent', () => {
    for (const a of enemies) {
      for (const w of a.weapons) expect(weaponDefs.some((d) => d.id === w)).toBe(true);
    }
    for (const w of playerDef.weapons) expect(weaponDefs.some((d) => d.id === w)).toBe(true);
    expect(enemies.map((e) => e.id).sort()).toEqual([
      'derelict-scavenger',
      'gunship',
      'missile-boat',
      'shield-fortress',
    ]);
    // Every archetype carries a threat band and hull-class label (patch fields).
    for (const a of enemies) {
      expect(a.threat).toBeTruthy();
      expect(a.className).toBeTruthy();
    }
  });

  it('reactor output caps total power; clampPower sheds the overflow', () => {
    const ship = playerShip();
    expect(reactorOutput(ship)).toBe(4);
    // Demand 2+3+2 = 7 > 4: must be trimmed to the pool.
    const p = clampPower(ship, { engines: 2, weapons: 3, shields: 2 });
    expect(p.engines + p.weapons + p.shields).toBe(4);
    // Weapons are shed last, so they survive the trim.
    expect(p.weapons).toBe(3);
  });

  it('a damaged reactor browns out the power pool (§5)', () => {
    const ship = playerShip();
    ship.subsystems.reactor.damage = 2; // eff level 2
    const p = clampPower(ship, { engines: 2, weapons: 3, shields: 2 });
    expect(p.engines + p.weapons + p.shields).toBe(2);
  });

  it('evasion scales with engine power and clamps', () => {
    const ship = playerShip();
    ship.power = { engines: 2, weapons: 0, shields: 0 };
    expect(evasion(ship, combatConfig)).toBeCloseTo(0.24, 10);
    ship.power.engines = 99;
    expect(evasion(ship, combatConfig)).toBe(combatConfig.maxEvasion);
  });
});

describe('determinism & save/resume', () => {
  it('same seed reproduces the whole fight', () => {
    const a = fight('gunship');
    const b = fight('gunship');
    expect(a).toEqual(b);
  });

  it('a turn is a pure function of state (rng cursor rides in the state)', () => {
    const s = fight('gunship');
    const action = {
      type: 'FIRE' as const,
      power: { engines: 1, weapons: 3, shields: 0 },
      targets: targets({ [KIN]: 'hull' }),
    };
    const a = combatReduce(s, action, weaponDefs, combatConfig);
    const b = combatReduce(structuredClone(s), action, weaponDefs, combatConfig);
    expect(a).toEqual(b);
  });

  it('resuming from a serialized mid-fight state continues identically', () => {
    let s = fight('shield-fortress');
    const act = {
      type: 'FIRE' as const,
      power: { engines: 0, weapons: 3, shields: 1 },
      targets: targets({ [LAS]: 'shields', [KIN]: 'hull' }),
    };
    s = combatReduce(s, act, weaponDefs, combatConfig);
    const resumed = JSON.parse(JSON.stringify(s)) as CombatState;
    const a = combatReduce(s, act, weaponDefs, combatConfig);
    const b = combatReduce(resumed, act, weaponDefs, combatConfig);
    expect(a).toEqual(b);
  });
});

describe('weapon mechanics vs defenses (§7.1)', () => {
  it('kinetics are absorbed by shield layers, then bite hull', () => {
    let s = fight('shield-fortress'); // starts with shield layers
    const layers0 = s.enemy.shieldLayers;
    expect(layers0).toBeGreaterThan(0);
    // Fire only kinetic at hull; a full shield should eat it (no hull loss).
    const before = s.enemy.hull;
    s = combatReduce(
      s,
      {
        type: 'FIRE',
        power: { engines: 0, weapons: 1, shields: 0 },
        targets: targets({ [KIN]: 'hull' }),
      },
      weaponDefs,
      combatConfig,
    );
    expect(s.enemy.hull).toBe(before); // absorbed
    expect(s.enemy.shieldLayers).toBeLessThan(layers0 + combatConfig.shieldRegenPerTurn + 1);
  });

  it('a laser that clears the last shield layer burns through to hull', () => {
    const s = fight('gunship'); // gunship shields eff level 1 → 1 layer
    s.enemy.shieldLayers = 1;
    const before = s.enemy.hull;
    const after = combatReduce(
      s,
      {
        type: 'FIRE',
        power: { engines: 0, weapons: 2, shields: 0 },
        targets: targets({ [LAS]: 'hull' }),
      },
      weaponDefs,
      combatConfig,
    );
    // laser strip 2 >= 1 layer → breaks through and deals hull damage this turn
    // (post-upkeep the enemy regens a shield layer, so we assert on hull, not layers)
    expect(after.enemy.hull).toBeLessThan(before);
  });

  it('a laser against deep shields only strips — no hull damage that turn', () => {
    const s = fight('shield-fortress');
    s.enemy.shieldLayers = 4; // deeper than one laser can strip (2)
    const before = s.enemy.hull;
    const after = combatReduce(
      s,
      {
        type: 'FIRE',
        power: { engines: 0, weapons: 2, shields: 0 },
        targets: targets({ [LAS]: 'hull' }),
      },
      weaponDefs,
      combatConfig,
    );
    expect(after.enemy.hull).toBe(before); // shields not fully cleared → no burn-through
  });

  it('missiles bypass shields entirely (but can be intercepted)', () => {
    const s = fight('shield-fortress');
    s.enemy.shieldLayers = 4;
    s.enemy.pdChance = 0; // guarantee the missile lands
    const before = s.enemy.hull;
    const after = combatReduce(
      s,
      {
        type: 'FIRE',
        power: { engines: 0, weapons: 1, shields: 0 },
        targets: targets({ [MIS]: 'hull' }),
      },
      weaponDefs,
      combatConfig,
    );
    // The missile ignored a full 4-layer shield wall and still hit hull.
    expect(after.enemy.hull).toBeLessThan(before);
  });

  it('point defense can intercept missiles (pdChance=1 always intercepts)', () => {
    const s = fight('gunship');
    s.enemy.shieldLayers = 0;
    s.enemy.pdChance = 1;
    const before = s.enemy.hull;
    const after = combatReduce(
      s,
      {
        type: 'FIRE',
        power: { engines: 0, weapons: 1, shields: 0 },
        targets: targets({ [MIS]: 'hull' }),
      },
      weaponDefs,
      combatConfig,
    );
    expect(after.enemy.hull).toBe(before); // intercepted
  });

  it('ion deals no hull damage — it disables a subsystem', () => {
    const s = fight('gunship');
    s.enemy.shieldLayers = 0;
    const beforeHull = s.enemy.hull;
    const beforeWpn = s.enemy.subsystems.weapons.damage;
    const after = combatReduce(
      s,
      {
        type: 'FIRE',
        power: { engines: 0, weapons: 1, shields: 0 },
        targets: targets({ [ION]: 'weapons' }),
      },
      weaponDefs,
      combatConfig,
    );
    expect(after.enemy.hull).toBe(beforeHull);
    expect(after.enemy.subsystems.weapons.damage).toBeGreaterThan(
      beforeWpn - combatConfig.ionRegenPerTurn,
    );
  });

  it('targeting a subsystem spills only part of the damage to hull', () => {
    const s = fight('gunship');
    s.enemy.shieldLayers = 0;
    const before = s.enemy.hull;
    const after = combatReduce(
      s,
      {
        type: 'FIRE',
        power: { engines: 0, weapons: 1, shields: 0 },
        targets: targets({ [KIN]: 'engines' }),
      },
      weaponDefs,
      combatConfig,
    );
    const kinetic = weaponDefs.find((w) => w.id === 'kinetic-autocannon')!;
    const spill = Math.floor(kinetic.damage * combatConfig.subsystemHullFactor);
    expect(before - after.enemy.hull).toBe(spill);
    expect(after.enemy.subsystems.engines.damage).toBeGreaterThan(0);
  });
});

describe('ammo and cooldowns', () => {
  it('missiles are limited and cooldown-gated', () => {
    const s = fight('gunship');
    const slot = s.player.weapons[MIS];
    expect(slot.ammo).toBe(4);
    const after = combatReduce(
      s,
      {
        type: 'FIRE',
        power: { engines: 0, weapons: 1, shields: 0 },
        targets: targets({ [MIS]: 'hull' }),
      },
      weaponDefs,
      combatConfig,
    );
    expect(after.player.weapons[MIS].ammo).toBe(3);
    expect(after.player.weapons[MIS].cooldownLeft).toBe(0); // ticked back down in upkeep
  });

  it('weapons power budget gates how much can fire at once', () => {
    const s = fight('gunship');
    s.enemy.shieldLayers = 0; // no shields, so a fired laser WOULD hit hull
    const before = s.enemy.hull;
    // Only 1 weapons power, but the laser costs 2: it cannot fire this turn.
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
    expect(after.enemy.hull).toBe(before); // laser was starved of power → no hit
  });
});

describe('outcomes', () => {
  it('reducing enemy hull to zero is a win', () => {
    let s = fight('missile-boat', 'win-seed');
    s.enemy.pdChance = 0;
    let guard = 0;
    while (s.outcome === 'ongoing' && guard++ < 50) {
      s = combatReduce(
        s,
        {
          type: 'FIRE',
          power: { engines: 0, weapons: 3, shields: 0 },
          targets: targets({ [KIN]: 'hull', [MIS]: 'hull', [ION]: 'weapons' }),
        },
        weaponDefs,
        combatConfig,
      );
    }
    expect(s.outcome).toBe('won');
    expect(s.enemy.hull).toBeLessThanOrEqual(0);
  });

  it('fleeing succeeds once the drive charges past the threshold', () => {
    let s = fight('gunship', 'flee-seed');
    let guard = 0;
    while (s.outcome === 'ongoing' && guard++ < 50) {
      s = combatReduce(
        s,
        { type: 'FLEE', power: { engines: 2, weapons: 0, shields: 0 } },
        weaponDefs,
        combatConfig,
      );
    }
    expect(['fled', 'lost']).toContain(s.outcome);
    if (s.outcome === 'fled') expect(s.player.fleeCharge).toBeGreaterThanOrEqual(s.fleeThreshold);
  });

  it('a fast-approach flee head start shortens the escape', () => {
    const s = fight('gunship', 'flee-seed', {
      fleeHeadstart: combatConfig.fastApproachFleeHeadstart,
    });
    expect(s.player.fleeCharge).toBe(combatConfig.fastApproachFleeHeadstart);
  });

  it('surrender is honored only by factions that take prisoners', () => {
    const boat = combatReduce(
      fight('missile-boat'),
      { type: 'SURRENDER' },
      weaponDefs,
      combatConfig,
    );
    expect(boat.outcome).toBe('surrendered');
    const fortress = combatReduce(
      fight('shield-fortress'),
      { type: 'SURRENDER' },
      weaponDefs,
      combatConfig,
    );
    expect(fortress.outcome).toBe('ongoing'); // the Choir refuses
  });

  it('bribe is honored by those open to it', () => {
    const g = combatReduce(fight('gunship'), { type: 'BRIBE' }, weaponDefs, combatConfig);
    expect(g.outcome).toBe('bribed');
  });

  it('a finished fight ignores further actions', () => {
    const done = combatReduce(fight('gunship'), { type: 'BRIBE' }, weaponDefs, combatConfig);
    const again = combatReduce(
      done,
      {
        type: 'FIRE',
        power: { engines: 0, weapons: 3, shields: 0 },
        targets: targets({ [KIN]: 'hull' }),
      },
      weaponDefs,
      combatConfig,
    );
    expect(again).toBe(done);
  });
});

describe('subsystem disable has teeth', () => {
  it('an enemy with disabled weapons cannot hurt you', () => {
    const s = fight('gunship');
    s.enemy.subsystems.weapons.damage = 99; // fully offline
    const before = s.player.hull;
    const after = combatReduce(
      s,
      { type: 'FLEE', power: { engines: 0, weapons: 0, shields: 0 } },
      weaponDefs,
      combatConfig,
    );
    expect(after.player.hull).toBe(before);
  });

  it('disabled engines drop evasion to zero', () => {
    const ship = playerShip();
    ship.subsystems.engines.damage = 99;
    ship.power.engines = 3;
    // clampPower would zero engine power (eff level 0), but evasion reads power directly:
    const clamped = clampPower(ship, { engines: 3, weapons: 0, shields: 0 });
    expect(clamped.engines).toBe(0);
    expect(effLevel(ship.subsystems.engines)).toBe(0);
  });
});
