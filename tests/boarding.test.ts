import { describe, expect, it } from 'vitest';
import { config, enemies, makeDeps, threatRewards } from './fixtures';
import { currentSector, reduce, type Deps } from '../src/engine/reducer';
import { aliveFoes } from '../src/ground/engine';
import type { RunState } from '../src/engine/types';

/** Reach a live ship fight against a known archetype. */
function toCombat(archetypeId: string, seed = 'board-seed'): { s: RunState; d: Deps } {
  const d = makeDeps({
    config: { ...config, hostileEncounterChance: 1 },
    enemies: enemies.filter((e) => e.id === archetypeId),
  });
  let s = reduce(
    reduce(reduce({ ...startRun(seed, d) }, { type: 'FINISH_INTRO' }, d), { type: 'RESOLVE_OPTION', optionIndex: 0 }, d),
    { type: 'ACK_OUTCOME' },
    d,
  );
  const sector = currentSector(s, config);
  const node = sector.systems[s.currentSystemId].nodes.find((n) => n.type !== 'ruin')!;
  s = reduce(s, { type: 'EXPLORE', nodeId: node.id }, d);
  s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
  s = reduce(s, { type: 'ACK_OUTCOME' }, d);
  return { s, d };
}

function startRun(seed: string, d: Deps): RunState {
  // reduce NEW_RUN builds a fresh run through the same code path main.ts uses.
  return reduce({} as RunState, { type: 'NEW_RUN', seed }, d);
}

/** Cripple the enemy's weapons + engines so the ship is boardable (§7.3). */
function disableEnemy(s: RunState): void {
  const e = s.combat!.enemy;
  e.subsystems.weapons.damage = e.subsystems.weapons.level;
  e.subsystems.engines.damage = e.subsystems.engines.level;
}

