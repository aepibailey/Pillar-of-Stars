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
  CombatState,
  EnemyArchetype,
  PlayerShipDef,
  SubsystemId,
  WeaponDef,
  WeaponType,
} from '../combat/types';
import { findFixedEvent, getEvent, pickNodeEvent, pickOutcome } from '../events/engine';
import type { EventDef, EventEffects } from '../events/types';
import { getSector } from '../galaxy/generate';
import { nearestStationSystemId } from '../galaxy/search';
import type { Sector } from '../galaxy/types';
import { groundReduce, startGround } from '../ground/engine';
import type { GroundAction, GroundConfig } from '../ground/types';
import { generateSpecies } from '../species/generate';
import { THREAT_ORDER } from '../threat/sensor';
import { advanceWake, createWakeState, isConsumed } from '../threat/wake';
import { deriveSeed, Rng } from './rng';
import type { SpeciesParts } from '../species/types';
import type {
  Character,
  FounderSeed,
  FoundersDef,
  GameConfig,
  RunState,
  ShipState,
  ThreatRewards,
  WakeApproach,
} from './types';

// v10: M4 — founding couple, crew/growth model, codex, species layer, contact,
//      succession ('contact'/'succession' phases; ascendLocked; ironman).
// v9: pendingWake — the Wake reaching you always routes to an encounter (§4).
// v8: intel currency + band-scaled boarding loot.
// v7: boarding / personal combat (RunState.ground + 'ground' phase).
// v6: sensor-scaled threat read (combat carries a per-encounter readSeed).
// v5: point-defense subsystem (targetable PD + saturating salvos).
// v4: ship subsystem model + combat (was v3: strandedDays / Wait-1-Day).
export const SCHEMA_VERSION = 10;

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
  | { type: 'BOARD' } // dock a disabled ship → personal combat (§7.3)
  | { type: 'GROUND_ACTION'; groundAction: GroundAction }
  | { type: 'GROUND_ACK' }
  // First contact (§8): sensors → decode → dialogue.
  | { type: 'CONTACT_PROCEED' }
  | { type: 'CONTACT_DECODE' }
  | { type: 'CONTACT_DIALOGUE'; stance: 'peaceful' | 'trade' | 'guarded' }
  | { type: 'CONTACT_WITHDRAW' }
  | { type: 'CONTACT_ACK' }
  | { type: 'REPAIR'; target: 'hull' | SubsystemId };

