/**
 * Crew slot rules (§6, §6.3). Max crew 4 — every berth is precious. Exactly one
 * companion accompanies the captain off-ship; the slot starts pre-filled by the
 * spouse (v0.7) and reopens if its holder dies or takes the captaincy.
 */

import type { Character, RunState } from '../engine/types';

export const MAX_CREW = 4;

export function aliveCharacters(state: RunState): Character[] {
  return state.characters.filter((c) => c.alive);
}

/** A berth is free when the living roster is under the §6 cap. */
export function canRecruit(state: RunState): boolean {
  return aliveCharacters(state).length < MAX_CREW;
}

/**
 * Add a recruit to the roster (mutates the draft state, reducer-style).
 * Returns false — and changes nothing — when every berth is taken.
 */
export function addRecruit(state: RunState, recruit: Character): boolean {
  if (!canRecruit(state)) return false;
  state.characters.push(recruit);
  return true;
}

/**
 * Assign the §6.3 companion slot. Only a living, non-captain crew member can
 * hold it; null clears it. Returns false on an invalid assignment.
 */
export function setCompanion(state: RunState, characterId: string | null): boolean {
  if (characterId === null) {
    state.companionId = null;
    return true;
  }
  const ch = state.characters.find((c) => c.id === characterId);
  if (!ch || !ch.alive || ch.id === state.captainId) return false;
  state.companionId = characterId;
  return true;
}