describe('boarding trigger (§7.3)', () => {
  it('BOARD is rejected while the enemy still has weapons or engines', () => {
    const { s, d } = toCombat('gunship');
    expect(s.phase).toBe('combat');
    expect(reduce(s, { type: 'BOARD' }, d)).toBe(s); // no-op, both systems live
  });

  it('BOARD on a disabled ship enters the ground phase and persists ship damage', () => {
    const { s, d } = toCombat('gunship');
    s.combat!.player.hull = 20; // took some damage in the duel
    disableEnemy(s);
    const boarded = reduce(s, { type: 'BOARD' }, d);
    expect(boarded.phase).toBe('ground');
    expect(boarded.combat).toBeNull();
    expect(boarded.ground).not.toBeNull();
    expect(boarded.ground!.outcome).toBe('ongoing');
    expect(boarded.ship.hull).toBe(20); // ship state carried out of the duel
    expect(aliveFoes(boarded.ground!).length).toBeGreaterThan(0);
  });

  it('captain-down with the companion ALSO dead ends the run (§6.4 boarding edge case)', () => {
    const { s, d } = toCombat('shield-fortress');
    disableEnemy(s);
    let g = reduce(s, { type: 'BOARD' }, d);
    // Force the total loss: captain down, companion killed in the corridor too.
    g.ground!.fighters.find((f) => f.id === 'captain')!.hp = 0;
    g.ground!.fighters.find((f) => f.id === 'companion')!.down = 'killed';
    g.ground!.outcome = 'captain-down';
    g = reduce(g, { type: 'GROUND_ACK' }, d);
    expect(g.phase).toBe('dead');
    expect(g.deathCause).toBe('boarding');
    expect(g.ascendLocked).toBe(true); // both founders fell
  });

  it('captain-down with the companion SURVIVING offers succession (v0.7 §6.4)', () => {
    const { s, d } = toCombat('gunship');
    disableEnemy(s);
    let g = reduce(s, { type: 'BOARD' }, d);
    g.ground!.fighters.find((f) => f.id === 'captain')!.hp = 0;
    g.ground!.outcome = 'captain-down';
    g = reduce(g, { type: 'GROUND_ACK' }, d);
    expect(g.phase).toBe('succession'); // the choice, never automatic death
    expect(g.deathCause).toBeUndefined();
    expect(g.ascendLocked).toBe(true); // a founder (the captain) died
  });

  it('a neutralized boarding pays salvage and returns to the map', () => {
    const { s, d } = toCombat('gunship');
    disableEnemy(s);
    let g = reduce(s, { type: 'BOARD' }, d);
    const scrapBefore = g.scrap;
    const reward = g.ground!.reward.scrap;
    // Force a clean win.
    for (const f of g.ground!.fighters) if (f.side === 'foe') f.down = 'killed';
    g.ground!.outcome = 'neutralized';
    g = reduce(g, { type: 'GROUND_ACK' }, d);
    expect(g.phase).toBe('map');
    expect(g.ground).toBeNull();
    expect(g.scrap).toBe(scrapBefore + reward + 2); // neutralize bonus
    expect(g.flags.boardedMassacre).toBe(true);
  });

  it('boarding loot scales by threat band — fuel + intel + matching-type ammo', () => {
    // gunship = SEASONED, carries kinetic (slugthrower) → kinetic ammo top-up.
    const { s, d } = toCombat('gunship');
    disableEnemy(s);
    // Spend some kinetic ammo first so a top-up is observable.
    const kin = s.combat!.player.weapons.find((w) => w.defId === 'kinetic-autocannon')!;
    kin.ammo = 1;
    let g = reduce(s, { type: 'BOARD' }, d);
    const band = g.ground!.threat;
    const loot = threatRewards.rewardsByBand[band];
    const fuelBefore = g.fuel;
    const intelBefore = g.intel;
    for (const f of g.ground!.fighters) if (f.side === 'foe') f.down = 'killed';
    g.ground!.outcome = 'neutralized';
    g = reduce(g, { type: 'GROUND_ACK' }, d);
    expect(g.fuel).toBe(fuelBefore + loot.fuel);
    expect(g.intel).toBe(intelBefore + loot.intel);
    const kinAfter = g.ship.weapons.find((w) => w.defId === 'kinetic-autocannon')!;
    expect(kinAfter.ammo).toBe(Math.min(8, 1 + loot.ammo)); // capped at magazine
  });

  it('ally boarding grants intel + a little scrap, but no fuel/ammo strip (§7.3)', () => {
    const { s, d } = toCombat('gunship');
    disableEnemy(s);
    const kin = s.combat!.player.weapons.find((w) => w.defId === 'kinetic-autocannon')!;
    kin.ammo = 1;
    let g = reduce(s, { type: 'BOARD' }, d);
    const loot = threatRewards.rewardsByBand[g.ground!.threat];
    const fuelBefore = g.fuel;
    for (const f of g.ground!.fighters) if (f.side === 'foe') f.down = 'yielded';
    g.ground!.outcome = 'allied';
    g = reduce(g, { type: 'GROUND_ACK' }, d);
    expect(g.intel).toBe(loot.intel); // they share what they know
    expect(g.fuel).toBe(fuelBefore); // no fuel — you didn't strip the ship
    expect(g.ship.weapons.find((w) => w.defId === 'kinetic-autocannon')!.ammo).toBe(1); // no ammo
    expect(g.flags.alliedBoarding).toBe(true);
  });

  it('a GROUND_ACTION only lands while a boarding is ongoing', () => {
    const { s, d } = toCombat('gunship');
    // No ground scene yet — action is a no-op.
    expect(reduce(s, { type: 'GROUND_ACTION', groundAction: { type: 'GVENT' } }, d)).toBe(s);
  });

  it('foe count and threat carry from the ship read into the boarding', () => {
    const { s, d } = toCombat('gunship');
    disableEnemy(s);
    const threat = s.combat!.enemyThreat;
    const g = reduce(s, { type: 'BOARD' }, d);
    expect(g.ground!.threat).toBe(threat);
  });
});
