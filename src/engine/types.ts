/**
 * RunState — the single serializable source of truth for a journey.
 *
 * ARCHITECTURE GUARDRAIL (§6.4): the run and the captain are different things.
 * Run identity is `runId`; the captain is just a Character the run currently
 * *references* via `captainId`. Succession (M4) will swap `captainId` to a
 * surviving crew member without touching run identity, economy, flags, or
 * galaxy state. Nothing in this schema may assume captain === run.
 */

import type { CombatConfig, CombatShip, CombatState, SubsystemId } from '../combat/types';
import type { GroundState } from '../ground/types';

export type Phase = 'intro' | 'map' | 'event' | 'combat' | 'ground' | 'dead' | 'won';

/**
 * 'wake'      — the front caught the player.
 * 'adrift'    — stranded and waited out all rescue days.
 * 'robbed'    — killed by scavengers while stranded.
 * 'destroyed' — hull reached zero in ship combat (M2).
 * ('adrift'/'destroyed' lose the ship entirely, so §6.4 succession can't apply.)
 */
export type DeathCause = 'wake' | 'adrift' | 'robbed' | 'destroyed' | 'boarding';

export interface Character {
  id: string;
  name: string;
  role: 'captain' | 'crew';
}

/** How the player enters Wake-held space (patch §6). */
export type WakeApproach = 'casual' | 'fast' | 'sneak';

/**
 * The player's persistent ship (M2, §5). It IS a CombatShip — combat clones it
 * and resets the transient fields (power/shields/flee), then writes hull,
 * subsystem damage, and weapon ammo back when the fight ends. Storing one shape
 * avoids a translation layer between "run ship" and "combat ship".
 */
export type ShipState = CombatShip;

export interface ActiveEvent {
  defId: string;
  stage: 'options' | 'outcome';
  /** Node that triggered it, or null for auto-fired events (the run opener). */
  nodeId: string | null;
  outcomeText?: string;
  /** Archetype id (or 'random') to launch combat with when the outcome is acked. */
  pendingCombat?: string;
}

export interface WakeState {
  /** System ids consumed by the Wake in the current sector. */
  consumedIds: string[];
  /**
   * Remaining grace before the Wake starts consuming, in HUNDREDTHS of a jump.
   * Integer math keeps fractional advances (0.2/exploration) exactly
   * deterministic — no float drift.
   */
  graceHundredths: number;
  /** Accumulated advance toward the next consumption, in hundredths of a jump. */
  progressHundredths: number;
}

export interface RunStats {
  jumps: number;
  eventsResolved: number;
  /** Ship fights entered — also the deterministic encounter id for combat seeding. */
  combats: number;
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

  ship: ShipState;

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
  /** Active ship fight, or null. Its own RNG cursor rides inside it (§7.1). */
  combat: CombatState | null;
  /** Active boarding / personal-combat scene, or null (§7.2/7.3). */
  ground: GroundState | null;
  /** Days waited in the CURRENT stranding (resets when the stranding ends). */
  strandedDays: number;
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
  /** Fuel per intra-system exploration (one node survey = one intra-system jump). */
  exploreFuelCost: number;
  /**
   * Entering Wake-held space (patch §6). fuelCost is the TOTAL jump cost
   * (casual = the normal jump price). fightChance is the base probability of
   * contact; sneak's drops by sensorReductionPerLevel × ship sensor level.
   */
  wakeSpace: {
    casual: { fuelCost: number; fightChance: number };
    fast: { fuelCost: number; fightChance: number };
    sneak: { fuelCost: number; fightChance: number; sensorReductionPerLevel: number };
  };
  wakeGraceJumps: number;
  /** Wake advance per inter-system jump, in jumps (normally 1). */
  wakeAdvancePerJump: number;
  /** Wake advance per intra-system exploration, in jumps (playtest patch 2: 0.1). */
  wakeAdvancePerExplore: number;
  /** 1-based sector whose arrival wins the M1 build. */
  winSector: number;
  /** Out-of-fuel stranding: the Wait-1-Day mechanic. One roll per day. */
  stranding: {
    maxWaitDays: number;
    towChance: number;
    robberyChance: number;
    /** The Wake advances every N days waited... */
    wakeAdvanceEveryDays: number;
    /** ...by this many jumps. */
    wakeAdvanceJumps: number;
  };
  sector: {
    minSystems: number;
    maxSystems: number;
    gridCols: number;
    gridRows: number;
    /** Decoy ruins beyond the waypoint's signal ruin (patch §5). */
    extraRuinsMin: number;
    extraRuinsMax: number;
  };
  combat: CombatConfig;
  /** Scrap-for-repair rates (§5 "repairs cost scrap"). */
  repair: {
    hullPerScrap: number;
    subsystemDamagePerScrap: number;
  };
  /** Per-exploration chance of a hostile-ship encounter that launches combat. */
  hostileEncounterChance: number;
}

export type { SubsystemId };
