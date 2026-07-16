import { describe, expect, it } from 'vitest';
import { config, enemies, makeDeps } from './fixtures';
import {
  currentSector,
  reduce,
  successionCandidates,
  type Deps,
} from '../src/engine/reducer';
import type { RunState } from '../src/engine/types';

/** Reach a boardable ship fight (gunship), spouse companion aboard. */
function toBoardable(seed = 'succ-seed'): { s: RunState; d: Deps } {
  const d = makeDeps({
    config: { ...config, hostileEncounterChance: 1, debugBoardable: true },
    enemies: enemies.filter((e) => e.id === 'gunship'),
  });
  let s = reduce({} as RunState, { type: 'NEW_RUN', seed }, d);
  s = reduce(s, { type: 'FINISH_INTRO' }, d);
  s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
  s = reduce(s, { type: 'ACK_OUTCOME' }, d);
  const sector = currentSector(s, config);
  const node = sector.systems[s.currentSystemId].nodes.find((n) => n.type !== 'ruin')!;
  s = reduce(s, { type: 'EXPLORE', nodeId: node.id }, d);
  s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
  s = reduce(s, { type: 'ACK_OUTCOME' }, d);
  expect(s.phase).toBe('combat');
  return { s, d };
}

/** Board, then force a specific corridor result before GROUND_ACK. */
function boardWith(
  rig: (g: RunState) => void,
  seed = 'succ-seed',
): { after: RunState; d: Deps; captainId: string; spouseId: string } {
  const { s, d } = toBoardable(seed);
  const captainId = s.captainId;
  const spouseId = s.founderIds.find((id) => id !== captainId)!;
  const g = reduce(s, { type: 'BOARD' }, d);
  expect(g.phase).toBe('ground');
  rig(g);
  const after = reduce(g, { type: 'GROUND_ACK' }, d);
  return { after, d, captainId, spouseId };
}

const capDown = (g: RunState) => {
  g.ground!.fighters.find((f) => f.id === 'captain')!.hp = 0;
  g.ground!.outcome = 'captain-down';
};
const compKilled = (g: RunState) => {
  g.ground!.fighters.find((f) => f.id === 'companion')!.down = 'killed';
};

describe('succession (§6.4 v0.7): captain dies, spouse survives', () => {
  it('presents the CHOICE: continue-as candidates exist and nothing is automatic', () => {
    const { after, spouseId } = boardWith(capDown);
    expect(after.phase).toBe('succession');
    const candidates = successionCandidates(after);
    expect(candidates.map((c) => c.id)).toEqual([spouseId]);
    // The dead captain is really dead; nothing has been decided yet.
    expect(after.characters.find((c) => c.id === after.captainId)?.alive).toBe(false);
  });

  it('SUCCEED_AS promotes the spouse to captain in full, with the §6.4 costs', () => {
    const { after, d, captainId, spouseId } = boardWith(capDown);
    const wakeBefore = after.wake;
    const s = reduce(after, { type: 'SUCCEED_AS', characterId: spouseId }, d);
    expect(s.captainId).toBe(spouseId);
    expect(s.characters.find((c) => c.id === spouseId)?.role).toBe('captain');
    expect(s.companionId).toBeNull(); // the slot they held reopens
    expect(s.runId).toBe(after.runId); // the JOURNEY persists (§6.4 guardrail)
    expect(s.flags.moraleCratered).toBe(true);
    expect(s.flags.reputationCooled).toBe(true);
    expect(s.flags[`agendaLive:${spouseId}`]).toBe(true);
    // The Wake surged exactly one extra jump during the handover.
    const spent =
      wakeBefore.graceHundredths - s.wake.graceHundredths +
      (s.wake.progressHundredths - wakeBefore.progressHundredths) +
      100 * (s.wake.consumedIds.length - wakeBefore.consumedIds.length);
    expect(spent).toBe(100);
    expect(s.characters.find((c) => c.id === captainId)?.alive).toBe(false);
  });

  it('SUCCEED_AS rejects dead or invalid successors', () => {
    const { after, d, captainId } = boardWith(capDown);
    expect(reduce(after, { type: 'SUCCEED_AS', characterId: captainId }, d)).toBe(after);
    expect(reduce(after, { type: 'SUCCEED_AS', characterId: 'nobody' }, d)).toBe(after);
  });

  it('begin-again from the succession screen carries the codex (knowledge only)', () => {
    const { after, d } = boardWith((g) => {
      g.codex.entries = ['morph:avian'];
      capDown(g);
    });
    const fresh = reduce(after, { type: 'NEW_RUN', seed: 'fresh-after-loss' }, d);
    expect(fresh.codex.entries).toEqual(['morph:avian']);
    expect(fresh.characters.every((c) => c.alive)).toBe(true); // a new couple
    expect(fresh.ascendLocked).toBe(false); // the lock is per-run
  });
});

