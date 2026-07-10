import type { Rng } from '../engine/rng';

const HEADS = [
  'Ka',
  'Ve',
  'Or',
  'Tha',
  'Sol',
  'Ny',
  'Rha',
  'Ze',
  'Al',
  'Mir',
  'Dun',
  'Cor',
  'Eri',
  'Vel',
  'Os',
  'Tyr',
  'Ish',
  'Qua',
  'Bel',
  'Hu',
];

const TAILS = [
  'ra',
  'lios',
  'dan',
  'meth',
  'ari',
  'vek',
  'ossa',
  'rin',
  'thae',
  'gor',
  'una',
  'phel',
  'dris',
  'kane',
  'ilo',
  'sur',
];

const NUMERALS = ['', ' II', ' III', ' IV', ' V'];

export function systemName(rng: Rng): string {
  const name = rng.pick(HEADS) + rng.pick(TAILS);
  return rng.next() < 0.25 ? name + rng.pick(NUMERALS) : name;
}

const SECTOR_EPITHETS = [
  'Verge',
  'Reach',
  'Expanse',
  'Drift',
  'Shallows',
  'Threshold',
  'Span',
  'Deep',
];

export function sectorName(rng: Rng): string {
  return `The ${rng.pick(HEADS)}${rng.pick(TAILS)} ${rng.pick(SECTOR_EPITHETS)}`;
}
