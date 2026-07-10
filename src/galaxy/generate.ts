/**
 * Deterministic sector generation. Everything derives from (runSeed, sectorIndex)
 * through a dedicated RNG stream — the same seed always reproduces the same
 * galaxy (§13 non-negotiable). Sectors are derived data: regenerated on load,
 * never serialized into the save.
 */

import { Rng } from '../engine/rng';
import type { GameConfig } from '../engine/types';
import { sectorName, systemName } from './names';
import type { GridCell, NodeType, Sector, StarSystem, SystemNode } from './types';
import { cellOf } from './waypoint';

const MIN_DIST = 0.14;
const PLACEMENT_TRIES = 40;
const EXTRA_EDGE_MAX_LEN = 0.34;
const MAX_DEGREE = 4;

interface NodeTypeWeight {
  type: NodeType;
  weight: number;
}

const NODE_WEIGHTS: NodeTypeWeight[] = [
  { type: 'planet', weight: 5 },
  { type: 'station', weight: 3 },
  { type: 'derelict', weight: 2 },
  { type: 'anomaly', weight: 2 },
];

const NODE_LABELS: Record<NodeType, string> = {
  planet: 'Planet',
  station: 'Station',
  derelict: 'Derelict',
  anomaly: 'Anomaly',
  ruin: 'Ascended Ruin',
};

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Place `count` points: entry (bottom), gate (top, coreward), rest jitter-sampled with a min-distance preference. */
function placePositions(rng: Rng, count: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [
    { x: rng.range(0.35, 0.65), y: rng.range(0.9, 0.95) }, // entry
    { x: rng.range(0.35, 0.65), y: rng.range(0.05, 0.1) }, // gate
  ];
  while (pts.length < count) {
    let best: { x: number; y: number } | null = null;
    let bestScore = -1;
    for (let t = 0; t < PLACEMENT_TRIES; t++) {
      const candidate = { x: rng.range(0.08, 0.92), y: rng.range(0.16, 0.84) };
      const nearest = Math.min(...pts.map((p) => dist(p.x, p.y, candidate.x, candidate.y)));
      if (nearest >= MIN_DIST) {
        best = candidate;
        break;
      }
      if (nearest > bestScore) {
        bestScore = nearest;
        best = candidate;
      }
    }
    pts.push(best as { x: number; y: number });
  }
  return pts;
}

/** Minimum spanning tree (Prim) + short extra edges for loops. Deterministic given positions. */
function buildLinks(rng: Rng, pts: { x: number; y: number }[]): Set<string> {
  const n = pts.length;
  const edges = new Set<string>();
  const degree = new Array<number>(n).fill(0);
  const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const addEdge = (a: number, b: number) => {
    edges.add(key(a, b));
    degree[a]++;
    degree[b]++;
  };

  // Prim's MST — guarantees every system (incl. entry & gate) is reachable.
  const inTree = new Array<boolean>(n).fill(false);
  inTree[0] = true;
  for (let added = 1; added < n; added++) {
    let bestA = -1;
    let bestB = -1;
    let bestD = Infinity;
    for (let a = 0; a < n; a++) {
      if (!inTree[a]) continue;
      for (let b = 0; b < n; b++) {
        if (inTree[b]) continue;
        const d = dist(pts[a].x, pts[a].y, pts[b].x, pts[b].y);
        if (d < bestD) {
          bestD = d;
          bestA = a;
          bestB = b;
        }
      }
    }
    inTree[bestB] = true;
    addEdge(bestA, bestB);
  }

  // Extra short edges → loops, so routing has real choices.
  const candidates: { a: number; b: number; d: number }[] = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (edges.has(key(a, b))) continue;
      const d = dist(pts[a].x, pts[a].y, pts[b].x, pts[b].y);
      if (d <= EXTRA_EDGE_MAX_LEN) candidates.push({ a, b, d });
    }
  }
  candidates.sort((p, q) => p.d - q.d || p.a - q.a || p.b - q.b);
  let budget = Math.floor(n * 0.5);
  for (const c of candidates) {
    if (budget <= 0) break;
    if (degree[c.a] >= MAX_DEGREE || degree[c.b] >= MAX_DEGREE) continue;
    // Skip a few deterministically so lane patterns vary between sectors.
    if (rng.next() < 0.25) continue;
    addEdge(c.a, c.b);
    budget--;
  }
  return edges;
}

