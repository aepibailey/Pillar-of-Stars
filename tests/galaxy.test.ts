import { describe, expect, it } from 'vitest';
import configJson from '../data/config.json';
import type { GameConfig } from '../src/engine/types';
import { generateSector } from '../src/galaxy/generate';
import type { Sector } from '../src/galaxy/types';
import { cellOf, systemsInCell } from '../src/galaxy/waypoint';

const config = configJson as GameConfig;

function reachable(sector: Sector): Set<string> {
  const seen = new Set<string>([sector.entrySystemId]);
  const queue = [sector.entrySystemId];
  while (queue.length) {
    const id = queue.pop() as string;
    for (const next of sector.systems[id].links) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

describe('sector generation', () => {
  it('is fully deterministic from (seed, index)', () => {
    const a = generateSector('test-seed', 0, config);
    const b = generateSector('test-seed', 0, config);
    expect(a).toEqual(b);
  });

  it('different seeds or indexes produce different sectors', () => {
    const a = generateSector('test-seed', 0, config);
    const b = generateSector('other-seed', 0, config);
    const c = generateSector('test-seed', 1, config);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('respects the configured system count band', () => {
    for (let i = 0; i < 20; i++) {
      const s = generateSector(`seed-${i}`, 0, config);
      expect(s.systemIds.length).toBeGreaterThanOrEqual(config.sector.minSystems);
      expect(s.systemIds.length).toBeLessThanOrEqual(config.sector.maxSystems);
    }
  });

  it('every system is reachable from entry (MST guarantee)', () => {
    for (let i = 0; i < 20; i++) {
      const s = generateSector(`seed-${i}`, i % 3, config);
      expect(reachable(s).size).toBe(s.systemIds.length);
    }
  });

  it('links are symmetric', () => {
    const s = generateSector('sym-seed', 0, config);
    for (const id of s.systemIds) {
      for (const other of s.systems[id].links) {
        expect(s.systems[other].links).toContain(id);
      }
    }
  });

  it('entry is trailing (bottom), gate is coreward (top)', () => {
    for (let i = 0; i < 10; i++) {
      const s = generateSector(`edge-${i}`, 0, config);
      expect(s.systems[s.entrySystemId].y).toBeGreaterThan(0.8);
      expect(s.systems[s.gateSystemId].y).toBeLessThan(0.2);
    }
  });

  it('each system has 1-4 base nodes (+1 where a ruin was added)', () => {
    const s = generateSector('nodes-seed', 0, config);
    for (const id of s.systemIds) {
      const nonRuin = s.systems[id].nodes.filter((n) => n.type !== 'ruin').length;
      expect(nonRuin).toBeGreaterThanOrEqual(1);
      expect(nonRuin).toBeLessThanOrEqual(4);
    }
  });
});

describe('rough waypoint (§4/§9.3)', () => {
  it('waypoint selection is seed-deterministic', () => {
    const a = generateSector('wp-seed', 0, config);
    const b = generateSector('wp-seed', 0, config);
    expect(a.waypointCell).toEqual(b.waypointCell);
    expect(a.ruinSystemId).toBe(b.ruinSystemId);
  });

  it('the ruin system lies inside the waypoint cell', () => {
    for (let i = 0; i < 30; i++) {
      const s = generateSector(`wp-${i}`, i % 3, config);
      const ruin = s.systems[s.ruinSystemId];
      expect(cellOf(ruin.x, ruin.y, s.grid.cols, s.grid.rows)).toEqual(s.waypointCell);
    }
  });

  it('the ruin is never at the entry or the gate', () => {
    for (let i = 0; i < 30; i++) {
      const s = generateSector(`wp-x-${i}`, 0, config);
      expect(s.ruinSystemId).not.toBe(s.entrySystemId);
      expect(s.ruinSystemId).not.toBe(s.gateSystemId);
    }
  });

  it('the waypoint cell is in grid bounds and contains the ruin system', () => {
    for (let i = 0; i < 30; i++) {
      const s = generateSector(`wp-b-${i}`, 0, config);
      expect(s.waypointCell.col).toBeGreaterThanOrEqual(0);
      expect(s.waypointCell.col).toBeLessThan(s.grid.cols);
      expect(s.waypointCell.row).toBeGreaterThanOrEqual(0);
      expect(s.waypointCell.row).toBeLessThan(s.grid.rows);
      const inCell = systemsInCell(s, s.waypointCell);
      expect(inCell.map((x) => x.id)).toContain(s.ruinSystemId);
    }
  });

  it('the signal ruin sits in the ruin system; decoys are within the configured band', () => {
    for (let i = 0; i < 20; i++) {
      const s = generateSector(`ruins-${i}`, 0, config);
      const ruinSystems = s.systemIds.filter((id) =>
        s.systems[id].nodes.some((n) => n.type === 'ruin'),
      );
      expect(ruinSystems).toContain(s.ruinSystemId);
      expect(s.extraRuinSystemIds.length).toBeGreaterThanOrEqual(config.sector.extraRuinsMin);
      expect(s.extraRuinSystemIds.length).toBeLessThanOrEqual(config.sector.extraRuinsMax);
      expect(ruinSystems.length).toBe(1 + s.extraRuinSystemIds.length);
      // one ruin node per ruin system, generically named
      for (const id of ruinSystems) {
        const ruinNodes = s.systems[id].nodes.filter((n) => n.type === 'ruin');
        expect(ruinNodes.length).toBe(1);
        expect(ruinNodes[0].name).toBe('Ancient Ruins');
      }
    }
  });

  it('decoy ruins never sit on the entry, the gate, or the signal system', () => {
    for (let i = 0; i < 20; i++) {
      const s = generateSector(`decoy-${i}`, i % 3, config);
      for (const id of s.extraRuinSystemIds) {
        expect(id).not.toBe(s.entrySystemId);
        expect(id).not.toBe(s.gateSystemId);
        expect(id).not.toBe(s.ruinSystemId);
      }
    }
  });

  it('decoys fill from OUTSIDE the waypoint region first (patch §5)', () => {
    for (let i = 0; i < 30; i++) {
      const s = generateSector(`decoy-out-${i}`, 0, config);
      const inCell = (id: string) => {
        const sys = s.systems[id];
        const c = cellOf(sys.x, sys.y, s.grid.cols, s.grid.rows);
        return c.col === s.waypointCell.col && c.row === s.waypointCell.row;
      };
      const outsideCandidates = s.systemIds.filter(
        (id) =>
          id !== s.entrySystemId && id !== s.gateSystemId && id !== s.ruinSystemId && !inCell(id),
      ).length;
      const insideDecoys = s.extraRuinSystemIds.filter(inCell).length;
      // Decoys only spill inside the region when outside candidates ran out.
      expect(insideDecoys).toBe(Math.max(0, s.extraRuinSystemIds.length - outsideCandidates));
    }
  });
});
