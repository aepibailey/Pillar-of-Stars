/**
 * Pure state transitions. Every change to a run flows through reduce():
 * (state, action, deps) → new state. No I/O, no Math.random, no Date — the
 * only randomness is the serialized event stream in state.rngState. This is
 * what makes save/resume-at-every-decision-point and deterministic tests
 * possible (§13).
 */

import { combatReduce, effLevel, makeCombatShip, startCombat } from '../combat/engine';
import type {
  CombatAction,
  CombatOrigin,
  EnemyArchetype,
  PlayerShipDef,
  SubsystemId,
  WeaponDef,
} from '../combat/types';
import { findFixedEvent, getEvent, pickNodeEvent, pickOutcome } from '../events/engine';
import type { EventDef, EventEffects } from '../events/types';
import { getSector } from '../galaxy/generate';
import { nearestStationSystemId } from '../galaxy/search';
import type { Sector } from '../galaxy/types';
import { advanceWake, createWakeState, isConsumed } from '../threat/wake';
import { deriveSeed, Rng } from './rng';
import type { Character, GameConfig, RunState, ShipState, WakeApproach } from './types';

// v4: ship subsystem model + combat (was v3: strandedDays / Wait-1-Day).
export const SCHEMA_VERSION = 4;

export type Action =
  | { type: 'NEW_RUN'; seed: string }
  | { type: 'FINISH_INTRO' } // watched or skipped — same transition
  | { type: 'JUMP'; toSystemId: string; approach?: WakeApproach }
  | { type: 'EXPLORE'; nodeId: string }
  | { type: 'RESOLVE_OPTION'; optionIndex: number }
  | { type: 'ACK_OUTCOME' }
  | { type: 'ENTER_GATE' }
  | { type: 'WAIT_DAY' }
  | { type: 'COMBAT_ACTION'; combatAction: CombatAction }
  | { type: 'COMBAT_ACK' }
  | { type: 'REPAIR'; target: 'hull' | SubsystemId };

export interface Deps {
  events: readonly EventDef[];
  config: GameConfig;
  weapons: readonly WeaponDef[];
  enemies: readonly EnemyArchetype[];
  playerDef: PlayerShipDef;
}

/** Build a fresh player ship (§5) from the data-driven class definition. */
export function buildPlayerShip(
  playerDef: PlayerShipDef,
  weapons: readonly WeaponDef[],
): ShipState {
  return makeCombatShip(
    playerDef.name,
    playerDef.hullMax,
    playerDef.subsystems,
    playerDef.pdChance,
    playerDef.weapons,
    weapons,
  );
}

