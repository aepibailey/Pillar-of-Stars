import { describe, expect, it } from 'vitest';
import { config, enemies, ground, makeDeps } from './fixtures';
import {
  companionAction,
  focusCrew,
  foeAction,
  startGround,
  type StartGroundArgs,
} from '../src/ground/engine';
import { companionCardHtml, pendingCompanionBeat } from '../src/ui/companion';
import { currentSector, reduce, type Deps } from '../src/engine/reducer';
import { Rng } from '../src/engine/rng';
import type { GroundState } from '../src/ground/types';
import type { RunState } from '../src/engine/types';

function scene(overrides: Partial<StartGroundArgs> = {}): GroundState {
  return startGround({
    threat: 'GREEN',
    foeCount: 2,
    encounterName: 'Test Boarding',
    seed: 'companion-seed',
    encounterId: '0',
    config: ground,
    reward: { scrap: 5, ammoType: 'kinetic' },
    companionName: 'Kael Voss',
    ...overrides,
  });
}

/** A run in a real boarding against a known archetype, spouse aboard. */
function toBoarding(archetypeId = 'gunship', seed = 'comp-run'): { s: RunState; d: Deps } {
  const d = makeDeps({
    config: { ...config, hostileEncounterChance: 1, debugBoardable: true },
    enemies: enemies.filter((e) => e.id === archetypeId),
  });
  let s = reduce({} as RunState, { type: 'NEW_RUN', seed }, d);
  s = reduce(s, { type: 'FINISH_INTRO' }, d);
  s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
  s = reduce(s, { type: 'ACK_OUTCOME' }, d);
  const node = currentSector(s, config).systems[s.currentSystemId].nodes.find(
    (n) => n.type !== 'ruin',
  )!;
  s = reduce(s, { type: 'EXPLORE', nodeId: node.id }, d);
  s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
  s = reduce(s, { type: 'ACK_OUTCOME' }, d);
  s = reduce(s, { type: 'BOARD' }, d);
  expect(s.phase).toBe('ground');
  return { s, d };
}

describe('companion is rendered (the regression that let the spouse vanish)', () => {
  it('the companion card shows their name AND an HP bar', () => {
    const html = companionCardHtml(scene());
    expect(html).toContain('Kael Voss');
    expect(html).toContain('hbar');
    expect(html).toContain('HP 14/14');
  });

  it('a boarding run actually fields a rendered companion card', () => {
    const { s } = toBoarding();
    const html = companionCardHtml(s.ground!);
    expect(html).not.toBe('');
    expect(html).toContain(s.characters.find((c) => c.id === s.companionId)!.name);
  });

  it('the card stays visible (muted, tagged) when the companion is down', () => {
    const g = scene();
    g.fighters.find((f) => f.id === 'companion')!.down = 'killed';
    const html = companionCardHtml(g);
    expect(html).toContain('companion down');
    expect(html).toContain('killed');
  });

  it('no companion in the scene → no card (solo boarding)', () => {
    expect(companionCardHtml(scene({ companionName: null }))).toBe('');
  });
});

describe('companion HP parity (R2) reads from data, not a literal', () => {
  it('companion HP equals the data value (14)', () => {
    const g = scene();
    const comp = g.fighters.find((f) => f.id === 'companion')!;
    expect(comp.hpMax).toBe(ground.companion.hp);
    expect(comp.hpMax).toBe(14);
    expect(comp.hpMax).toBe(g.fighters.find((f) => f.id === 'captain')!.hpMax); // parity
  });
});

describe('companion self-preservation (R2)', () => {
  it('hurt AND exposed → plans a MOVE to intact cover', () => {
    const g = scene();
    const comp = g.fighters.find((f) => f.id === 'companion')!;
    // Below the cover-seek threshold, standing in the airlock with its cover shot away.
    comp.hp = Math.floor(comp.hpMax * ground.companion.coverSeekHpFraction) - 1;
    g.zones.find((z) => z.id === comp.zoneId)!.coverHp = 0; // exposed
    const plan = companionAction(comp, g, ground);
    expect(plan.kind).toBe('move');
    if (plan.kind === 'move') {
      expect(g.zones.find((z) => z.id === plan.zoneId)!.coverHp).toBeGreaterThan(0); // intact
    }
  });

  it('healthy → plans a SHOT at the weakest foe, not a retreat', () => {
    const g = scene();
    const comp = g.fighters.find((f) => f.id === 'companion')!;
    g.zones.find((z) => z.id === comp.zoneId)!.coverHp = 0; // exposed but healthy
    const plan = companionAction(comp, g, ground);
    expect(plan.kind).toBe('shoot');
  });

  it('hurt but already IN cover → keeps fighting (no needless retreat)', () => {
    const g = scene();
    const comp = g.fighters.find((f) => f.id === 'companion')!;
    comp.hp = 1;
    // Airlock has cover 1, coverHp intact by default → coverLevel > 0.
    expect(companionAction(comp, g, ground).kind).toBe('shoot');
  });
});

