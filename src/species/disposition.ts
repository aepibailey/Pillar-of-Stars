/**
 * Disposition matrix (§8): procedurally generated wars, alliances, and grudges
 * between this run's species. Pure + seeded, like generateSpecies. The player
 * walks into a live geopolitical situation each run — so generation guarantees
 * at least one war and one alliance whenever there are 3+ species.
 *
 * Read API: pairKey() + getRelation() — events/dialogue query relations between
 * any two species through this, never by poking the matrix shape directly.
 */

import { Rng } from '../engine/rng';
import type { DispositionMatrix, Relation, Species } from './types';

/** Canonical unordered-pair key: pairKey(a,b) === pairKey(b,a). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const ROLL_TABLE: { relation: Relation; weight: number }[] = [
  { relation: 'neutral', weight: 4 },
  { relation: 'grudge', weight: 3 },
  { relation: 'alliance', weight: 2 },
  { relation: 'war', weight: 2 },
];

function rollRelation(rng: Rng): Relation {
  const total = ROLL_TABLE.reduce((s, e) => s + e.weight, 0);
  let r = rng.next() * total;
  for (const e of ROLL_TABLE) {
    r -= e.weight;
    if (r < 0) return e.relation;
  }
  return 'neutral';
}

/**
 * Generate the baseline matrix for a species set. Deterministic from
 * (seed, species order) — species come from generateSpecies, which is itself
 * seed-stable, so the whole geopolitical situation reproduces from the run seed.
 */
export function generateDispositions(seed: string, species: readonly Species[]): DispositionMatrix {
  const rng = Rng.fromString(seed, 'dispositions');
  const matrix: DispositionMatrix = {};
  const pairs: [string, string][] = [];
  for (let i = 0; i < species.length; i++) {
    for (let j = i + 1; j < species.length; j++) {
      pairs.push([species[i].id, species[j].id]);
    }
  }
  for (const [a, b] of pairs) matrix[pairKey(a, b)] = rollRelation(rng);

  // A live galaxy needs stakes: force at least one war and one alliance when
  // there's room (3+ species → 3+ pairs). Deterministic: overwrite the first
  // rolled pairs that aren't already carrying the missing relation.
  if (pairs.length >= 3) {
    const values = () => pairs.map(([a, b]) => matrix[pairKey(a, b)]);
    if (!values().includes('war')) {
      const idx = pairs.findIndex(([a, b]) => matrix[pairKey(a, b)] !== 'alliance');
      matrix[pairKey(...pairs[idx === -1 ? 0 : idx])] = 'war';
    }
    if (!values().includes('alliance')) {
      const idx = pairs.findIndex(([a, b]) => matrix[pairKey(a, b)] !== 'war');
      matrix[pairKey(...pairs[idx === -1 ? 0 : idx])] = 'alliance';
    }
  }
  return matrix;
}

/**
 * THE read API (§8): the relation between two species, with any run-mutations
 * (events can shift a pair later) layered over the generated baseline.
 * Same-species → 'alliance' by definition. Unknown pair → 'neutral'.
 */
export function getRelation(
  matrix: DispositionMatrix,
  a: string,
  b: string,
  overrides?: Record<string, Relation>,
): Relation {
  if (a === b) return 'alliance';
  const key = pairKey(a, b);
  return overrides?.[key] ?? matrix[key] ?? 'neutral';
}
