import type { GridCell, Sector, StarSystem } from './types';

/** Which grid cell a normalized point falls in. */
export function cellOf(x: number, y: number, cols: number, rows: number): GridCell {
  return {
    col: Math.min(cols - 1, Math.max(0, Math.floor(x * cols))),
    row: Math.min(rows - 1, Math.max(0, Math.floor(y * rows))),
  };
}

export function sameCell(a: GridCell, b: GridCell): boolean {
  return a.col === b.col && a.row === b.row;
}

/** All systems inside a waypoint cell — the search area the player must comb. */
export function systemsInCell(sector: Sector, cell: GridCell): StarSystem[] {
  return sector.systemIds
    .map((id) => sector.systems[id])
    .filter((s) => sameCell(cellOf(s.x, s.y, sector.grid.cols, sector.grid.rows), cell));
}
