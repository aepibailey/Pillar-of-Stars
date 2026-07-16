/**
 * Species generation (§8). Pure + seeded: same seed + same parts data → the
 * exact same 4–6 species, every time, on every device. Derives from the run
 * seed via its own labelled stream so it can't drift when other systems consume
 * RNG in different orders.
 */

import { Rng } from '../engine/rng';
import type { Species, SpeciesParts } from './types';

export const MIN_SPECIES = 4;
export const MAX_SPECIES = 6;

/** Seeded pick of n DISTINCT items (order deterministic). */
function pickDistinct<T>(rng: Rng, pool: readonly T[], n: number): T[] {
  const left = [...pool];
  const out: T[] = [];
  for (let i = 0; i < n && left.length > 0; i++) {
    out.push(left.splice(rng.int(0, left.length - 1), 1)[0]);
  }
  return out;
}

function makeName(rng: Rng, parts: SpeciesParts['names'], taken: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const name =
      rng.pick(parts.prefixes) + rng.pick(parts.middles) + rng.pick(parts.suffixes);
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  // Astronomically unlikely with the shipped pools; suffix a number rather than throw.
  const fallback = `${rng.pick(parts.prefixes)}${taken.size}`;
  taken.add(fallback);
  return fallback;
}

/**
 * Generate this run's major species. Morphologies and governments are distinct
 * across the set (variety is the point of the system); values are 2–3 distinct
 * per species and may repeat across species (two honor-debt cultures at war is
 * good drama, not a bug).
 */
export function generateSpecies(seed: string, parts: SpeciesParts): Species[] {
  const rng = Rng.fromString(seed, 'species');
  const count = rng.int(MIN_SPECIES, MAX_SPECIES);
  const morphs = pickDistinct(rng, parts.morphologies, count);
  const govs = pickDistinct(rng, parts.governments, count);
  const taken = new Set<string>();

  const out: Species[] = [];
  for (let i = 0; i < count; i++) {
    const valueCount = rng.int(2, 3);
    out.push({
      id: `sp-${i}`,
      name: makeName(rng, parts.names, taken),
      morphologyId: morphs[i].id,
      governmentId: govs[i].id,
      valueIds: pickDistinct(rng, parts.values, valueCount).map((v) => v.id),
    });
  }
  return out;
}