export function createRun(seed: string, config: GameConfig, ship: ShipState): RunState {
  const sector = getSector(seed, 0, config);
  const captain: Character = { id: 'char-0', name: 'The Survivor', role: 'captain' };
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: `run-${deriveSeed(seed, 'run-id').toString(36)}`,
    seed,
    phase: 'intro',
    characters: [captain],
    captainId: captain.id,
    ship,
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
    combat: null,
    strandedDays: 0,
    stats: { jumps: 0, eventsResolved: 0, combats: 0 },
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

/**
 * Wake-space sneak reads the ship's sensor UPGRADE above its starting level, so
 * a fresh ship gets no bonus (preserving M1 balance) while later sensor
 * upgrades tighten the sneak — and damaged sensors make it worse.
 */
function sensorBonus(state: RunState, deps: Deps): number {
  return effLevel(state.ship.subsystems.sensors) - deps.playerDef.subsystems.sensors;
}

/** Start a ship fight (§7.1). Enemy is chosen deterministically off the event RNG. */
function launchCombat(
  state: RunState,
  deps: Deps,
  archetypeId: string,
  origin: CombatOrigin,
  fleeHeadstart: number,
): void {
  const { config, weapons, enemies, playerDef } = deps;
  let archetype: EnemyArchetype;
  if (archetypeId === 'random') {
    const rng = new Rng(state.rngState.events);
    archetype = rng.pick(enemies);
    state.rngState.events = rng.getState();
  } else {
    archetype = enemies.find((e) => e.id === archetypeId) ?? enemies[0];
  }
  const encounterId = String(state.stats.combats);
  state.stats.combats++;
  state.combat = startCombat({
    seed: state.seed,
    encounterId,
    playerDef,
    playerShip: state.ship,
    archetype,
    weaponDefs: weapons,
    config: config.combat,
    origin,
    fleeHeadstart,
  });
  state.phase = 'combat';
}

/** Apply a resolved fight back to the run: writeback ship, salvage, or death. */
function applyCombatResult(state: RunState, config: GameConfig): void {
  const c = state.combat;
  if (!c || c.outcome === 'ongoing') return;

  if (c.outcome === 'lost') {
    state.combat = null;
    state.phase = 'dead';
    state.deathCause = 'destroyed';
    return;
  }

  // Persist hull, subsystem damage, and spent ammo; reset combat-transient fields.
  state.ship = {
    ...c.player,
    power: { engines: 0, weapons: 0, shields: 0 },
    shieldLayers: 0,
    fleeCharge: 0,
  };
  if (c.outcome === 'won') {
    state.scrap += c.salvageScrap;
    state.fuel += c.salvageFuel;
  } else if (c.outcome === 'surrendered') {
    state.scrap = Math.max(0, state.scrap - c.surrenderScrapCost);
  } else if (c.outcome === 'bribed') {
    state.scrap = Math.max(0, state.scrap - c.bribeCost);
  }
  state.combat = null;
  state.phase = 'map';
  checkStranded(state, config);
}

export function reduce(state: RunState, action: Action, deps: Deps): RunState {
  const { events, config, weapons } = deps;

  if (action.type === 'NEW_RUN') {
    return createRun(action.seed, config, buildPlayerShip(deps.playerDef, weapons));
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
        const chance = wakeFightChance(config, approach, sensorBonus(next, deps));
        const rng = new Rng(next.rngState.events);
        const contact = rng.next() < chance;
        next.rngState.events = rng.getState();
        if (contact) {
          // Wake-held space is patrolled: contact launches a real ship fight
          // (§7.1). The 'fast' approach's promised easier escape becomes a
          // flee-charge head start.
          launchCombat(
            next,
            deps,
            'random',
            'wake-space',
            approach === 'fast' ? config.combat.fastApproachFleeHeadstart : 0,
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
      // A hostile ship may be lying in wait (§7.1 encounter source).
      if (rng.next() < config.hostileEncounterChance) {
        next.rngState.events = rng.getState();
        fireEvent(next, findFixedEvent(events, 'hostile-ship'), node.id);
        return next;
      }
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
      next.activeEvent = {
        ...next.activeEvent,
        stage: 'outcome',
        outcomeText: outcome.text,
        pendingCombat: outcome.effects?.launchCombat,
      };
      next.stats.eventsResolved++;
      return next;
    }

    case 'ACK_OUTCOME': {
      if (next.phase !== 'event' || !next.activeEvent || next.activeEvent.stage !== 'outcome') {
        return state;
      }
      const pendingCombat = next.activeEvent.pendingCombat;
      next.activeEvent = null;
      if (next.deathCause) {
        // An effect (e.g. wakeAdvance) already sealed this run's fate.
        next.phase = 'dead';
        return next;
      }
      if (pendingCombat) {
        // The event resolved into a fight (e.g. the hostile-ship encounter).
        launchCombat(next, deps, pendingCombat, 'hostile-event', 0);
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

    case 'COMBAT_ACTION': {
      if (next.phase !== 'combat' || !next.combat || next.combat.outcome !== 'ongoing') {
        return state;
      }
      // Bribe must be affordable before it's offered to the enemy.
      if (action.combatAction.type === 'BRIBE' && next.scrap < next.combat.bribeCost) return state;
      next.combat = combatReduce(next.combat, action.combatAction, weapons, config.combat);
      return next;
    }

    case 'COMBAT_ACK': {
      if (next.phase !== 'combat' || !next.combat || next.combat.outcome === 'ongoing') {
        return state;
      }
      applyCombatResult(next, config);
      return next;
    }

    case 'REPAIR': {
      // Spend scrap to undo combat damage (§5 "repairs cost scrap").
      if (next.phase !== 'map' || next.scrap <= 0) return state;
      const r = config.repair;
      if (action.target === 'hull') {
        if (next.ship.hull >= next.ship.hullMax) return state;
        next.scrap -= 1;
        next.ship.hull = Math.min(next.ship.hullMax, next.ship.hull + r.hullPerScrap);
      } else {
        const sub = next.ship.subsystems[action.target];
        if (sub.damage <= 0) return state;
        next.scrap -= 1;
        sub.damage = Math.max(0, sub.damage - r.subsystemDamagePerScrap);
      }
      return next;
    }
  }
}
