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
import { nearestStationSystemId } from '../galaxy/search';
import type { Sector } from '../galaxy/types';
import { advanceWake, createWakeState, isConsumed } from '../threat/wake';
import { deriveSeed, Rng } from './rng';
import type { Character, GameConfig, RunState, WakeApproach } from './types';

// v3: strandedDays + the Wait-1-Day mechanic (was v2: fractional fuel/Wake).
export const SCHEMA_VERSION = 3;

export type Action =
  | { type: 'NEW_RUN'; seed: string }
  | { type: 'FINISH_INTRO' } // watched or skipped — same transition
  | { type: 'JUMP'; toSystemId: string; approach?: WakeApproach }
  | { type: 'EXPLORE'; nodeId: string }
  | { type: 'RESOLVE_OPTION'; optionIndex: number }
  | { type: 'ACK_OUTCOME' }
  | { type: 'ENTER_GATE' }
  | { type: 'WAIT_DAY' };

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
    ship: { sensors: 0 },
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
    strandedDays: 0,
    stats: { jumps: 0, eventsResolved: 0 },
    rngState: { events: deriveSeed(seed, 'events') },
  };
}

export function currentSector(state: RunState, config: GameConfig): Sector {
  return getSector(state.seed, state.sectorIndex, config);
}

/**
 * Fuel cost to jump to an adjacent system, or null if not adjacent.
 * Wake-held destinations price by approach (TOTAL cost, casual = normal).
 */
export function jumpCost(
  state: RunState,
  toSystemId: string,
  config: GameConfig,
  approach: WakeApproach = 'casual',
): number | null {
  const sector = currentSector(state, config);
  const from = sector.systems[state.currentSystemId];
  if (!from || !from.links.includes(toSystemId)) return null;
  if (!isConsumed(state.wake, toSystemId)) return config.jumpFuelCost;
  return config.wakeSpace[approach].fuelCost;
}

/**
 * Fuel cost of exploring one node in the current system. The action that
 * COMPLETES a system — taken when exactly one unexplored node remains — is
 * free (patch2 §5). "Last remaining" is order-independent: per-node explored
 * tracking means skipping around doesn't change which action is the closer.
 * (Deliberate consequence, flagged to designer: a single-node system's only
 * exploration is also its last, so it's always free.)
 */
export function exploreCost(state: RunState, config: GameConfig): number {
  const sector = currentSector(state, config);
  const here = sector.systems[state.currentSystemId];
  const unexplored = here.nodes.filter((n) => !state.exploredNodeIds.includes(n.id)).length;
  return unexplored === 1 ? 0 : config.exploreFuelCost;
}

/** Probability of contact when entering Wake-held space via `approach`. */
export function wakeFightChance(
  config: GameConfig,
  approach: WakeApproach,
  sensorLevel: number,
): number {
  const base = config.wakeSpace[approach].fightChance;
  if (approach !== 'sneak') return base;
  return Math.max(0, base - config.wakeSpace.sneak.sensorReductionPerLevel * sensorLevel);
}

function applyEffects(state: RunState, effects: EventEffects | undefined): void {
  if (!effects) return;
  if (effects.fuel) state.fuel = Math.max(0, state.fuel + effects.fuel);
  if (effects.scrap) state.scrap = Math.max(0, state.scrap + effects.scrap);
  if (effects.flags) for (const f of effects.flags) state.flags[f] = true;
  if (effects.decodeSector && !state.decodedSectorIndexes.includes(state.sectorIndex)) {
    state.decodedSectorIndexes.push(state.sectorIndex);
  }
  if (effects.death) state.deathCause = effects.death;
  if (effects.wakeAdvance) {
    const pursuit = advanceWake(
      state.wake,
      state.visitOrder,
      state.currentSystemId,
      effects.wakeAdvance,
    );
    state.wake = pursuit.wake;
    // Death lands on ACK so the player still reads the outcome text first.
    if (pursuit.caught) state.deathCause = 'wake';
  }
}

/**
 * Stranded = nothing left to do here: no affordable jump, no affordable
 * unexplored node, and no unlocked gate. Not death by itself anymore — the
 * Wait-1-Day mechanic gives up to `stranding.maxWaitDays` rolls for rescue.
 */
export function isStranded(state: RunState, config: GameConfig): boolean {
  if (state.phase !== 'map') return false;
  const sector = currentSector(state, config);
  const here = sector.systems[state.currentSystemId];
  const canExplore =
    here.nodes.some((n) => !state.exploredNodeIds.includes(n.id)) &&
    state.fuel >= exploreCost(state, config);
  if (canExplore) return false;
  const canJump = here.links.some((id) => {
    const cost = jumpCost(state, id, config);
    return cost !== null && state.fuel >= cost;
  });
  if (canJump) return false;
  const atOpenGate =
    state.currentSystemId === sector.gateSystemId &&
    state.decodedSectorIndexes.includes(state.sectorIndex);
  return !atOpenGate;
}

