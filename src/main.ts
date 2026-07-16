import configJson from '../data/config.json';
import enemiesJson from '../data/enemies.json';
import eventsJson from '../data/events/core.json';
import foundersJson from '../data/founders.json';
import groundJson from '../data/ground.json';
import introJson from '../data/intro.json';
import namesWakeJson from '../data/names-wake.json';
import shipPlayerJson from '../data/ship-player.json';
import governmentsJson from '../data/species-parts/governments.json';
import morphologiesJson from '../data/species-parts/morphologies.json';
import namesJson from '../data/species-parts/names.json';
import valuesJson from '../data/species-parts/values.json';
import threatBandsJson from '../data/threat-bands.json';
import tutorialCombatJson from '../data/tutorial-combat.json';
import tutorialGroundJson from '../data/tutorial-ground.json';
import weaponsJson from '../data/weapons.json';
import type { EnemyArchetype, PlayerShipDef, WeaponDef } from './combat/types';
import type { GroundConfig } from './ground/types';
import type { FoundersDef, ThreatRewards } from './engine/types';
import type { SpeciesParts } from './species/types';
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
const config: GameConfig = {
  ...baseConfig,
  ...(query.get('hostile') === '1' ? { hostileEncounterChance: 1 } : {}),
  // ?board=1: dev override that opens fights already boardable (§7.3 testing).
  ...(query.get('board') === '1' ? { hostileEncounterChance: 1, debugBoardable: true } : {}),
  // ?contact=1: dev override — every exploration triggers first contact (§8).
  ...(query.get('contact') === '1' ? { debugContact: true } : {}),
};
const events = eventsJson as unknown as EventDef[];
const weapons = weaponsJson as WeaponDef[];
const enemies = enemiesJson as unknown as EnemyArchetype[];
const playerDef = shipPlayerJson as unknown as PlayerShipDef;
const wakeShipNames = (namesWakeJson as { wakeShips: string[] }).wakeShips;
const ground = (groundJson as { config: GroundConfig }).config;
const threatRewards = threatBandsJson as ThreatRewards;
const founders = foundersJson as FoundersDef;
const speciesParts: SpeciesParts = {
  morphologies: (morphologiesJson as { morphologies: SpeciesParts['morphologies'] }).morphologies,
  governments: (governmentsJson as { governments: SpeciesParts['governments'] }).governments,
  values: (valuesJson as { values: SpeciesParts['values'] }).values,
  names: namesJson as SpeciesParts['names'],
};
const deps: Deps = {
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
const introFrames = (introJson as { frames: IntroFrame[] }).frames;
const tutorialCombat = (tutorialCombatJson as { steps: TutorialStep[] }).steps;
const tutorialGround = (tutorialGroundJson as { steps: TutorialStep[] }).steps;

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
    : createRun(freshSeed(), config, buildPlayerShip(playerDef, weapons), founders);

// Dev/testing affordance: ?sensors=N (0..5) sets the ship's current sensor level
// so the §7.4 sensor-accuracy tiers can be exercised before the M5 upgrade shop
// exists. Never fires in normal play (no query param = untouched).
const sensorsOverride = query.get('sensors');
if (sensorsOverride !== null) {
  initial.ship.subsystems.sensors.level = Math.max(0, Math.min(5, Number(sensorsOverride) || 0));
}
// ?ironman=1 dev override for the §6.4 hardcore toggle (settings UI comes later).
if (query.get('ironman') === '1') initial.ironman = true;

const store = new Store(initial, deps);
const app = new App(store, introFrames, tutorialCombat, tutorialGround, () => {
  store.dispatch({ type: 'NEW_RUN', seed: freshSeed() });
});
app.start();
