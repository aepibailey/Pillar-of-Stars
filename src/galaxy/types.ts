export type NodeType = 'planet' | 'station' | 'derelict' | 'anomaly' | 'ruin';

export interface SystemNode {
  id: string;
  type: NodeType;
  name: string;
}

export interface StarSystem {
  id: string;
  name: string;
  /** Normalized position in sector space: x,y ∈ [0,1]. y=1 is the trailing (entry) edge, y=0 is coreward (gate). */
  x: number;
  y: number;
  nodes: SystemNode[];
  /** Ids of systems reachable by jump lane. Symmetric. */
  links: string[];
}

export interface GridCell {
  col: number;
  row: number;
}

/**
 * A generated sector. Pure derived data — regenerated deterministically from
 * (runSeed, index); never stored in the save file.
 */
export interface Sector {
  index: number;
  name: string;
  systems: Record<string, StarSystem>;
  /** Stable generation order, for deterministic iteration. */
  systemIds: string[];
  entrySystemId: string;
  gateSystemId: string;
  /** The system containing this sector's SIGNAL ruin — the waypoint target that decodes the map. */
  ruinSystemId: string;
  /** Systems holding decoy ruins (lootable, dangerous, never decode the map). */
  extraRuinSystemIds: string[];
  grid: { cols: number; rows: number };
  /** Rough waypoint (§4/§9.3): the CELL the ruin lies in — an area, never a pin. */
  waypointCell: GridCell;
}
