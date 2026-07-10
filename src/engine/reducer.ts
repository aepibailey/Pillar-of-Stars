/**
 * Pure state transitions. Every change to a run flows through reduce():
 * (state, action, deps) → new state. No I/O, no Math.random, no Date — the
 * only randomness is the serialized event stream in state.rngState. This is
 * what makes save/resume-at-every-decision-point and deterministic tests
 * possible (§13).
 */

import { findFixedEvent, getEvent, pickNodeEvent, pickOutcome } from '../events/engine';
import type { EventDef, EventEffects } from '../events/types';
import { getSector } from '../galaxy/generate';
import type { Sector } from '../galaxy/types';
import { advanceWake, createWakeState, isConsumed } from '../threat/wake';
import { deriveSeed, Rng } from './rng';
import type { Character, GameConfig, RunState } from './types';

export const SCHEMA_VERSION = 1;

export type Action =
  | { type: 'NEW_RUN'; seed: string }
  | { type: 'FINISH_INTRO' } // watched or skipped — same transition
  | { type: 'JUMP'; toSystemId: string }
  | { type: 'EXPLORE'; nodeId: string }
  | { type: 'RESOLVE_OPTION'; optionIndex: number }
  | { type: 'ACK_OUTCOME' }
  | { type: 'ENTER_GATE' };

export interface Deps {
  events: readonly EventDef[];
  config: GameConfig;
}

export function createRun(seed: string, config: GameConfig): RunState {
  const sector = getSector(seed, 0, config);
  const captain: Character = { id: 'char-0', name: 'The Survivor', role: 'captain' };
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: `run-${deriveSeed(seed, 'run-id').toString(36)}`,
    seed,
    phase: 'intro',
    characters: [captain],
    captainId: captain.id,
    sectorIndex: 0,
    currentSystemId: sector.entrySystemId,
    visitOrder: [sector.entrySystemId],
    exploredNodeIds: [],
    decodedSectorIndexes: [],
    flags: {},
    fuel: config.startFuel,
    scrap: config.startScrap,
    wake: createWakeState(config.wakeGraceJumps),
    activeEvent: null,
    stats: { jumps: 0, eventsResolved: 0 },
    rngState: { events: deriveSeed(seed, 'events') },
  };
}

export function currentSector(state: RunState, config: GameConfig): Sector {
  return getSector(state.seed, state.sectorIndex, config);
}

/** Fuel cost to jump to an adjacent system, or null if not adjacent. */
export function jumpCost(state: RunState, toSystemId: string, config: GameConfig): number | null {
  const sector = currentSector(state, config);
  const from = sector.systems[state.currentSystemId];
  if (!from || !from.links.includes(toSystemId)) return null;
  const extra = isConsumed(state.wake, toSystemId) ? config.consumedExtraFuelCost : 0;
  return config.jumpFuelCost + extra;
}

function applyEffects(state: RunState, effects: EventEffects | undefined): void {
  if (!effects) return;
  if (effects.fuel) state.fuel = Math.max(0, state.fuel + effects.fuel);
  if (effects.scrap) state.scrap = Math.max(0, state.scrap + effects.scrap);
  if (effects.flags) for (const f of effects.flags) state.flags[f] = true;
  if (effects.decodeSector && !state.decodedSectorIndexes.includes(state.sectorIndex)) {
    state.decodedSectorIndexes.push(state.sectorIndex);
  }
}

/**
 * Death by attrition: dead when there is nothing left to do — no affordable
 * jump, no unexplored node in the current system, and no unlocked gate here.
 * (Fuel 0 alone isn't instant death: scavenging the last nodes for fuel is
 * exactly the desperate beat we want.)
 */
function checkStranded(state: RunState, config: GameConfig): void {
  if (state.phase !== 'map') return;
  const sector = currentSector(state, config);
  const here = sector.systems[state.currentSystemId];
  const canExplore = here.nodes.some((n) => !state.exploredNodeIds.includes(n.id));
  if (canExplore) return;
  const canJump = here.links.some((id) => {
    const cost = jumpCost(state, id, config);
    return cost !== null && state.fuel >= cost;
  });
  if (canJump) return;
  const atOpenGate =
    state.currentSystemId === sector.gateSystemId &&
    state.decodedSectorIndexes.includes(state.sectorIndex);
  if (atOpenGate) return;
  state.phase = 'dead';
  state.deathCause = state.fuel <= 0 ? 'fuel' : 'stranded';
}