export interface Deps {
  events: readonly EventDef[];
  config: GameConfig;
  weapons: readonly WeaponDef[];
  enemies: readonly EnemyArchetype[];
  playerDef: PlayerShipDef;
  /** Brutal name pool for Wake vessels (§9.1); separate from other factions. */
  wakeShipNames: readonly string[];
  /** Personal-combat tuning + boarding scenario data (§7.2). */
  ground: GroundConfig;
  /** Threat-band boarding loot table (§7.3/§7.4). */
  threatRewards: ThreatRewards;
  /** v0.7 founding couple creation values (§6.0). */
  founders: FoundersDef;
  /** Species component pools (§8). */
  speciesParts: SpeciesParts;
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

/** Build one founding character (v0.7 §6.0) from its creation seed. */
function makeFounder(id: string, seedDef: FounderSeed, role: 'captain' | 'crew'): Character {
  return {
    id,
    name: seedDef.name,
    role,
    gender: seedDef.gender,
    isFounder: true,
    // v0.7 §6.2: the spouse never deserts from morale while alive. Both
    // founders carry the flag — the captain trivially can't desert, and it
    // survives role swaps on succession without special-casing.
    desertionImmune: true,
    speciesId: 'human',
    background: seedDef.background,
    skills: seedDef.skills.map((s) => ({ ...s })),
    traits: [seedDef.trait],
    xp: 0,
    level: 1,
    unspentSkillPoints: 0,
    scars: [],
    alive: true,
  };
}

export function createRun(
  seed: string,
  config: GameConfig,
  ship: ShipState,
  founders: FoundersDef,
): RunState {
  const sector = getSector(seed, 0, config);
  // v0.7: the run begins with the founding couple — the captain and the spouse,
  // who pre-fills the §6.3 companion slot from minute one.
  const captain = makeFounder('char-0', founders.captain, 'captain');
  const spouse = makeFounder('char-1', founders.spouse, 'crew');
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: `run-${deriveSeed(seed, 'run-id').toString(36)}`,
    seed,
    phase: 'intro',
    characters: [captain, spouse],
    captainId: captain.id,
    companionId: spouse.id,
    founderIds: [captain.id, spouse.id],
    ascendLocked: false,
    ironman: false,
    codex: { entries: [] },
    speciesStanding: {},
    contactedSpeciesIds: [],
    contact: null,
    ship,
    sectorIndex: 0,
    currentSystemId: sector.entrySystemId,
    visitOrder: [sector.entrySystemId],
    exploredNodeIds: [],
    decodedSectorIndexes: [],
    flags: {},
    fuel: config.startFuel,
    scrap: config.startScrap,
    intel: 0,
    wake: createWakeState(config.wakeGraceJumps),
    pendingWake: false,
    activeEvent: null,
    combat: null,
    ground: null,
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

/**
 * THE single Wake-advance entry point (§4). Advance the front from one source
 * and fold it into state. If the front reaches the player's system — for ANY
 * reason (a jump, an event's wakeAdvance, stranded drift) — it queues a forced
 * Wake-encounter via `pendingWake`; it NEVER kills the player directly. Every
 * advance site must go through here so none can silently bypass the encounter.
 */
function advanceWakeInto(state: RunState, advanceJumps: number): void {
  const r = advanceWake(state.wake, state.visitOrder, state.currentSystemId, advanceJumps);
  state.wake = r.wake;
  if (r.caught) state.pendingWake = true;
}

/**
 * If a Wake-encounter is queued (the front reached the player), launch it now:
 * a forced ship fight (§4 "brutal odds, and they're looking for you") that is
 * always survivable — flee/bribe/surrender/win. NEVER a silent game-over.
 * Callers invoke this at their next safe presentation point. Returns true if a
 * fight was launched (the caller should stop and return the state).
 */
function resolvePendingWake(state: RunState, deps: Deps, fleeHeadstart = 0): boolean {
  if (!state.pendingWake) return false;
  state.pendingWake = false;
  launchCombat(state, deps, 'random', 'wake-space', fleeHeadstart);
  return true;
}

// ---------- first contact (§8) ----------

/** This run's species — pure from the seed; never stored in state. */
export function runSpecies(state: RunState, deps: Deps) {
  return generateSpecies(state.seed, deps.speciesParts);
}

/**
 * Decode-check success chance (§8): sensors + comms + the best xeno-linguist
 * aboard, on top of a base. This is the skill check of the mini-event.
 */
export function decodeChance(state: RunState, deps: Deps): number {
  const fc = deps.config.firstContact;
  const bestLinguist = Math.max(
    0,
    ...state.characters
      .filter((c) => c.alive)
      .flatMap((c) => c.skills.filter((s) => s.domain === 'linguistics').map((s) => s.level)),
  );
  const p =
    fc.baseDecodeChance +
    fc.perSensorLevel * effLevel(state.ship.subsystems.sensors) +
    fc.perCommsLevel * effLevel(state.ship.subsystems.comms) +
    fc.perLinguistSkillLevel * bestLinguist;
  return Math.max(0.05, Math.min(0.95, p));
}

/** Add a codex entry once (§8: knowledge is the meta-progression). */
function codexAdd(state: RunState, entry: string): void {
  if (!state.codex.entries.includes(entry)) state.codex.entries.push(entry);
}

/** Record a species as met + log its COMPONENTS to the codex (components are
 * cross-run-stable ids; per-run species ids are not). */
function recordContact(state: RunState, deps: Deps, speciesId: string): void {
  if (!state.contactedSpeciesIds.includes(speciesId)) {
    state.contactedSpeciesIds.push(speciesId);
  }
  const sp = runSpecies(state, deps).find((s) => s.id === speciesId);
  if (!sp) return;
  codexAdd(state, `morph:${sp.morphologyId}`);
  codexAdd(state, `gov:${sp.governmentId}`);
  for (const v of sp.valueIds) codexAdd(state, `value:${v}`);
}

/** Fire the first-contact mini-event with an uncontacted species, if any. */
function launchContact(state: RunState, deps: Deps, speciesId: string): void {
  state.contact = {
    speciesId,
    stage: 'sensors',
    attemptsLeft: deps.config.firstContact.attempts,
    rngState: deriveSeed(state.seed, `contact:${speciesId}`),
  };
  state.phase = 'contact';
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
    // An event side-effect can bring the front onto you (a probe transmitting,
    // §4). If it reaches your system this queues the forced Wake-encounter,
    // resolved on ACK so you read the outcome text first — never a silent death.
    advanceWakeInto(state, effects.wakeAdvance);
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
  const { config, weapons, enemies, playerDef, wakeShipNames } = deps;
  const rng = new Rng(state.rngState.events);
  let archetype: EnemyArchetype;
  if (archetypeId === 'random') {
    // The player's very first fight is a GREEN shakedown so the first-combat
    // tutorial always opens on a low-threat, winnable encounter (design call,
    // Session 10). A scripted archetypeId (e.g. a derelict trap) keeps its own
    // enemy; only the 'random' rolls are softened for that opening bout.
    const firstFight = state.stats.combats === 0;
    archetype =
      firstFight && enemies.find((e) => e.id === 'derelict-scavenger')
        ? (enemies.find((e) => e.id === 'derelict-scavenger') as EnemyArchetype)
        : rng.pick(enemies);
  } else {
    archetype = enemies.find((e) => e.id === archetypeId) ?? enemies[0];
  }
  // Wake vessels get a distinct, brutal generated name from their own pool
  // (§9.1); other foes keep their faction archetype name.
  const enemyNameOverride =
    origin === 'wake-space' && wakeShipNames.length > 0
      ? `${rng.pick(wakeShipNames)} ${archetype.className}`
      : undefined;
  state.rngState.events = rng.getState();

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
    enemyNameOverride,
  });
  if (config.debugBoardable) {
    // Dev only (?board=1): open the fight already boardable.
    const e = state.combat.enemy;
    e.subsystems.weapons.damage = e.subsystems.weapons.level;
    e.subsystems.engines.damage = e.subsystems.engines.level;
  }
  state.phase = 'combat';
}