/**
 * Central stranding bookkeeping, called after every map-phase resolution:
 * ends a stranding the moment options exist again (clock resets), and ends
 * the RUN once all wait days are spent with no way out. That death is final —
 * ship and crew are gone together, so §6.4 succession has nothing to inherit.
 */
function checkStranded(state: RunState, config: GameConfig): void {
  if (state.phase !== 'map') return;
  if (!isStranded(state, config)) {
    state.strandedDays = 0;
    return;
  }
  if (state.strandedDays >= config.stranding.maxWaitDays) {
    state.phase = 'dead';
    state.deathCause = 'adrift';
  }
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
      const approach = action.approach ?? 'casual';
      const intoWakeSpace = isConsumed(next.wake, action.toSystemId);
      const cost = jumpCost(next, action.toSystemId, config, approach);
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
        config.wakeAdvancePerJump,
      );
      next.wake = result.wake;
      if (result.caught) {
        next.phase = 'dead';
        next.deathCause = 'wake';
        return next;
      }

      if (intoWakeSpace) {
        const chance = wakeFightChance(config, approach, next.ship.sensors);
        const rng = new Rng(next.rngState.events);
        const contact = rng.next() < chance;
        next.rngState.events = rng.getState();
        if (contact) {
          // M2 SWAP POINT: this is the single site where a triggered fight
          // resolves. Today it fires a placeholder event; M2 replaces this
          // call with entry into the ship-combat state machine.
          fireEvent(
            next,
            findFixedEvent(events, approach === 'fast' ? 'wake-fight-fast' : 'wake-fight'),
            null,
          );
          return next;
        }
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
      const cost = exploreCost(next, config); // 0 when this completes the system
      if (next.fuel < cost) return state;

      // An intra-system exploration jump: costs fuel and nudges the hunt.
      next.fuel = Math.max(0, next.fuel - cost);
      next.exploredNodeIds.push(node.id);

      const pursuit = advanceWake(
        next.wake,
        next.visitOrder,
        next.currentSystemId,
        config.wakeAdvancePerExplore,
      );
      next.wake = pursuit.wake;
      if (pursuit.caught) {
        next.phase = 'dead';
        next.deathCause = 'wake';
        return next;
      }

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
      // Data-driven option requirements (e.g. paying scrap for fuel at a dock).
      const req = option.requires;
      if (req && ((req.scrap ?? 0) > next.scrap || (req.fuel ?? 0) > next.fuel)) return state;

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
      if (next.deathCause) {
        // An effect (e.g. wakeAdvance) already sealed this run's fate.
        next.phase = 'dead';
        return next;
      }
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

    case 'WAIT_DAY': {
      // Out-of-fuel stranding (patch 3): one mutually-exclusive roll per day —
      // tow / robbery / quiet (designer rulings: single roll; robbery loss = death).
      if (next.phase !== 'map') return state;
      if (!isStranded(next, config)) return state;
      const cfg = config.stranding;
      if (next.strandedDays >= cfg.maxWaitDays) return state;

      next.strandedDays++;

      // The hunt closes while you drift: 1 jump per full N days waited.
      if (next.strandedDays % cfg.wakeAdvanceEveryDays === 0) {
        const pursuit = advanceWake(
          next.wake,
          next.visitOrder,
          next.currentSystemId,
          cfg.wakeAdvanceJumps,
        );
        next.wake = pursuit.wake;
        if (pursuit.caught) {
          next.phase = 'dead';
          next.deathCause = 'wake';
          return next;
        }
      }

      const rng = new Rng(next.rngState.events);
      const roll = rng.next();
      next.rngState.events = rng.getState();

      if (roll < cfg.towChance) {
        // Rescued: towed to the nearest station (or the rescuers trade from
        // their own tanks if this sector rolled no stations at all).
        const sector = currentSector(next, config);
        const stationId = nearestStationSystemId(sector, next.currentSystemId);
        if (stationId && stationId !== next.currentSystemId) {
          next.currentSystemId = stationId;
          if (!next.visitOrder.includes(stationId)) next.visitOrder.push(stationId);
        }
        next.strandedDays = 0; // the rescue ends this stranding; a new one re-arms
        fireEvent(next, findFixedEvent(events, 'stranded-tow'), null);
        return next;
      }
      if (roll < cfg.towChance + cfg.robberyChance) {
        fireEvent(next, findFixedEvent(events, 'stranded-robbery'), null);
        return next;
      }
      fireEvent(next, findFixedEvent(events, 'stranded-quiet'), null);
      return next;
    }
  }
}
