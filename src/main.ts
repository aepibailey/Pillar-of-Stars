import configJson from '../data/config.json';
import enemiesJson from '../data/enemies.json';
import eventsJson from '../data/events/core.json';
import introJson from '../data/intro.json';
import namesWakeJson from '../data/names-wake.json';
import shipPlayerJson from '../data/ship-player.json';
import tutorialCombatJson from '../data/tutorial-combat.json';
import weaponsJson from '../data/weapons.json';
import type { EnemyArchetype, PlayerShipDef, WeaponDef } from './combat/types';
import { buildPlayerShip, createRun, type Deps } from './engine/reducer';
import { loadRun } from './engine/save';
import { Store } from './engine/store';
import type { GameConfig } from './engine/types';
import type { EventDef } from './events/types';
import { App, type IntroFrame, type TutorialStep } from './ui/app';

const query = new URLSearchParams(location.search);
const baseConfig = configJson as GameConfig;
// Dev/testing affordance (alongside ?seed=): ?hostile=1 makes every survey a
// ship fight, for exercising combat on demand. Never affects normal play.
const config: GameConfig =
  query.get('hostile') === '1' ? { ...baseConfig, hostileEncounterChance: 1 } : baseConfig;
const events = eventsJson as unknown as EventDef[];
const weapons = weaponsJson as WeaponDef[];
const enemies = enemiesJson as unknown as EnemyArchetype[];
const playerDef = shipPlayerJson as unknown as PlayerShipDef;
const wakeShipNames = (namesWakeJson as { wakeShips: string[] }).wakeShips;
const deps: Deps = { events, config, weapons, enemies, playerDef, wakeShipNames };
const introFrames = (introJson as { frames: IntroFrame[] }).frames;
const tutorialCombat = (tutorialCombatJson as { steps: TutorialStep[] }).steps;

function freshSeed(): string {
  // Seed selection is the ONE place non-determinism is allowed. ?seed=X pins it.
  const fromQuery = new URLSearchParams(location.search).get('seed');
  if (fromQuery) return fromQuery;
  return `PS-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const saved = loadRun();
const initial =
  saved && saved.phase !== 'dead' && saved.phase !== 'won'
    ? saved
    : createRun(freshSeed(), config, buildPlayerShip(playerDef, weapons));

const store = new Store(initial, deps);
const app = new App(store, introFrames, tutorialCombat, () => {
  store.dispatch({ type: 'NEW_RUN', seed: freshSeed() });
});
app.start();