/** Persist the fought ship back to the run (hull/subsystem damage/ammo), resetting
 * combat-transient fields. Shared by ship-fight resolution and boarding. */
function persistShip(state: RunState, player: ShipState): void {
  state.ship = {
    ...player,
    power: { engines: 0, weapons: 0, shields: 0 },
    shieldLayers: 0,
    fleeCharge: 0,
  };
}

/** A ship is boardable once its weapons AND engines are both disabled (§7.3). */
export function canBoard(c: CombatState): boolean {
  return (
    c.outcome === 'ongoing' &&
    effLevel(c.enemy.subsystems.weapons) <= 0 &&
    effLevel(c.enemy.subsystems.engines) <= 0
  );
}

/** The boarded ship's ammo-consuming weapon type (kinetic/missile), if any (§7.1). */
function ammoWeaponType(ship: CombatState['enemy'], weapons: Deps['weapons']): 'kinetic' | 'missile' | null {
  for (const slot of ship.weapons) {
    const def = weapons.find((w) => w.id === slot.defId);
    if (def && def.ammo !== undefined && (def.type === 'kinetic' || def.type === 'missile')) {
      return def.type;
    }
  }
  return null;
}

/** Top up the player's matching-type weapons with looted ammo (§7.3, capped at magazine). */
function addAmmo(state: RunState, weapons: Deps['weapons'], type: WeaponType | null, qty: number): void {
  if (!type || qty <= 0) return;
  for (const slot of state.ship.weapons) {
    const def = weapons.find((w) => w.id === slot.defId);
    if (def && def.type === type && def.ammo !== undefined && slot.ammo >= 0) {
      slot.ammo = Math.min(def.ammo, slot.ammo + qty);
    }
  }
}

