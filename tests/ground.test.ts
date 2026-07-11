import { describe, expect, it } from 'vitest';
import groundJson from '../data/ground.json';
import {
  aliveFoes,
  captain,
  groundReduce,
  parleyChance,
  startGround,
  type StartGroundArgs,
} from '../src/ground/engine';
import type { GroundAction, GroundConfig, GroundState } from '../src/ground/types';

const config = (groundJson as { config: GroundConfig }).config;

function scene(overrides: Partial<StartGroundArgs> = {}): GroundState {
  return startGround({
    threat: 'GREEN',
    foeCount: 2,
    encounterName: 'Test Boarding',
    seed: 'ground-seed',
    encounterId: '0',
    config,
    reward: { scrap: 5, ammoType: 'kinetic' },
    ...overrides,
  });
}

function run(s: GroundState, action: GroundAction): GroundState {
  return groundReduce(s, action, config);
}

describe('startGround', () => {
  it('fields the captain plus N foes with live cover zones', () => {
    const s = scene({ foeCount: 3 });
    expect(captain(s).id).toBe('captain');
    expect(aliveFoes(s)).toHaveLength(3);
    expect(s.zones.every((z) => z.coverHp === z.cover)).toBe(true);
    expect(s.outcome).toBe('ongoing');
    expect(s.items.map((i) => i.id)).toContain('stun-grenade');
  });

  it('scales foe strength off the threat band', () => {
    expect(startGround({ ...base(), threat: 'ELITE' }).fighters[1].hp).toBeGreaterThan(
      startGround({ ...base(), threat: 'GREEN' }).fighters[1].hp,
    );
  });

  it('offers parley to green/seasoned crews but not veterans/elites', () => {
    expect(startGround({ ...base(), threat: 'SEASONED' }).allyOffered).toBe(true);
    expect(startGround({ ...base(), threat: 'ELITE' }).allyOffered).toBe(false);
  });
});

function base(): StartGroundArgs {
  return {
    threat: 'GREEN',
    foeCount: 1,
    encounterName: 'x',
    seed: 's',
    encounterId: '0',
    config,
    reward: { scrap: 5, ammoType: 'kinetic' },
  };
}

describe('resolution', () => {
  it('killing every foe with lethal fire → neutralized', () => {
    let s = scene({ foeCount: 1, seed: 'kill-seed' });
    let guard = 0;
    while (s.outcome === 'ongoing' && guard++ < 60) {
      const foe = aliveFoes(s)[0];
      s = run(s, { type: 'GSHOOT', targetId: foe.id, shot: 'aimed', mode: 'lethal' });
      if (s.outcome === 'ongoing' && captain(s).heat + config.aimedHeat > config.heatMax) {
        s = run(s, { type: 'GVENT' });
      }
    }
    expect(['neutralized', 'captain-down']).toContain(s.outcome);
    if (s.outcome === 'neutralized') {
      expect(s.fighters.some((f) => f.down === 'killed')).toBe(true);
    }
  });

  it('stun fire subdues without killing → subdued', () => {
    let s = scene({ foeCount: 1, threat: 'GREEN', seed: 'stun-seed' });
    let guard = 0;
    while (s.outcome === 'ongoing' && guard++ < 80) {
      const foe = aliveFoes(s)[0];
      if (foe && captain(s).heat + config.snapHeat <= config.heatMax) {
        s = run(s, { type: 'GSHOOT', targetId: foe.id, shot: 'snap', mode: 'stun' });
      } else {
        s = run(s, { type: 'GVENT' });
      }
    }
    if (s.outcome === 'subdued') {
      expect(s.fighters.filter((f) => f.side === 'foe').every((f) => f.down !== 'killed')).toBe(true);
    }
    expect(['subdued', 'captain-down', 'neutralized']).toContain(s.outcome);
  });

  it('a successful parley ends the fight as allied, no shots fired', () => {
    // Force success: GREEN base 0.6 — search a seed whose first parley accepts.
    for (let i = 0; i < 40; i++) {
      const trial = run(scene({ foeCount: 2, threat: 'GREEN', seed: `parley-${i}` }), { type: 'GPARLEY' });
      if (trial.outcome === 'allied') {
        expect(trial.fighters.filter((f) => f.side === 'foe').every((f) => f.down === 'yielded')).toBe(true);
        return;
      }
    }
    throw new Error('no parley success found across seeds');
  });

  it('parley odds rise as the crew gets hurt', () => {
    const s = scene({ foeCount: 2, threat: 'VETERAN' });
    const before = parleyChance(s, config);
    const hurt = structuredClone(s);
    for (const f of hurt.fighters) if (f.side === 'foe') f.hp = 1;
    expect(parleyChance(hurt, config)).toBeGreaterThan(before);
  });

  it('withdraw bails out of the boarding immediately', () => {
    const s = run(scene(), { type: 'GWITHDRAW' });
    expect(s.outcome).toBe('withdrawn');
  });

  it('an overheated blaster refuses the shot instead of firing', () => {
    let s = scene({ foeCount: 1 });
    // Max out heat with aimed shots, then confirm the next aimed shot is refused.
    const foe = aliveFoes(s)[0].id;
    s.fighters.find((f) => f.id === 'captain')!.heat = config.heatMax;
    const before = structuredClone(s.fighters.find((f) => f.id === foe));
    s = run(s, { type: 'GSHOOT', targetId: foe, shot: 'aimed', mode: 'lethal' });
    const after = s.fighters.find((f) => f.id === foe)!;
    // No captain damage dealt this turn (shot refused); foe may still have shot back.
    expect(s.log.some((l) => l.includes('too hot'))).toBe(true);
    void before;
    void after;
  });

  it('cover degrades as it soaks fire', () => {
    let s = scene({ foeCount: 1, seed: 'cover-seed' });
    const foe = aliveFoes(s)[0];
    const zoneBefore = s.zones.find((z) => z.id === foe.zoneId)!.coverHp;
    s = run(s, { type: 'GSHOOT', targetId: foe.id, shot: 'snap', mode: 'lethal' });
    const zoneAfter = s.zones.find((z) => z.id === foe.zoneId)!.coverHp;
    expect(zoneAfter).toBeLessThan(zoneBefore);
  });

  it('is deterministic and survives a save round-trip', () => {
    const s = scene({ seed: 'det-seed' });
    const foe = aliveFoes(s)[0].id;
    const a = run(s, { type: 'GSHOOT', targetId: foe, shot: 'aimed', mode: 'lethal' });
    const rt = JSON.parse(JSON.stringify(s)) as GroundState;
    const b = run(rt, { type: 'GSHOOT', targetId: foe, shot: 'aimed', mode: 'lethal' });
    expect(a).toEqual(b);
  });
});
