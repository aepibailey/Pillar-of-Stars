/**
 * Seeded, serializable RNG. Non-negotiable (§13): one run seed reproduces the
 * whole galaxy. Uses xmur3 to hash string seeds and mulberry32 as the PRNG.
 *
 * Two usage patterns:
 *  - Derived streams: `Rng.fromString(runSeed, 'sector:2')` — stateless
 *    reproduction of generated content (galaxy, names, waypoints).
 *  - Persistent streams: event/outcome rolls store `getState()` in RunState so
 *    save/resume continues the exact sequence.
 */

export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export function deriveSeed(seed: string, label: string): number {
  return hashString(`${seed}::${label}`);
}

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  static fromString(seed: string, label = ''): Rng {
    return new Rng(deriveSeed(seed, label));
  }

  getState(): number {
    return this.state >>> 0;
  }

  /** Float in [0, 1). Advances the stream. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick on empty array');
    return arr[this.int(0, arr.length - 1)];
  }

  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    if (items.length === 0) throw new Error('Rng.weighted on empty array');
    const total = items.reduce((sum, item) => sum + weightOf(item), 0);
    let r = this.next() * total;
    for (const item of items) {
      r -= weightOf(item);
      if (r <= 0) return item;
    }
    return items[items.length - 1];
  }
}
