import { describe, expect, it } from 'vitest';
import morphologiesJson from '../data/species-parts/morphologies.json';
import governmentsJson from '../data/species-parts/governments.json';
import valuesJson from '../data/species-parts/values.json';
import namesJson from '../data/species-parts/names.json';
import { generateSpecies, MAX_SPECIES, MIN_SPECIES } from '../src/species/generate';
import { generateDispositions, getRelation, pairKey } from '../src/species/disposition';
import type { Relation, SpeciesParts } from '../src/species/types';

export const speciesParts: SpeciesParts = {
  morphologies: (morphologiesJson as { morphologies: SpeciesParts['morphologies'] }).morphologies,
  governments: (governmentsJson as { governments: SpeciesParts['governments'] }).governments,
  values: (valuesJson as { values: SpeciesParts['values'] }).values,
  names: namesJson as SpeciesParts['names'],
};

describe('species generation (§8)', () => {
  it('produces 4-6 species, deterministically from the seed', () => {
    const a = generateSpecies('seed-A', speciesParts);
    expect(a.length).toBeGreaterThanOrEqual(MIN_SPECIES);
    expect(a.length).toBeLessThanOrEqual(MAX_SPECIES);
    expect(generateSpecies('seed-A', speciesParts)).toEqual(a); // exact reproduction
  });

  it('different seeds give different galaxies (statistically)', () => {
    const a = JSON.stringify(generateSpecies('seed-A', speciesParts));
    let anyDifferent = false;
    for (let i = 0; i < 5; i++) {
      if (JSON.stringify(generateSpecies(`seed-B${i}`, speciesParts)) !== a) anyDifferent = true;
    }
    expect(anyDifferent).toBe(true);
  });

  it('morphologies, governments, and names are distinct within a run', () => {
    for (let s = 0; s < 20; s++) {
      const species = generateSpecies(`variety-${s}`, speciesParts);
      expect(new Set(species.map((x) => x.morphologyId)).size).toBe(species.length);
      expect(new Set(species.map((x) => x.governmentId)).size).toBe(species.length);
      expect(new Set(species.map((x) => x.name)).size).toBe(species.length);
    }
  });

  it('each species carries 2-3 distinct cultural values from the pool', () => {
    for (const sp of generateSpecies('values-seed', speciesParts)) {
      expect(sp.valueIds.length).toBeGreaterThanOrEqual(2);
      expect(sp.valueIds.length).toBeLessThanOrEqual(3);
      expect(new Set(sp.valueIds).size).toBe(sp.valueIds.length);
      for (const v of sp.valueIds) {
        expect(speciesParts.values.some((d) => d.id === v)).toBe(true);
      }
    }
  });

  it('ids are stable generation-order handles (sp-0..sp-N)', () => {
    const species = generateSpecies('ids-seed', speciesParts);
    species.forEach((sp, i) => expect(sp.id).toBe(`sp-${i}`));
  });
});

describe('disposition matrix (§8)', () => {
  const species = generateSpecies('dispo-seed', speciesParts);

  it('is deterministic and covers every pair', () => {
    const a = generateDispositions('dispo-seed', species);
    expect(generateDispositions('dispo-seed', species)).toEqual(a);
    const pairCount = (species.length * (species.length - 1)) / 2;
    expect(Object.keys(a).length).toBe(pairCount);
  });

  it('always includes at least one war and one alliance (a live galaxy)', () => {
    for (let s = 0; s < 30; s++) {
      const sp = generateSpecies(`live-${s}`, speciesParts);
      const m = generateDispositions(`live-${s}`, sp);
      const rels = Object.values(m);
      expect(rels).toContain('war');
      expect(rels).toContain('alliance');
    }
  });

  it('getRelation is symmetric and defaults sanely', () => {
    const m = generateDispositions('dispo-seed', species);
    const [a, b] = [species[0].id, species[1].id];
    expect(getRelation(m, a, b)).toBe(getRelation(m, b, a));
    expect(getRelation(m, a, a)).toBe('alliance'); // self
    expect(getRelation(m, a, 'sp-99')).toBe('neutral'); // unknown pair
  });

  it('overrides layer over the baseline without mutating it', () => {
    const m = generateDispositions('dispo-seed', species);
    const [a, b] = [species[0].id, species[1].id];
    const base = getRelation(m, a, b);
    const overrides: Record<string, Relation> = { [pairKey(a, b)]: 'war' };
    expect(getRelation(m, a, b, overrides)).toBe('war');
    expect(getRelation(m, a, b)).toBe(base); // baseline untouched
  });
});
