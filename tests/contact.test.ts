import { describe, expect, it } from 'vitest';
import { config, deps, makeDeps } from './fixtures';
import { currentSector, decodeChance, reduce, runSpecies, type Deps } from '../src/engine/reducer';
import { deriveSeed } from '../src/engine/rng';
import type { RunState } from '../src/engine/types';

function toMap(seed = 'contact-seed', d: Deps = deps): RunState {
  let s = reduce({} as RunState, { type: 'NEW_RUN', seed }, d);
  s = reduce(s, { type: 'FINISH_INTRO' }, d);
  s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, d);
  s = reduce(s, { type: 'ACK_OUTCOME' }, d);
  return s;
}

/** Deps that force first contact on every exploration (the ?contact=1 override). */
const contactDeps = makeDeps({ config: { ...config, debugContact: true } });

function exploreAny(s: RunState, d: Deps): RunState {
  const sector = currentSector(s, config);
  const node = sector.systems[s.currentSystemId].nodes.find((n) => n.type !== 'ruin')!;
  return reduce(s, { type: 'EXPLORE', nodeId: node.id }, d);
}

/** Put the run into a contact at a chosen rng cursor so rolls are steerable. */
function riggedContact(label: string, d: Deps = contactDeps): RunState {
  let s = toMap('contact-seed', d);
  s = exploreAny(s, d);
  expect(s.phase).toBe('contact');
  s = structuredClone(s);
  s.contact = { ...s.contact!, rngState: deriveSeed('contact-roll', label) };
  return s;
}

describe('first contact trigger (§8)', () => {
  it('exploration can open a contact with an uncontacted species (sensors stage)', () => {
    const s = riggedContact('trigger');
    expect(s.contact?.stage).toBe('sensors');
    expect(runSpecies(s, deps).some((sp) => sp.id === s.contact?.speciesId)).toBe(true);
    expect(s.contactedSpeciesIds).not.toContain(s.contact?.speciesId);
  });

  it('withdrawing pre-dialogue leaves no trace — species stays unmet', () => {
    const s = riggedContact('withdraw');
    const after = reduce(s, { type: 'CONTACT_WITHDRAW' }, contactDeps);
    expect(after.phase).toBe('map');
    expect(after.contact).toBeNull();
    expect(after.contactedSpeciesIds).toHaveLength(0);
    expect(Object.keys(after.speciesStanding)).toHaveLength(0);
  });
});

describe('linguistic decoding (§8: sensors + comms + crew skill)', () => {
  it('decode odds rise with sensor and comms levels', () => {
    const s = toMap();
    const base = decodeChance(s, deps);
    const boosted = structuredClone(s);
    boosted.ship.subsystems.sensors.level += 2;
    boosted.ship.subsystems.comms.level += 2;
    expect(decodeChance(boosted, deps)).toBeGreaterThan(base);
  });

  it('a crew xeno-linguist raises the odds further', () => {
    const s = toMap();
    const withLinguist = structuredClone(s);
    withLinguist.characters[1].skills.push({ domain: 'linguistics', level: 3 });
    expect(decodeChance(withLinguist, deps)).toBeGreaterThan(decodeChance(s, deps));
  });

  it('a successful decode reaches dialogue; choosing peace records contact + standing + codex', () => {
    for (let i = 0; i < 60; i++) {
      let s = riggedContact(`succ-${i}`);
      const speciesId = s.contact!.speciesId;
      s = reduce(s, { type: 'CONTACT_PROCEED' }, contactDeps);
      s = reduce(s, { type: 'CONTACT_DECODE' }, contactDeps);
      if (s.contact?.stage !== 'dialogue') continue;
      s = reduce(s, { type: 'CONTACT_DIALOGUE', stance: 'peaceful' }, contactDeps);
      expect(s.contact?.stage).toBe('done');
      s = reduce(s, { type: 'CONTACT_ACK' }, contactDeps);
      expect(s.phase).toBe('map');
      expect(s.contactedSpeciesIds).toContain(speciesId);
      expect(s.speciesStanding[speciesId]).toBe(config.firstContact.peacefulStanding);
      // Codex logs the species COMPONENTS (cross-run-stable knowledge).
      const sp = runSpecies(s, deps).find((x) => x.id === speciesId)!;
      expect(s.codex.entries).toContain(`morph:${sp.morphologyId}`);
      expect(s.codex.entries).toContain(`gov:${sp.governmentId}`);
      return;
    }
    throw new Error('no successful decode found across 60 rigged cursors');
  });

  it('a BOTCHED contact creates lasting hostility (§8)', () => {
    // botchChance 1 → any failed decode roll botches. Hunt a failing cursor.
    const botchDeps = makeDeps({
      config: {
        ...config,
        debugContact: true,
        firstContact: { ...config.firstContact, botchChance: 1 },
      },
    });
    for (let i = 0; i < 60; i++) {
      let s = riggedContact(`botch-${i}`, botchDeps);
      const speciesId = s.contact!.speciesId;
      s = reduce(s, { type: 'CONTACT_PROCEED' }, botchDeps);
      s = reduce(s, { type: 'CONTACT_DECODE' }, botchDeps);
      if (s.contact?.stage !== 'done' || !s.flags[`botchedContact:${speciesId}`]) continue;
      s = reduce(s, { type: 'CONTACT_ACK' }, botchDeps);
      expect(s.speciesStanding[speciesId]).toBe(config.firstContact.botchStanding); // hostile
      expect(s.contactedSpeciesIds).toContain(speciesId); // met — badly
      expect(s.phase).toBe('map');
      return;
    }
    throw new Error('no botch found across 60 rigged cursors');
  });

  it('running out of attempts closes the window without hostility', () => {
    const oneShot = makeDeps({
      config: {
        ...config,
        debugContact: true,
        firstContact: { ...config.firstContact, attempts: 1, botchChance: 0 },
      },
    });
    for (let i = 0; i < 60; i++) {
      let s = riggedContact(`window-${i}`, oneShot);
      const speciesId = s.contact!.speciesId;
      s = reduce(s, { type: 'CONTACT_PROCEED' }, oneShot);
      s = reduce(s, { type: 'CONTACT_DECODE' }, oneShot);
      if (s.contact?.stage !== 'done' || s.flags[`botchedContact:${speciesId}`]) continue;
      if (s.contactedSpeciesIds.includes(speciesId)) continue; // that was a success
      s = reduce(s, { type: 'CONTACT_ACK' }, oneShot);
      expect(s.speciesStanding[speciesId]).toBeUndefined();
      expect(s.contactedSpeciesIds).not.toContain(speciesId);
      return;
    }
    throw new Error('no window-close found across 60 rigged cursors');
  });

  it('the whole flow is deterministic and survives a save round-trip', () => {
    const s = riggedContact('det');
    const a = reduce(
      reduce(s, { type: 'CONTACT_PROCEED' }, contactDeps),
      { type: 'CONTACT_DECODE' },
      contactDeps,
    );
    const rt = JSON.parse(JSON.stringify(s)) as RunState;
    const b = reduce(
      reduce(rt, { type: 'CONTACT_PROCEED' }, contactDeps),
      { type: 'CONTACT_DECODE' },
      contactDeps,
    );
    expect(a).toEqual(b);
  });
});
