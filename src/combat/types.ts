/**
 * Ship-combat types (§5, §7.1). Everything here is plain serializable data:
 * the whole CombatState lives inside RunState so save/resume works mid-fight,
 * and combat's RNG cursor travels in the state for exact determinism.
 */

export type WeaponType = 'kinetic' | 'laser' | 'missile' | 'ion';

export interface WeaponDef {
  id: string;
  name: string;
  type: WeaponType;
  /** Hull/subsystem damage on a landed hit. Ion: subsystem damage only. */
  damage: number;
  /** Power bars this weapon draws from the weapons budget to fire. */
  powerCost: number;
  /** Undefined = unlimited (lasers/ion). Kinetics and missiles are limited. */
  ammo?: number;
  /** Shield layers a laser strips per shot. */
  shieldStrip?: number;
  /** Turns of recharge between shots (0 = every turn). */
  cooldown?: number;
  /**
   * Missiles only: how many warheads one shot launches. Each rolls independently
   * against the target's point defense, and each spends one unit of PD capacity —
   * so a salvo bigger than the enemy's PD capacity overwhelms it (some leak through
   * even intact PD). Defaults to 1. Costs one ammo per shot regardless of salvo.
   */
  salvo?: number;
}

export type SubsystemId =
  | 'reactor'
  | 'engines'
  | 'weapons'
  | 'shields'
  | 'sensors'
  | 'pointDefense'
  | 'lifeSupport'
  | 'medbay'
  | 'comms';

/** A shot targets a subsystem to disable it, or the hull for the raw kill. */
export type TargetId = SubsystemId | 'hull';

export const SUBSYSTEM_IDS: SubsystemId[] = [
  'reactor',
  'engines',
  'weapons',
  'shields',
  'sensors',
  'pointDefense',
  'lifeSupport',
  'medbay',
  'comms',
];

/** Subsystems a shot can meaningfully target in M2 combat. */
export const TARGETABLE: TargetId[] = ['hull', 'weapons', 'engines', 'shields', 'pointDefense'];

export interface Subsystem {
  level: number;
  /** Accumulated damage; effective level = max(0, level - damage). */
  damage: number;
}

export interface WeaponSlot {
  defId: string;
  ammo: number; // mirrors def.ammo; -1 = unlimited
  cooldownLeft: number;
}

export interface PowerAllocation {
  engines: number;
  weapons: number;
  shields: number;
}

export interface CombatShip {
  name: string;
  hull: number;
  hullMax: number;
  subsystems: Record<SubsystemId, Subsystem>;
  weapons: WeaponSlot[];
  /** Base point-defense intercept chance vs missiles (0..1). */
  pdChance: number;
  shieldLayers: number;
  power: PowerAllocation;
  fleeCharge: number;
}

export type CombatOutcome = 'ongoing' | 'won' | 'lost' | 'fled' | 'surrendered' | 'bribed';

/** Readable enemy difficulty (§7.4). UNKNOWN when sensors can't get a read. */
export type ThreatBand = 'GREEN' | 'SEASONED' | 'VETERAN' | 'ELITE' | 'UNKNOWN';

/** Per-weapon firing decision for a volley — drives both resolution and the UI. */
export type FireStatus = 'fire' | 'hold' | 'underpowered' | 'cooldown' | 'no-ammo' | 'offline';

/** Where the fight came from — decides how results are applied to the run. */
export type CombatOrigin = 'wake-space' | 'hostile-event';

export interface CombatState {
  player: CombatShip;
  enemy: CombatShip;
  enemyArchetypeId: string;
  /** Readable threat band shown in combat (§7.4). */
  enemyThreat: ThreatBand;
  doctrine: EnemyDoctrine;
  turn: number;
  log: string[];
  /** Serialized combat RNG cursor — save/resume continues the exact fight. */
  rngState: number;
  outcome: CombatOutcome;
  fleeThreshold: number;
  salvageScrap: number;
  salvageFuel: number;
  acceptsSurrender: boolean;
  acceptsBribe: boolean;
  bribeCost: number;
  surrenderScrapCost: number;
  origin: CombatOrigin;
}

export type EnemyDoctrine = 'aggressive' | 'bombard' | 'grind';

export interface EnemyArchetype {
  id: string;
  name: string;
  /** Short hull-class label, appended to Wake ship names (e.g. "Skirmisher"). */
  className: string;
  threat: ThreatBand;
  hullMax: number;
  subsystems: Record<SubsystemId, number>;
  pdChance: number;
  weapons: string[]; // weapon def ids
  doctrine: EnemyDoctrine;
  salvageScrap: number;
  salvageFuel: number;
  acceptsSurrender: boolean;
  acceptsBribe: boolean;
}

export interface PlayerShipDef {
  id: string;
  name: string;
  hullMax: number;
  subsystems: Record<SubsystemId, number>;
  pdChance: number;
  weapons: string[];
}

export interface CombatConfig {
  evasionPerEnginePower: number;
  maxEvasion: number;
  shieldRegenPerTurn: number;
  ionRegenPerTurn: number;
  fleeThreshold: number;
  fastApproachFleeHeadstart: number;
  /** Fraction of a subsystem-targeted shot's damage that also hits hull. */
  subsystemHullFactor: number;
  bribeCost: number;
  surrenderScrapCost: number;
}

/** A player combat decision (one per turn — one save point). */
export type CombatAction =
  | { type: 'FIRE'; power: PowerAllocation; targets: (TargetId | null)[] }
  | { type: 'FLEE'; power: PowerAllocation }
  | { type: 'SURRENDER' }
  | { type: 'BRIBE' };