function rollNodes(rng: Rng, systemId: string): SystemNode[] {
  const count = rng.int(1, 4);
  const nodes: SystemNode[] = [];
  for (let j = 0; j < count; j++) {
    const type = rng.weighted(NODE_WEIGHTS, (w) => w.weight).type;
    nodes.push({
      id: `${systemId}-n${j}`,
      type,
      name: `${NODE_LABELS[type]} ${'I'.repeat(j + 1).replace('IIII', 'IV')}`,
    });
  }
  return nodes;
}

/**
 * Pick the ruin system: never entry or gate, and prefer cells holding ≥2
 * systems so the waypoint region is a real search area, not a disguised pin.
 */
function pickRuinSystem(
  rng: Rng,
  systems: StarSystem[],
  entryId: string,
  gateId: string,
  cols: number,
  rows: number,
): StarSystem {
  const candidates = systems.filter((s) => s.id !== entryId && s.id !== gateId);
  const cellCount = new Map<string, number>();
  for (const s of systems) {
    const c = cellOf(s.x, s.y, cols, rows);
    const k = `${c.col}|${c.row}`;
    cellCount.set(k, (cellCount.get(k) ?? 0) + 1);
  }
  const inBusyCell = candidates.filter((s) => {
    const c = cellOf(s.x, s.y, cols, rows);
    return (cellCount.get(`${c.col}|${c.row}`) ?? 0) >= 2;
  });
  return rng.pick(inBusyCell.length > 0 ? inBusyCell : candidates);
}

export function generateSector(runSeed: string, index: number, config: GameConfig): Sector {
  const rng = Rng.fromString(runSeed, `sector:${index}`);
  const { minSystems, maxSystems, gridCols, gridRows } = config.sector;

  const count = rng.int(minSystems, maxSystems);
  const pts = placePositions(rng, count);
  const links = buildLinks(rng, pts);

  const systems: Record<string, StarSystem> = {};
  const systemIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `s${index}-sys${i}`;
    systemIds.push(id);
    systems[id] = {
      id,
      name: systemName(rng),
      x: pts[i].x,
      y: pts[i].y,
      nodes: rollNodes(rng, id),
      links: [],
    };
  }
  for (const edge of links) {
    const [a, b] = edge.split('|').map(Number);
    systems[systemIds[a]].links.push(systemIds[b]);
    systems[systemIds[b]].links.push(systemIds[a]);
  }

  const entrySystemId = systemIds[0];
  const gateSystemId = systemIds[1];

  const ruinSystem = pickRuinSystem(
    rng,
    systemIds.map((id) => systems[id]),
    entrySystemId,
    gateSystemId,
    gridCols,
    gridRows,
  );
  ruinSystem.nodes.push({
    id: `${ruinSystem.id}-ruin`,
    type: 'ruin',
    name: 'Ascended Ruin',
  });

  const waypointCell: GridCell = cellOf(ruinSystem.x, ruinSystem.y, gridCols, gridRows);

  return {
    index,
    name: sectorName(rng),
    systems,
    systemIds,
    entrySystemId,
    gateSystemId,
    ruinSystemId: ruinSystem.id,
    grid: { cols: gridCols, rows: gridRows },
    waypointCell,
  };
}

// Memoized access — sectors are pure functions of (seed, index), cache is safe.
const sectorCache = new Map<string, Sector>();

export function getSector(runSeed: string, index: number, config: GameConfig): Sector {
  const key = `${runSeed}::${index}`;
  let sector = sectorCache.get(key);
  if (!sector) {
    sector = generateSector(runSeed, index, config);
    sectorCache.set(key, sector);
  }
  return sector;
}
