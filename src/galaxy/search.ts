import type { Sector } from './types';

/**
 * Nearest system (by jump-lane BFS) containing a station node — where a tow
 * takes a stranded ship. Includes the start system (you may already be at the
 * port). Deterministic: BFS order follows the generated links arrays.
 * Returns null if the sector rolled no stations at all.
 */
export function nearestStationSystemId(sector: Sector, fromId: string): string | null {
  const seen = new Set<string>([fromId]);
  const queue = [fromId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const system = sector.systems[id];
    if (system.nodes.some((n) => n.type === 'station')) return id;
    for (const next of system.links) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return null;
}