/** Dock the disabled ship and launch personal combat in its corridors (§7.3). */
function launchBoarding(state: RunState, deps: Deps): void {
  const c = state.combat as CombatState;
  persistShip(state, c.player);
  const idx = THREAT_ORDER.indexOf(c.enemyThreat as (typeof THREAT_ORDER)[number]);
  state.ground = startGround({
    threat: c.enemyThreat,
    foeCount: 2 + (idx < 0 ? 0 : idx), // matches the sensor manifest read
    encounterName: c.enemy.name,
    seed: state.seed,
    encounterId: `${state.stats.combats}b`,
    config: deps.ground,
    reward: { scrap: c.salvageScrap, ammoType: ammoWeaponType(c.enemy, deps.weapons) },
  });
  state.combat = null;
  state.phase = 'ground';
}

/** Apply a resolved boarding back to the run (§7.3 paths), loot scaled by band (§7.4). */
function applyGroundResult(state: RunState, deps: Deps): void {
  const g = state.ground;
  if (!g || g.outcome === 'ongoing') return;

  if (g.outcome === 'captain-down') {
    state.ground = null;
    state.phase = 'dead';
    state.deathCause = 'boarding';
    return;
  }

  const loot = deps.threatRewards.rewardsByBand[g.threat] ?? { fuel: 0, intel: 0, ammo: 0 };
  if (g.outcome === 'neutralized') {
    // Full strip: cargo scrap + band fuel/intel/ammo. Some factions remember massacres.
    state.scrap += g.reward.scrap + 2;
    state.fuel += loot.fuel;
    state.intel += loot.intel;
    addAmmo(state, deps.weapons, g.reward.ammoType, loot.ammo);
    state.flags.boardedMassacre = true;
  } else if (g.outcome === 'subdued') {
    // Harder to pull off, but prisoners + an intact hold pay a scrap premium.
    state.scrap += g.reward.scrap + 4;
    state.fuel += loot.fuel;
    state.intel += loot.intel;
    addAmmo(state, deps.weapons, g.reward.ammoType, loot.ammo);
    state.flags.tookPrisoners = true;
  } else if (g.outcome === 'allied') {
    // You didn't strip the ship — no fuel/ammo. They talk, so you gain the intel
    // and a little goodwill cargo (§7.3: "escorts, intel, or a Defector recruit").
    state.scrap += Math.floor(g.reward.scrap / 2);
    state.intel += loot.intel;
    state.flags.alliedBoarding = true;
  }
  // 'withdrawn' → left the hull adrift, no reward.
  state.ground = null;
  state.phase = 'map';
  checkStranded(state, deps.config);
}

