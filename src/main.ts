import configJson from '../data/config.json';
import eventsJson from '../data/events/core.json';
import introJson from '../data/intro.json';
import { createRun } from './engine/reducer';
import { loadRun } from './engine/save';
import { Store } from './engine/store';
import type { GameConfig } from './engine/types';
import type { EventDef } from './events/types';
import { App, type IntroFrame } from './ui/app';

const config = configJson as GameConfig;
const events = eventsJson as unknown as EventDef[];
const introFrames = (introJson as { frames: IntroFrame[] }).frames;

function freshSeed(): string {
  // Seed selection is the ONE place non-determinism is allowed. ?seed=X pins it.
  const fromQuery = new URLSearchParams(location.search).get('seed');
  if (fromQuery) return fromQuery;
  return `PS-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const saved = loadRun();
const initial =
  saved && saved.phase !== 'dead' && saved.phase !== 'won' ? saved : createRun(freshSeed(), config);

const store = new Store(initial, { events, config });
const app = new App(store, introFrames, () => {
  store.dispatch({ type: 'NEW_RUN', seed: freshSeed() });
});
app.start();