describe('foe targeting doctrine (R1 + R4)', () => {
  it('R1: foes focus the strictly weakest living crew member', () => {
    const g = scene();
    const cap = g.fighters.find((f) => f.id === 'captain')!;
    const comp = g.fighters.find((f) => f.id === 'companion')!;
    comp.hp = 4; // the spouse is the weakest
    const foe = g.fighters.find((f) => f.side === 'foe')!;
    const plan = foeAction(foe, g, ground, Rng.fromString('r1'));
    expect(plan.kind).toBe('shoot');
    if (plan.kind === 'shoot') expect(plan.targetId).toBe(comp.id);
    // And flip it: hurt the captain instead.
    comp.hp = comp.hpMax;
    cap.hp = 3;
    const plan2 = foeAction(foe, g, ground, Rng.fromString('r1'));
    if (plan2.kind === 'shoot') expect(plan2.targetId).toBe(cap.id);
  });

  it('R4: on an HP tie, fire spreads across the tied crew — seeded, deterministic', () => {
    const g = scene(); // captain 14/14, companion 14/14 → tie on turn one
    const picks = new Set<string>();
    for (let i = 0; i < 40; i++) {
      picks.add(focusCrew(g, Rng.fromString(`tie-${i}`)).id);
    }
    expect(picks).toContain('captain');
    expect(picks).toContain('companion'); // both get targeted — not one ganked
    // Same cursor → same pick (deterministic).
    expect(focusCrew(g, Rng.fromString('det')).id).toBe(focusCrew(g, Rng.fromString('det')).id);
  });

  it('R4: with no tie, RNG is not consumed (single-target turns stay stable)', () => {
    const g = scene();
    g.fighters.find((f) => f.id === 'companion')!.hp = 2; // clear weakest
    const rng = Rng.fromString('nostate');
    const before = rng.getState();
    focusCrew(g, rng);
    expect(rng.getState()).toBe(before); // untouched
  });
});

describe('succession is LIVABLE, not just implemented (§6.4)', () => {
  it('a GREEN boarding can be won with the spouse still standing', () => {
    // The whole point of the fix: the companion survives a winnable GREEN fight.
    let found = false;
    for (let attempt = 0; attempt < 20 && !found; attempt++) {
      const { s, d } = toBoarding('derelict-scavenger', `livable-${attempt}`);
      let g = s;
      let guard = 0;
      while (g.phase === 'ground' && g.ground!.outcome === 'ongoing' && guard++ < 40) {
        const foe = g.ground!.fighters.find((f) => f.side === 'foe' && f.down === null);
        const capHot = g.ground!.fighters.find((f) => f.id === 'captain')!.heat + ground.aimedHeat > ground.heatMax;
        g = capHot
          ? reduce(g, { type: 'GROUND_ACTION', groundAction: { type: 'GVENT' } }, d)
          : reduce(
              g,
              { type: 'GROUND_ACTION', groundAction: { type: 'GSHOOT', targetId: foe!.id, shot: 'aimed', mode: 'lethal' } },
              d,
            );
      }
      if (g.ground?.outcome === 'neutralized' && g.ground.fighters.find((f) => f.id === 'companion')!.down === null) {
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('captain falls + companion survives → the succession CHOICE is reachable', () => {
    const { s, d } = toBoarding();
    const g = structuredClone(s);
    g.ground!.fighters.find((f) => f.id === 'captain')!.hp = 0;
    g.ground!.outcome = 'captain-down'; // companion untouched, alive
    const after = reduce(g, { type: 'GROUND_ACK' }, d);
    expect(after.phase).toBe('succession');
  });
});

describe('companion-death beat (R3, §6.4/§9.4)', () => {
  function board(): RunState {
    return toBoarding().s;
  }

  it('fires when the companion is killed mid-fight; a founder death shows the ASCEND line', () => {
    const s = board();
    s.ground!.fighters.find((f) => f.id === 'companion')!.down = 'killed';
    const beat = pendingCompanionBeat(s);
    expect(beat).not.toBeNull();
    expect(beat!.name).toBe(s.characters.find((c) => c.id === s.companionId)!.name);
    expect(beat!.isFounder).toBe(true); // the spouse is a founder → ASCEND-lock line shows
  });

  it('a NON-founder companion (future recruit) gets the beat WITHOUT the ASCEND line', () => {
    const s = board();
    // Simulate a recruited (non-founder) companion holding the slot.
    const comp = s.characters.find((c) => c.id === s.companionId)!;
    comp.isFounder = false;
    s.ground!.fighters.find((f) => f.id === 'companion')!.down = 'killed';
    expect(pendingCompanionBeat(s)!.isFounder).toBe(false);
  });

  it('does NOT fire while the companion is alive, or once the fight is over', () => {
    const s = board();
    expect(pendingCompanionBeat(s)).toBeNull(); // alive
    s.ground!.fighters.find((f) => f.id === 'companion')!.down = 'killed';
    s.ground!.outcome = 'captain-down'; // same-turn total loss → succession/death, not a beat
    expect(pendingCompanionBeat(s)).toBeNull();
  });
});