/** Apply a resolved fight back to the run: writeback ship, salvage, or death. */
function applyCombatResult(state: RunState, config: GameConfig): void {
  const c = state.combat;
  if (!c || c.outcome === 'ongoing') return;

  if (c.outcome === 'lost') {
    // Losing the forced Wake-space fight IS how the hunt finally takes you —
    // keep the 'wake' death for that, not the generic hull-breach text (§4).
    state.combat = null;
    state.phase = 'dead';
    state.deathCause = c.origin === 'wake-space' ? 'wake' : 'destroyed';
    return;
  }

  persistShip(state, c.player);
  if (c.outcome === 'won') {
    state.scrap += c.salvageScrap;
    state.fuel += c.salvageFuel;
  } else if (c.outcome === 'surrendered') {
    // Surrender is meant to hurt (playtest patch): they strip the hold bare and
    // siphon half your fuel before letting you limp away.
    state.scrap = 0;
    state.fuel = Math.floor(state.fuel / 2);
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
    const fresh = createRun(action.seed, config, buildPlayerShip(deps.playerDef, weapons), deps.founders);
    // Begin-again (§6.4): a new journey, armed with everything you've LEARNED.
    // The codex is the only thing that crosses runs (knowledge meta-progression,
    // pillar 3); the ironman preference also sticks — it's a setting, not progress.
    if (state?.codex) fresh.codex = { entries: [...state.codex.entries] };
    if (state?.ironman) fresh.ironman = true;
    return fresh;
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

      advanceWakeInto(next, config.wakeAdvancePerJump);
      // If the front reached the system you just entered, the §4 encounter is
      // already queued (forced). Otherwise, entering already-dark space rolls the
      // normal contact chance — you may still slip through unseen.
      const forced = next.pendingWake;
      if (!forced && intoWakeSpace) {
        const rng = new Rng(next.rngState.events);
        if (rng.next() < wakeFightChance(config, approach, sensorBonus(next, deps))) {
          next.pendingWake = true;
        }
        next.rngState.events = rng.getState();
      }
      // The 'fast' approach's promised easier escape becomes a flee-charge head start.
      if (resolvePendingWake(next, deps, approach === 'fast' ? config.combat.fastApproachFleeHeadstart : 0)) {
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
      const cost = exploreCost(next, config); // 0 when this completes the system
      if (next.fuel < cost) return state;

      // An intra-system exploration jump: costs fuel and nudges the hunt.
      next.fuel = Math.max(0, next.fuel - cost);
      next.exploredNodeIds.push(node.id);

      advanceWakeInto(next, config.wakeAdvancePerExplore);
      // The hunt arriving mid-survey is a forced §4 encounter, not a death —
      // and it takes precedence over whatever this node would have held.
      if (resolvePendingWake(next, deps)) return next;

      if (node.type === 'ruin' && here.id === sector.ruinSystemId) {
        fireEvent(next, findFixedEvent(events, 'sector-ruin'), node.id);
        return next;
      }

      const rng = new Rng(next.rngState.events);
      // First contact (§8): an uncontacted species may hail the survey. The
      // species to meet is the seeded pick among those not yet contacted.
      const unmet = runSpecies(next, deps).filter(
        (sp) => !next.contactedSpeciesIds.includes(sp.id),
      );
      if (unmet.length > 0) {
        const contactRoll = rng.next();
        if (config.debugContact || contactRoll < config.firstContact.chance) {
          const sp = unmet[Math.floor(rng.next() * unmet.length)];
          next.rngState.events = rng.getState();
          launchContact(next, deps, sp.id);
          return next;
        }
      }
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
        // An outcome that explicitly ends the run (effects.death).
        next.phase = 'dead';
        return next;
      }
      // The front reaching you via an event side-effect (a probe transmitting,
      // §4) launches its forced encounter now — AFTER the outcome text was read.
      // It supersedes any event-authored fight: the Wake is the bigger problem.
      if (resolvePendingWake(next, deps)) return next;
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

      // The hunt closes while you drift: 1 jump per full N days waited. If it
      // reaches you, it's a forced §4 encounter (a fight you might even win your
      // way out of stranding with), never a silent death.
      if (next.strandedDays % cfg.wakeAdvanceEveryDays === 0) {
        advanceWakeInto(next, cfg.wakeAdvanceJumps);
        if (resolvePendingWake(next, deps)) return next;
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

    case 'BOARD': {
      if (next.phase !== 'combat' || !next.combat || !canBoard(next.combat)) return state;
      launchBoarding(next, deps);
      return next;
    }

    case 'GROUND_ACTION': {
      if (next.phase !== 'ground' || !next.ground || next.ground.outcome !== 'ongoing') {
        return state;
      }
      next.ground = groundReduce(next.ground, action.groundAction, deps.ground);
      return next;
    }

    case 'GROUND_ACK': {
      if (next.phase !== 'ground' || !next.ground || next.ground.outcome === 'ongoing') {
        return state;
      }
      applyGroundResult(next, deps);
      return next;
    }

    // ---------- first contact (§8): sensors → decode → dialogue ----------

    case 'CONTACT_PROCEED': {
      if (next.phase !== 'contact' || next.contact?.stage !== 'sensors') return state;
      next.contact = { ...next.contact, stage: 'decode' };
      return next;
    }

    case 'CONTACT_DECODE': {
      if (next.phase !== 'contact' || next.contact?.stage !== 'decode') return state;
      const c = next.contact;
      const rng = new Rng(c.rngState);
      const fc = config.firstContact;

      if (rng.next() < decodeChance(next, deps)) {
        // Their language resolves into something you can answer.
        next.contact = { ...c, stage: 'dialogue', rngState: rng.getState() };
        return next;
      }
      if (rng.next() < fc.botchChance) {
        // BOTCHED (§8): your reply meant something unforgivable in theirs.
        // Lasting hostility — written into standing, permanent for the run.
        next.speciesStanding[c.speciesId] =
          (next.speciesStanding[c.speciesId] ?? 0) + fc.botchStanding;
        recordContact(next, deps, c.speciesId);
        next.flags[`botchedContact:${c.speciesId}`] = true;
        next.contact = {
          ...c,
          stage: 'done',
          rngState: rng.getState(),
          outcomeText:
            'Your reply goes out — and every light on their hull turns red at once. Whatever you just said in their language, there is no unsaying it. They will remember your hull.',
        };
        return next;
      }
      // A clean failure: the signal stays noise. Attempts are finite.
      const attemptsLeft = c.attemptsLeft - 1;
      if (attemptsLeft <= 0) {
        // The window closes — they move on, unmet. You may cross paths again.
        next.contact = {
          ...c,
          stage: 'done',
          attemptsLeft: 0,
          rngState: rng.getState(),
          outcomeText:
            'The signal folds back into noise, and their ship turns away, unhurried. Whoever they are, the conversation is over — for now.',
        };
        return next;
      }
      next.contact = { ...c, attemptsLeft, rngState: rng.getState() };
      return next;
    }

    case 'CONTACT_DIALOGUE': {
      if (next.phase !== 'contact' || next.contact?.stage !== 'dialogue') return state;
      const c = next.contact;
      const fc = config.firstContact;
      const delta =
        action.stance === 'peaceful' ? fc.peacefulStanding : action.stance === 'trade' ? 1 : 0;
      next.speciesStanding[c.speciesId] = (next.speciesStanding[c.speciesId] ?? 0) + delta;
      recordContact(next, deps, c.speciesId);
      const sp = runSpecies(next, deps).find((s) => s.id === c.speciesId);
      const text =
        action.stance === 'peaceful'
          ? `You open with peace, and the ${sp?.name ?? 'stranger'} answer in kind. A door in the galaxy that was closed an hour ago now stands open.`
          : action.stance === 'trade'
            ? `Commerce, it turns out, is a universal language. The ${sp?.name ?? 'stranger'} transmit a price list before they transmit a greeting.`
            : `You keep your shields up and your words few. The ${sp?.name ?? 'stranger'} note the caution — and respect it, barely.`;
      next.contact = { ...c, stage: 'done', outcomeText: text };
      return next;
    }

    case 'CONTACT_WITHDRAW': {
      // Backing away quietly is always allowed pre-dialogue: no record, no
      // standing change — you simply haven't met them yet.
      if (
        next.phase !== 'contact' ||
        !next.contact ||
        next.contact.stage === 'dialogue' ||
        next.contact.stage === 'done'
      ) {
        return state;
      }
      next.contact = null;
      next.phase = 'map';
      checkStranded(next, config);
      return next;
    }

    case 'CONTACT_ACK': {
      if (next.phase !== 'contact' || next.contact?.stage !== 'done') return state;
      next.contact = null;
      next.phase = 'map';
      checkStranded(next, config);
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