function fireEvent(state: RunState, def: EventDef, nodeId: string | null): void {
  state.activeEvent = { defId: def.id, stage: 'options', nodeId: nodeId ?? null };
  state.phase = 'event';
}

export function reduce(state: RunState, action: Action, deps: Deps): RunState {
  const { events, config } = deps;

  if (action.type === 'NEW_RUN') {
    return createRun(action.seed, config);
  }

  const next: RunState = structuredClone(state);

  switch (action.type) {
    case 'FINISH_INTRO': {
      if (next.phase !== 'intro') return state;
      // The fixed run-opener (§9.3): the opening ruin excavation. Data-flagged,
      // never hardcoded by id.
      fireEvent(next, findFixedEvent(events, 'run-opener'), null);
      return next;
    }

    case 'JUMP': {
      if (next.phase !== 'map') return state;
      const cost = jumpCost(next, action.toSystemId, config);
      if (cost === null || next.fuel < cost) return state;

      next.fuel -= cost;
      next.currentSystemId = action.toSystemId;
      next.stats.jumps++;
      if (!next.visitOrder.includes(action.toSystemId)) {
        next.visitOrder.push(action.toSystemId);
      }

      const result = advanceWake(
        next.wake,
        next.visitOrder,
        next.currentSystemId,
        config.wakeConsumesPerJump,
      );
      next.wake = result.wake;
      if (result.caught) {
        next.phase = 'dead';
        next.deathCause = 'wake';
        return next;
      }
      checkStranded(next, config);
      return next;
    }

    case 'EXPLORE': {
      if (next.phase !== 'map') return state;
      const sector = currentSector(next, config);
      const here = sector.systems[next.currentSystemId];
      const node = here.nodes.find((n) => n.id === action.nodeId);
      if (!node || next.exploredNodeIds.includes(node.id)) return state;

      next.exploredNodeIds.push(node.id);

      if (node.type === 'ruin' && here.id === sector.ruinSystemId) {
        fireEvent(next, findFixedEvent(events, 'sector-ruin'), node.id);
        return next;
      }

      const rng = new Rng(next.rngState.events);
      const def = pickNodeEvent(events, node.type, rng);
      next.rngState.events = rng.getState();
      if (!def) {
        // No event authored for this node type — quiet survey, nothing found.
        checkStranded(next, config);
        return next;
      }
      fireEvent(next, def, node.id);
      return next;
    }

    case 'RESOLVE_OPTION': {
      if (next.phase !== 'event' || !next.activeEvent || next.activeEvent.stage !== 'options') {
        return state;
      }
      const def = getEvent(events, next.activeEvent.defId);
      const option = def.options[action.optionIndex];
      if (!option) return state;

      const rng = new Rng(next.rngState.events);
      const outcome = pickOutcome(option.outcomes, rng);
      next.rngState.events = rng.getState();

      applyEffects(next, outcome.effects);
      next.activeEvent = { ...next.activeEvent, stage: 'outcome', outcomeText: outcome.text };
      next.stats.eventsResolved++;
      return next;
    }

    case 'ACK_OUTCOME': {
      if (next.phase !== 'event' || !next.activeEvent || next.activeEvent.stage !== 'outcome') {
        return state;
      }
      next.activeEvent = null;
      next.phase = 'map';
      checkStranded(next, config);
      return next;
    }

    case 'ENTER_GATE': {
      if (next.phase !== 'map') return state;
      const sector = currentSector(next, config);
      if (next.currentSystemId !== sector.gateSystemId) return state;
      if (!next.decodedSectorIndexes.includes(next.sectorIndex)) return state;

      next.sectorIndex++;

      // Win = reaching sector `winSector` (1-based) — M1's finish line (§14).
      if (next.sectorIndex + 1 >= config.winSector) {
        next.phase = 'won';
        return next;
      }

      const newSector = getSector(next.seed, next.sectorIndex, config);
      next.currentSystemId = newSector.entrySystemId;
      next.visitOrder = [newSector.entrySystemId];
      next.wake = createWakeState(config.wakeGraceJumps);
      return next;
    }
  }
}
