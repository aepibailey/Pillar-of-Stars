/** Shared combat data + helpers so every suite builds a full Deps + ship. */
import configJson from '../data/config.json';
import enemiesJson from '../data/enemies.json';
import eventsJson from '../data/events/core.json';
import shipPlayerJson from '../data/ship-player.json';
import weaponsJson from '../data/weapons.json';
import wakeNamesJson from '../data/names-wake.json';
import groundJson from '../data/ground.json';
import { buildPlayerShip, createRun, type Deps } from '../src/engine/reducer';
import type { GameConfig, RunState, ShipState } from '../src/engine/types';
import type { EnemyArchetype, PlayerShipDef, WeaponDef } from '../src/combat/types';
import type { GroundConfig } from '../src/ground/types';
import type { EventDef } from '../src/events/types';

export const config = configJson as GameConfig;
export const events = eventsJson as unknown as EventDef[];
export const weapons = weaponsJson as WeaponDef[];
export const enemies = enemiesJson as unknown as EnemyArchetype[];
export const playerDef = shipPlayerJson as unknown as PlayerShipDef;
export const wakeShipNames = (wakeNamesJson as { wakeShips: string[] }).wakeShips;
export const ground = (groundJson as { config: GroundConfig }).config;

export const deps: Deps = { events, config, weapons, enemies, playerDef, wakeShipNames, ground };

export function makeDeps(overrides: Partial<Deps> = {}): Deps {
  return { ...deps, ...overrides };
}

export function newShip(): ShipState {
  return buildPlayerShip(playerDef, weapons);
}

export function newRun(seed: string, cfg: GameConfig = config): RunState {
  return createRun(seed, cfg, buildPlayerShip(playerDef, weapons));
}