describe('the ASCEND lock (§9.4 v0.7): either founder, any time, permanent', () => {
  it('captain death locks ASCEND — every continue-as run is RETRIBUTION-only', () => {
    const { after } = boardWith(capDown);
    expect(after.ascendLocked).toBe(true);
  });

  it('SPOUSE death locks ASCEND too — no succession, the captain plays on', () => {
    // Companion killed in a WON fight: the run continues, but the lock lands.
    const { after, spouseId } = boardWith((g) => {
      compKilled(g);
      for (const f of g.ground!.fighters) if (f.side === 'foe') f.down = 'killed';
      g.ground!.outcome = 'neutralized';
    });
    expect(after.phase).toBe('map'); // no succession — the captain is alive
    expect(after.ascendLocked).toBe(true);
    expect(after.characters.find((c) => c.id === spouseId)?.alive).toBe(false);
    expect(after.companionId).toBeNull(); // the §6.3 slot reopens
    expect(after.flags.spouseFallen).toBe(true);
    expect(after.flags.vengeanceSeeded).toBe(true);
    expect(after.flags.moraleHitHeavy).toBe(true); // heavier than a normal loss
  });
});

describe('forced restart + ironman (§6.4)', () => {
  it('solo death (no crew left) forces begin-again — no choice offered', () => {
    // Spouse died earlier in the run; later the captain falls boarding alone.
    const { s, d } = toBoardable('solo-seed');
    const spouseId = s.founderIds.find((id) => id !== s.captainId)!;
    const solo = structuredClone(s);
    solo.characters.find((c) => c.id === spouseId)!.alive = false;
    solo.companionId = null;
    let g = reduce(solo, { type: 'BOARD' }, d);
    expect(g.ground!.fighters.some((f) => f.id === 'companion')).toBe(false); // boarded alone
    capDown(g);
    g = reduce(g, { type: 'GROUND_ACK' }, d);
    expect(g.phase).toBe('dead'); // journey over — forced begin-again
    expect(g.deathCause).toBe('boarding');
  });

  it('ironman makes any captain death final, even with the spouse standing', () => {
    const { s, d } = toBoardable('iron-succ-seed');
    const iron = structuredClone(s);
    iron.ironman = true;
    let g = reduce(iron, { type: 'BOARD' }, d);
    capDown(g);
    g = reduce(g, { type: 'GROUND_ACK' }, d);
    expect(g.phase).toBe('dead'); // no continue-as-crew offered
  });
});

describe('spouse-desertion immunity (v0.7 §6.2)', () => {
  it('the spouse carries desertionImmune while alive — including after succession', () => {
    const { after, d, spouseId } = boardWith(capDown);
    const s = reduce(after, { type: 'SUCCEED_AS', characterId: spouseId }, d);
    const spouse = s.characters.find((c) => c.id === spouseId)!;
    expect(spouse.alive).toBe(true);
    expect(spouse.desertionImmune).toBe(true); // the future morale system's contract
  });
});
