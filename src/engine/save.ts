/**
 * Save/resume (§13 non-negotiable): the entire RunState is one JSON blob,
 * auto-saved after every reducer transition. Sectors are NOT stored — they
 * regenerate deterministically from the seed. Schema is versioned so future
 * milestones can migrate instead of corrupting.
 */

import { SCHEMA_VERSION } from './reducer';
import type { RunState } from './types';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SAVE_KEY = 'pillar-of-stars.run';

function defaultStorage(): KeyValueStorage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export function saveRun(state: RunState, storage: KeyValueStorage | null = defaultStorage()): void {
  storage?.setItem(SAVE_KEY, JSON.stringify(state));
}

export function loadRun(storage: KeyValueStorage | null = defaultStorage()): RunState | null {
  const raw = storage?.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RunState;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null; // future: migrate
    return parsed;
  } catch {
    return null;
  }
}

export function clearRun(storage: KeyValueStorage | null = defaultStorage()): void {
  storage?.removeItem(SAVE_KEY);
}
