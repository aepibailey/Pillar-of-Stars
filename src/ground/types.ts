/**
 * Personal combat (§7.2) — "Boots and Blasters". Zone-based blaster shootouts,
 * captain-solo for M3 (a `side: 'crew'` array leaves the seam for the companion
 * slot §6.3 and, later, boarding-repel with the full crew). Everything here is
 * plain serializable data: GroundState rides inside RunState so save/resume works
 * mid-firefight, and its RNG cursor travels with it for exact determinism —
 * exactly like ship combat (§7.1).
 *
 * Resolution is SIMULTANEOUS, mirroring ship combat: both sides commit from the
 * turn-start state, then everything resolves together.
 */

import type { ThreatBand, WeaponType } from '../combat/types';

/** Static zone definition from data (a cargo bay corner, a bulkhead, a console). */
export interface ZoneDef {
  id: string;
  name: string;
  /** Cover rating — how much incoming accuracy it denies while it holds. */
  cover: number;
}

/** A live cover position: its rating plus the integrity remaining this fight. */
export interface Zone extends ZoneDef {
  /** Remaining cover integrity; each shot it absorbs chips it, 0 = blown open. */
  coverHp: number;
  coverHpMax: number;
}

export type Side = 'crew' | 'foe';
export type Down = null | 'killed' | 'subdued' | 'yielded';

export interface Fighter {
  id: string;
  name: string;
  side: Side;
  hp: number;
  hpMax: number;
  /** Accumulated stun; at stunMax the fighter is subdued (non-lethal down). */
  stun: number;
  stunMax: number;
  /** Blaster heat; a shot that would exceed heatMax is refused until vented. */
  heat: number;
  heatMax: number;
  zoneId: string;
  /** Base hit skill (0..1) before shot type, cover, and suppression. */
  accuracy: number;
  /** Damage a landed shot deals (to hp when lethal, to stun when non-lethal). */
  damage: number;
  down: Down;
  /** Suppressed this turn → accuracy penalty (cleared each upkeep). */
  suppressed: boolean;
}

export type GroundOutcome =
  | 'ongoing'
  | 'neutralized' // all foes killed — full salvage, but a massacre (§7.3)
  | 'subdued' // all foes stunned down — prisoners/cargo (§7.3)
  | 'allied' // parley accepted — escort/intel/defector (§7.3)
  | 'captain-down' // the captain fell — run over (succession is M4)
  | 'withdrawn'; // pulled back to the ship, boarding abandoned

/** How the captain's blaster is set — decides lethal vs. non-lethal (§7.2). */
export type FireMode = 'lethal' | 'stun';

export interface GroundState {
  zones: Zone[];
  fighters: Fighter[];
  turn: number;
  log: string[];
  rngState: number;
  outcome: GroundOutcome;
  /** True enemy threat band (drives foe strength + the parley odds). */
  threat: ThreatBand;
  /** Whether the Ally/parley path is on the table (§7.3). */
  allyOffered: boolean;
  /** Stable seed for any sensor reads on this scene. */
  readSeed: string;
  encounterName: string;
  /** Where this came from — decides how results apply to the run. */
  origin: 'boarding';
  /** The captain's consumables for this scene (minimal M3 kit). */
  items: { id: string; count: number }[];
  /**
   * Loot context carried from the disabled ship (§7.3). `scrap` is its cargo;
   * `ammoType` is the boarded ship's ammo-consuming weapon type, so an ammo
   * reward tops up the player's matching weapon. Fuel/intel/ammo QUANTITIES are
   * band-scaled at payout time (see threat-bands.json).
   */
  reward: { scrap: number; ammoType: WeaponType | null };
}

/** A player decision for one personal-combat turn (one save point). */
export type GroundAction =
  | { type: 'GSHOOT'; targetId: string; shot: 'aimed' | 'snap'; mode: FireMode }
  | { type: 'GMOVE'; zoneId: string }
  | { type: 'GTAKE_COVER' }
  | { type: 'GSUPPRESS'; targetId: string }
  | { type: 'GVENT' }
  | { type: 'GITEM'; itemId: string; targetId?: string }
  | { type: 'GPARLEY' }
  | { type: 'GWITHDRAW' };

export interface GroundItemDef {
  id: string;
  name: string;
  kind: 'heal' | 'stun-blast';
  amount: number;
}

export interface GroundConfig {
  heatMax: number;
  coolRate: number;
  aimedHeat: number;
  snapHeat: number;
  aimedAcc: number;
  snapAcc: number;
  /** Accuracy an attacker loses per remaining cover level of the target's zone. */
  coverPerLevel: number;
  /** Accuracy a suppressed fighter loses next turn. */
  suppressPenalty: number;
  captainHp: number;
  captainAccuracy: number;
  captainLethalDamage: number;
  captainStunDamage: number;
  /** Parley base success by band index (GREEN..ELITE); scaled by how hurt they are. */
  parleyBaseByBand: number[];
  foeByBand: Record<string, { hp: number; acc: number; dmg: number; stunMax: number }>;
  /** The §6.3 companion's combat template (skills refine this later). HP is at
   * parity with the captain (R2); coverSeekHpFraction is the hurt threshold
   * below which the companion dives for cover, mirroring the foe doctrine. */
  companion: { hp: number; acc: number; dmg: number; stunMax: number; coverSeekHpFraction: number };
  zones: ZoneDef[];
  items: GroundItemDef[];
}
