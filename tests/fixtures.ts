/** Shared combat data + helpers so every suite builds a full Deps + ship. */
import configJson from '../data/config.json';
import enemiesJson from '../data/enemies.json';
import eventsJson from '../data/events/core.json';
import shipPlayerJson from '../data/ship-player.json';
import weaponsJson from '../data/weapons.json';
import wakeNamesJson from '../data/names-wake.json';
import groundJson from '../data/ground.json';
import threatBandsJson from '../data/threat-bands.json';
import foundersJson from '../data/founders.json';
import morphologiesJson from '../data/species-parts/morphologies.json';
import governmentsJson from '../data/species-parts/governments.json';
import valuesJson from '../data/species-parts/values.json';
import namesJson from '../data/species-parts/names.json';
import { buildPlayerShip, createRun, type Deps } from '../src/engine/reducer';
import type {
  FoundersDef,
  GameConfig,
  RunState,
  ShipState,
  ThreatRewards,
} from '../src/engine/types';
import type { EnemyArchetype, PlayerShipDef, WeaponDef } from '../src/combat/types';
import type { GroundConfig } from '../src/ground/types';
import type { SpeciesParts } from '../src/species/types';
import type { EventDef } from '../src/events/types';

export const config = configJson as GameConfig;
export const events = eventsJson as unknown as EventDef[];
export const weapons = weaponsJson as WeaponDef[];
export const enemies = enemiesJson as unknown as EnemyArchetype[];
export const playerDef = shipPlayerJson as unknown as PlayerShipDef;
export const wakeShipNames = (wakeNamesJson as { wakeShips: string[] }).wakeShips;
export const ground = (groundJson as { config: GroundConfig }).config;
export const threatRewards = threatBandsJson as ThreatRewards;
export const founders = foundersJson as FoundersDef;
export const speciesParts: SpeciesParts = {
  morphologies: (morphologiesJson as { morphologies: SpeciesParts['morphologies'] }).morphologies,
  governments: (governmentsJson as { governments: SpeciesParts['governments'] }).governments,
  values: (valuesJson as { values: SpeciesParts['values'] }).values,
  names: namesJson as SpeciesParts['names'],
};

export const deps: Deps = {
  events,
  config,
  weapons,
  enemies,
  playerDef,
  wakeShipNames,
  ground,
  threatRewards,
  founders,
  speciesParts,
};

export function makeDeps(overrides: Partial<Deps> = {}): Deps {
  return { ...deps, ...overrides };
}

export function newShip(): ShipState {
  return buildPlayerShip(playerDef, weapons);
}

export function newRun(seed: string, cfg: GameConfig = config): RunState {
  return createRun(seed, cfg, buildPlayerShip(playerDef, weapons), founders);
}
