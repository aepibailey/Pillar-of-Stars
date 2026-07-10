/**
 * RunState — the single serializable source of truth for a journey.
 *
 * ARCHITECTURE GUARDRAIL (§6.4): the run and the captain are different things.
 * Run identity is `runId`; the captain is just a Character the run currently
 * *references* via `captainId`. Succession (M4) will swap `captainId` to a
 * surviving crew member without touching run identity, economy, flags, or
 * galaxy state. Nothing in this schema may assume captain === run.
 */

export type Phase = 'intro' | 'map' | 'event' | 'dead' | 'won';

export type DeathCause = 'fuel' | 'wake' | 'stranded';

export interface Character {
  id: string;
  name: string;
  role: 'captain' | 'crew';
}

export interface ActiveEvent {
  defId: string;
  stage: 'options' | 'outcome';
  /** Node that triggered it, or null for auto-fired events (the run opener). */
  nodeId: string | null;
  outcomeText?: string;
}

export interface WakeState {
  /** System ids consumed by the Wake in the current sector. */
  consumedIds: string[];
  /** Player jumps remaining before the Wake starts consuming the trail. */
  graceRemaining: number;
}

export interface RunStats {
  jumps: number;
  eventsResolved: number;
}

export interface RunState {
  schemaVersion: number;
  /** Identity of the JOURNEY. Survives captain death (§6.4). */
  runId: string;
  seed: string;
  phase: Phase;
  deathCause?: DeathCause;

  /** Everyone aboard. M1: just the starting captain. */
  characters: Character[];
  /** Reference only — reassignable on succession (M4). */
  captainId: string;

  sectorIndex: number; // 0-based; displayed 1-based
  currentSystemId: string;
  /** First-visit order within the current sector — the trail the Wake hunts along. */
  visitOrder: string[];
  exploredNodeIds: string[];
  /** Sectors whose map leg has been decoded (ruin found) — unlocks that sector's gate. */
  decodedSectorIndexes: number[];
  flags: Record<string, boolean>;

  // Run-scoped economy (never captain-scoped).
  fuel: number;
  scrap: number;

  wake: WakeState;
  activeEvent: ActiveEvent | null;
  stats: RunStats;

  /** Serialized PRNG streams so save/resume continues exact sequences. */
  rngState: {
    events: number;
  };
}

export interface GameConfig {
  startFuel: number;
  startScrap: number;
  jumpFuelCost: number;
  /** Extra fuel to enter a Wake-consumed system (desperate transit, §4). */
  consumedExtraFuelCost: number;
  wakeGraceJumps: number;
  wakeConsumesPerJump: number;
  /** 1-based sector whose arrival wins the M1 build. */
  winSector: number;
  sector: {
    minSystems: number;
    maxSystems: number;
    gridCols: number;
    gridRows: number;
  };
}
