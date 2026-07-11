import { describe, expect, it } from 'vitest';
import {
  readProbability,
  readThreat,
  sensorTier,
  THREAT_ORDER,
  type KnownBand,
} from '../src/threat/sensor';

describe('sensorTier', () => {
  it('clamps onto the 0..5 accuracy scale', () => {
    expect(sensorTier(-3)).toBe(0);
    expect(sensorTier(2)).toBe(2);
    expect(sensorTier(9)).toBe(5);
    expect(sensorTier(2.4)).toBe(2);
  });
});

describe('readThreat', () => {
  it('tier 0 (dead sensors) returns UNKNOWN — the §7.4 blind gamble', () => {
    const r = readThreat('VETERAN', 0, 'seed-a');
    expect(r.band).toBe('UNKNOWN');
    expect(r.confidence).toBe('none');
    expect(r.detail).toBeNull();
  });

  it('tier 5 always reads the exact band with full manifest detail', () => {
    for (const band of THREAT_ORDER) {
      const r = readThreat(band, 5, `seed-${band}`, { count: 4, note: 'veteran gunner' });
      expect(r.band).toBe(band);
      expect(r.confidence).toBe('exact');
      expect(r.detail).toContain('4 crew');
      expect(r.detail).toContain('veteran gunner');
    }
  });

  it('tiers 3+ read the exact band (no drift), tiers 1-2 may blur it', () => {
    for (const band of THREAT_ORDER) {
      expect(readThreat(band, 3, `s3-${band}`).band).toBe(band);
      expect(readThreat(band, 4, `s4-${band}`).band).toBe(band);
    }
  });

  it('drift stays within the band scale (never out of range)', () => {
    for (let s = 0; s < 200; s++) {
      const r = readThreat('GREEN', 1, `edge-lo-${s}`);
      expect(THREAT_ORDER).toContain(r.band as KnownBand);
      const r2 = readThreat('ELITE', 1, `edge-hi-${s}`);
      expect(THREAT_ORDER).toContain(r2.band as KnownBand);
    }
  });

  it('low tiers are, on average, less accurate than mid tiers', () => {
    const trueIdx = THREAT_ORDER.indexOf('SEASONED');
    const err = (tier: number) => {
      let miss = 0;
      for (let s = 0; s < 300; s++) {
        const shown = THREAT_ORDER.indexOf(readThreat('SEASONED', tier, `acc-${tier}-${s}`).band as KnownBand);
        miss += Math.abs(shown - trueIdx);
      }
      return miss;
    };
    expect(err(1)).toBeGreaterThan(err(3)); // tier 3 is exact (0 error)
    expect(err(3)).toBe(0);
  });

  it('is deterministic for identical inputs', () => {
    expect(readThreat('VETERAN', 2, 'det', { count: 3 })).toEqual(
      readThreat('VETERAN', 2, 'det', { count: 3 }),
    );
  });

  it('manifest detail sharpens with tier (fuzzy count → exact → +role)', () => {
    expect(readThreat('SEASONED', 3, 'd', { count: 4 }).detail).toContain('lifesigns');
    expect(readThreat('SEASONED', 4, 'd', { count: 4 }).detail).toBe('4 crew');
    expect(readThreat('SEASONED', 5, 'd', { count: 4, note: 'ace pilot' }).detail).toContain('ace pilot');
  });
});

describe('readProbability', () => {
  it('tier 0 gives no reading', () => {
    const r = readProbability(0.2, 0, 'p', 'transmit');
    expect(r.estimate).toBeNull();
    expect(r.text).toBe('no reading');
  });

  it('tier 5 reads the true probability exactly (no noise)', () => {
    const r = readProbability(0.2, 5, 'p', 'transmit');
    expect(r.estimate).toBeCloseTo(0.2, 5);
    expect(r.text).toBe('~20%');
  });

  it('low tiers hedge with a word, not a number', () => {
    const r = readProbability(0.2, 1, 'p', 'transmit');
    expect(r.text).toMatch(/\?$/); // "possible?" etc.
    expect(['vague', 'rough']).toContain(r.confidence);
  });

  it('estimate stays within [0,1] even at the extremes', () => {
    for (let s = 0; s < 200; s++) {
      const lo = readProbability(0.02, 1, `lo-${s}`, 'x').estimate!;
      const hi = readProbability(0.98, 1, `hi-${s}`, 'x').estimate!;
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic for identical inputs', () => {
    expect(readProbability(0.35, 2, 'det', 'spotted')).toEqual(
      readProbability(0.35, 2, 'det', 'spotted'),
    );
  });
});
