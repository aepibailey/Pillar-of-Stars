import { describe, expect, it } from 'vitest';
import { deriveSeed, hashString, Rng } from '../src/engine/rng';

describe('Rng determinism', () => {
  it('same seed produces the same sequence', () => {
    const a = Rng.fromString('alpha');
    const b = Rng.fromString('alpha');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('different seeds diverge', () => {
    const a = Rng.fromString('alpha');
    const b = Rng.fromString('beta');
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('derived streams are independent and stable', () => {
    expect(deriveSeed('run1', 'sector:0')).toBe(deriveSeed('run1', 'sector:0'));
    expect(deriveSeed('run1', 'sector:0')).not.toBe(deriveSeed('run1', 'sector:1'));
    expect(deriveSeed('run1', 'sector:0')).not.toBe(deriveSeed('run2', 'sector:0'));
  });

  it('serializes and resumes mid-stream (save/resume contract)', () => {
    const a = Rng.fromString('gamma');
    a.next();
    a.next();
    const resumed = new Rng(a.getState());
    expect(resumed.next()).toBe(a.next());
  });

  it('int stays in inclusive bounds', () => {
    const rng = Rng.fromString('bounds');
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
    }
  });

  it('weighted respects zero-weight items', () => {
    const rng = Rng.fromString('weights');
    for (let i = 0; i < 200; i++) {
      const picked = rng.weighted(
        [
          { id: 'never', w: 0 },
          { id: 'always', w: 5 },
        ],
        (x) => x.w,
      );
      expect(picked.id).toBe('always');
    }
  });

  it('hashString is stable', () => {
    expect(hashString('pillar')).toBe(hashString('pillar'));
  });
});
