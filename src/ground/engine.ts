/**
 * Personal-combat engine (§7.2, §7.3). Pure + seeded, same shape as the ship
 * combat engine: `startGround` builds the scene, `groundReduce` advances one
 * SIMULTANEOUS turn. The captain fights solo in M3; the fighter model already
 * carries a `side` so a companion (§6.3) drops in later without a rewrite.
 */

import { Rng } from '../engine/rng';
import type { ThreatBand } from '../combat/types';
import { THREAT_ORDER } from '../threat/sensor';
import type {
  Fighter,
  GroundAction,
  GroundConfig,
  GroundState,
  Zone,
} from './types';

const CAPTAIN_ID = 'captain';
export const COMPANION_ID = 'companion';

function bandIndex(band: ThreatBand): number {
  const i = THREAT_ORDER.indexOf(band as (typeof THREAT_ORDER)[number]);
  return i < 0 ? 0 : i;
}

export function aliveFoes(state: GroundState): Fighter[] {
  return state.fighters.filter((f) => f.side === 'foe' && f.down === null);
}

export function aliveCrew(state: GroundState): Fighter[] {
  return state.fighters.filter((f) => f.side === 'crew' && f.down === null);
}

export function captain(state: GroundState): Fighter {
  return state.fighters.find((f) => f.id === CAPTAIN_ID) as Fighter;
}

/** The §6.3 companion in this scene, if one boarded. */
export function companion(state: GroundState): Fighter | undefined {
  return state.fighters.find((f) => f.id === COMPANION_ID);
}

function zoneOf(state: GroundState, id: string): Zone | undefined {
  return state.zones.find((z) => z.id === id);
}

/** Effective cover of a fighter's zone — 0 once the cover has been shot away. */
function coverLevel(state: GroundState, fighter: Fighter): number {
  const z = zoneOf(state, fighter.zoneId);
  return z && z.coverHp > 0 ? z.cover : 0;
}

// ---------- construction ----------

export interface StartGroundArgs {
  threat: ThreatBand;
  /** Crew count to field as foes (from the sensor manifest / ship read). */
  foeCount: number;
  encounterName: string;
  seed: string;
  encounterId: string;
  config: GroundConfig;
  /** Loot context carried from the disabled ship (scrap cargo + ammo type). */
  reward: { scrap: number; ammoType: import('../combat/types').WeaponType | null };
  /** The §6.3 companion boarding alongside the captain, if any. */
  companionName?: string | null;
}

export function startGround(args: StartGroundArgs): GroundState {
  const { config, threat } = args;
  // Cover integrity defaults to the cover rating (a level-2 wall soaks 2 hits).
  const zones: Zone[] = config.zones.map((z) => ({ ...z, coverHp: z.cover, coverHpMax: z.cover }));

  const cap: Fighter = {
    id: CAPTAIN_ID,
    name: 'The Captain',
    side: 'crew',
    hp: config.captainHp,
    hpMax: config.captainHp,
    stun: 0,
    stunMax: 999, // the captain is never "subdued"; death is the only crew loss
    heat: 0,
    heatMax: config.heatMax,
    zoneId: zones[0].id,
    accuracy: config.captainAccuracy,
    damage: config.captainLethalDamage,
    down: null,
    suppressed: false,
  };

  // The companion (§6.3) fights at the captain's side, auto-acting on crew turns.
  const crew: Fighter[] = [cap];
  if (args.companionName) {
    crew.push({
      id: COMPANION_ID,
      name: args.companionName,
      side: 'crew',
      hp: config.companion.hp,
      hpMax: config.companion.hp,
      stun: 0,
      stunMax: config.companion.stunMax,
      heat: 0,
      heatMax: config.heatMax,
      zoneId: zones[0].id,
      accuracy: config.companion.acc,
      damage: config.companion.dmg,
      down: null,
      suppressed: false,
    });
  }

  const tmpl = config.foeByBand[threat] ?? config.foeByBand.GREEN;
  const foes: Fighter[] = [];
  const n = Math.max(1, args.foeCount);
  for (let i = 0; i < n; i++) {
    foes.push({
      id: `foe-${i}`,
      name: `Boarder ${i + 1}`,
      side: 'foe',
      hp: tmpl.hp,
      hpMax: tmpl.hp,
      stun: 0,
      stunMax: tmpl.stunMax,
      heat: 0,
      heatMax: config.heatMax,
      // Foes spread across the cover zones (past the captain's entry zone).
      zoneId: zones[Math.min(zones.length - 1, 1 + (i % Math.max(1, zones.length - 1)))].id,
      accuracy: tmpl.acc,
      damage: tmpl.dmg,
      down: null,
      suppressed: false,
    });
  }

  const rng = Rng.fromString(args.seed, `ground:${args.encounterId}`);
  const idx = bandIndex(threat);
  return {
    zones,
    fighters: [...crew, ...foes],
    turn: 1,
    log: [`You breach the airlock. ${n} ${idx <= 1 ? 'nervous' : 'hardened'} crew hold the corridor.`],
    rngState: rng.getState(),
    outcome: 'ongoing',
    threat,
    allyOffered: idx <= 1, // green/seasoned crews (conscripts) may talk (§7.3)
    readSeed: args.seed + ':ground:' + args.encounterId,
    encounterName: args.encounterName,
    origin: 'boarding',
    items: config.items.map((it) => ({ id: it.id, count: 1 })),
    reward: args.reward,
  };
}

// ---------- resolution ----------

/** Hit chance for one shot: base skill × shot profile − cover − suppression. */
function hitChance(
  attacker: Fighter,
  target: Fighter,
  shot: 'aimed' | 'snap',
  state: GroundState,
  config: GroundConfig,
): number {
  const shotMul = shot === 'aimed' ? 1 : 0.72;
  let acc = attacker.accuracy * shotMul;
  acc -= config.coverPerLevel * coverLevel(state, target);
  if (attacker.suppressed) acc -= config.suppressPenalty;
  return Math.max(0.05, Math.min(0.95, acc));
}

/** Resolve one fighter's shot at a target (cover degrades as it soaks fire). */
function resolveShot(
  attacker: Fighter,
  target: Fighter,
  shot: 'aimed' | 'snap',
  lethal: boolean,
  state: GroundState,
  config: GroundConfig,
  rng: Rng,
  log: string[],
): void {
  attacker.heat += shot === 'aimed' ? config.aimedHeat : config.snapHeat;
  const zone = zoneOf(state, target.zoneId);
  const hadCover = zone ? zone.coverHp > 0 : false;
  // Firing on a covered target eats away the cover whether or not it connects.
  if (zone && zone.coverHp > 0) zone.coverHp -= 1;

  const chance = hitChance(attacker, target, shot, state, config);
  if (rng.next() >= chance) {
    log.push(
      hadCover
        ? `${attacker.name} fires — ${target.name}'s cover holds.`
        : `${attacker.name} fires at ${target.name} — misses.`,
    );
    return;
  }
  if (lethal) {
    target.hp = Math.max(0, target.hp - attacker.damage);
    log.push(`${attacker.name} hits ${target.name} (−${attacker.damage} hp).`);
    if (target.hp <= 0 && target.down === null) {
      target.down = 'killed';
      log.push(`${target.name} goes down.`);
    }
  } else {
    target.stun += attacker.damage;
    log.push(`${attacker.name} stuns ${target.name} (${target.stun}/${target.stunMax}).`);
    if (target.stun >= target.stunMax && target.down === null) {
      target.down = 'subdued';
      log.push(`${target.name} drops, stunned.`);
    }
  }
}

/** Deterministic focus rule: the lowest-hp living target (ties → first). */
function weakest(fighters: Fighter[]): Fighter | undefined {
  return fighters.reduce<Fighter | undefined>(
    (best, f) => (best === undefined || f.hp < best.hp ? f : best),
    undefined,
  );
}

/**
 * The foe's target (ruling R1): foes focus the WEAKEST living crew member —
 * captain or companion. This is a deliberate design ruling, not an accident of
 * the old bug. On an HP tie among the weakest (e.g. both founders at 14/14 on
 * turn one), each foe picks randomly over the tied set via the seeded stream
 * (ruling R4), so fire spreads naturally instead of ganking one body. RNG is
 * consumed only when there IS a tie, so single-target turns don't shift the
 * cursor.
 */
export function focusCrew(state: GroundState, rng: Rng): Fighter {
  const crew = aliveCrew(state);
  if (crew.length === 0) return captain(state);
  const min = Math.min(...crew.map((c) => c.hp));
  const tied = crew.filter((c) => c.hp === min);
  return tied.length === 1 ? tied[0] : tied[rng.int(0, tied.length - 1)];
}

/** The nearest intact-cover zone a fighter isn't already standing in, or null. */
function coverRefuge(state: GroundState, f: Fighter): string | null {
  return state.zones.find((z) => z.coverHp > 0 && z.id !== f.zoneId)?.id ?? null;
}

type AutoPlan =
  | { kind: 'shoot'; shot: 'aimed' | 'snap'; targetId: string }
  | { kind: 'vent' }
  | { kind: 'move'; zoneId: string };

/** Simple foe doctrine, decided from turn-start state (simultaneous). */
export function foeAction(foe: Fighter, state: GroundState, config: GroundConfig, rng: Rng): AutoPlan {
  // Too hot to fire even a snap shot → vent.
  if (foe.heat + config.snapHeat > foe.heatMax) return { kind: 'vent' };
  // Hurt and exposed → dive for the nearest intact cover.
  if (foe.hp < foe.hpMax * 0.5 && coverLevel(state, foe) === 0) {
    const refuge = coverRefuge(state, foe);
    if (refuge) return { kind: 'move', zoneId: refuge };
  }
  const target = focusCrew(state, rng); // R1 + R4
  // Aimed shot when cool enough, otherwise snap.
  const shot = foe.heat + config.aimedHeat <= foe.heatMax ? 'aimed' : 'snap';
  return { kind: 'shoot', shot, targetId: target.id };
}

/**
 * The companion (§6.3) auto-acts. Offense: focus the weakest foe. But first
 * (ruling R2): the spouse WANTS to survive the gunfight — given the same
 * self-preservation instinct the foes have, they dive for intact cover when
 * hurt and exposed. Threshold is data-tuned (coverSeekHpFraction), never
 * hardcoded. Decided at turn start; simultaneous resolution is unchanged.
 */
export function companionAction(comp: Fighter, state: GroundState, config: GroundConfig): AutoPlan {
  if (comp.hp < comp.hpMax * config.companion.coverSeekHpFraction && coverLevel(state, comp) === 0) {
    const refuge = coverRefuge(state, comp);
    if (refuge) return { kind: 'move', zoneId: refuge };
  }
  const target = weakest(aliveFoes(state));
  if (!target) return { kind: 'vent' };
  if (comp.heat + config.aimedHeat <= comp.heatMax)
    return { kind: 'shoot', shot: 'aimed', targetId: target.id };
  if (comp.heat + config.snapHeat <= comp.heatMax)
    return { kind: 'shoot', shot: 'snap', targetId: target.id };
  return { kind: 'vent' };
}

function upkeep(state: GroundState, config: GroundConfig): void {
  for (const f of state.fighters) {
    if (f.down) continue;
    f.heat = Math.max(0, f.heat - config.coolRate);
    f.suppressed = false;
  }
}

/** Parley success: base by band, rising as the crew gets hurt (§7.3 Ally). */
export function parleyChance(state: GroundState, config: GroundConfig): number {
  const base = config.parleyBaseByBand[bandIndex(state.threat)] ?? 0;
  const foes = aliveFoes(state);
  if (foes.length === 0) return 0;
  const frac = foes.reduce((s, f) => s + f.hp, 0) / foes.reduce((s, f) => s + f.hpMax, 0);
  return Math.max(0, Math.min(0.95, base + (1 - frac) * 0.4));
}

function evaluate(state: GroundState, log: string[]): void {
  const cap = captain(state);
  if (cap.hp <= 0) {
    cap.down = 'killed';
    state.outcome = 'captain-down';
    log.push('The captain falls in the corridor. The dark closes in.');
    return;
  }
  if (aliveFoes(state).length === 0) {
    const foes = state.fighters.filter((f) => f.side === 'foe');
    if (foes.some((f) => f.down === 'yielded')) state.outcome = 'allied';
    else if (foes.some((f) => f.down === 'killed')) state.outcome = 'neutralized';
    else state.outcome = 'subdued';
    log.push(
      state.outcome === 'neutralized'
        ? 'The last of them stops moving. The corridor is yours.'
        : 'The last one goes down without a kill. You have prisoners.',
    );
  }
}

export function groundReduce(
  state: GroundState,
  action: GroundAction,
  config: GroundConfig,
): GroundState {
  if (state.outcome !== 'ongoing') return state;
  const next: GroundState = structuredClone(state);
  const rng = new Rng(next.rngState);
  const log: string[] = [];
  const cap = captain(next);

  // Withdraw ends the boarding immediately (it was always optional).
  if (action.type === 'GWITHDRAW') {
    next.outcome = 'withdrawn';
    next.log = ['You fall back through the airlock and seal it. The derelict drifts on.'];
    next.rngState = rng.getState();
    return next;
  }

  // Parley resolves before the volley — success ends it, failure costs the turn.
  if (action.type === 'GPARLEY') {
    if (rng.next() < parleyChance(next, config)) {
      for (const f of next.fighters) if (f.side === 'foe' && f.down === null) f.down = 'yielded';
      next.outcome = 'allied';
      next.log = ['You lower the blaster and talk. Slowly, they stand down.'];
      next.rngState = rng.getState();
      return next;
    }
    log.push('You call for a ceasefire — they answer with fire.');
  }

  // Decide foe AND companion actions from the TURN-START state (simultaneous
  // with the captain) — nobody reacts to what lands this same turn. Foe target
  // tie-breaks (R4) draw on the shared seeded stream in fighter order, so the
  // whole turn stays deterministic from the run seed.
  const foePlans = aliveFoes(next).map((f) => ({ f, plan: foeAction(f, next, config, rng) }));
  const comp = companion(next);
  const compPlan = comp && comp.down === null ? companionAction(comp, next, config) : null;

  // Captain acts.
  switch (action.type) {
    case 'GSHOOT': {
      const target = next.fighters.find((t) => t.id === action.targetId);
      const heatCost = action.shot === 'aimed' ? config.aimedHeat : config.snapHeat;
      if (!target || target.down !== null || cap.heat + heatCost > cap.heatMax) {
        log.push('Your blaster is too hot — you hold fire and let it cool.');
      } else {
        resolveShot(cap, target, action.shot, action.mode === 'lethal', next, config, rng, log);
      }
      break;
    }
    case 'GMOVE': {
      if (zoneOf(next, action.zoneId)) cap.zoneId = action.zoneId;
      log.push(`You move up to the ${zoneOf(next, action.zoneId)?.name ?? 'position'}.`);
      break;
    }
    case 'GTAKE_COVER': {
      cap.heat = Math.max(0, cap.heat - config.coolRate * 2);
      log.push('You hunker behind cover, blaster cooling.');
      break;
    }
    case 'GSUPPRESS': {
      const target = next.fighters.find((t) => t.id === action.targetId);
      cap.heat += config.snapHeat;
      if (target && target.down === null) {
        target.suppressed = true;
        log.push(`You rake ${target.name}'s position — they keep their head down.`);
      }
      break;
    }
    case 'GVENT': {
      cap.heat = 0;
      log.push('You vent the blaster — heat purged.');
      break;
    }
    case 'GITEM': {
      const slot = next.items.find((s) => s.id === action.itemId);
      const def = config.items.find((d) => d.id === action.itemId);
      if (slot && slot.count > 0 && def) {
        slot.count -= 1;
        if (def.kind === 'heal') {
          cap.hp = Math.min(cap.hpMax, cap.hp + def.amount);
          log.push(`You jab a ${def.name} — +${def.amount} hp.`);
        } else {
          // Stun blast hits every foe sharing the captain's zone.
          for (const f of next.fighters) {
            if (f.side === 'foe' && f.down === null && f.zoneId === cap.zoneId) {
              f.stun += def.amount;
              if (f.stun >= f.stunMax) f.down = 'subdued';
            }
          }
          log.push(`You lob a ${def.name} — it goes off in a white crack.`);
        }
      }
      break;
    }
    case 'GPARLEY':
      break; // failed parley already logged; foes still act below
  }

  // Foes act on their pre-decided plans (simultaneous — a downed foe this turn
  // still gets the shot it committed to at turn start).
  // The companion executes their pre-decided plan first (RNG order is fixed
  // purely for deterministic replay — plans were already locked).
  if (comp && compPlan) {
    if (compPlan.kind === 'vent') {
      comp.heat = 0;
      log.push(`${comp.name} vents a glowing blaster.`);
    } else if (compPlan.kind === 'move') {
      comp.zoneId = compPlan.zoneId;
      log.push(`${comp.name} moves up.`);
    } else {
      const target = next.fighters.find((t) => t.id === compPlan.targetId);
      if (target) resolveShot(comp, target, compPlan.shot, true, next, config, rng, log);
    }
  }
  for (const { f, plan } of foePlans) {
    if (plan.kind === 'vent') {
      f.heat = 0;
      log.push(`${f.name} vents an overheated blaster.`);
    } else if (plan.kind === 'move') {
      f.zoneId = plan.zoneId;
      log.push(`${f.name} falls back to cover.`);
    } else {
      const target = next.fighters.find((t) => t.id === plan.targetId) ?? cap;
      resolveShot(f, target, plan.shot, true, next, config, rng, log);
    }
  }

  evaluate(next, log);
  if (next.outcome === 'ongoing') {
    upkeep(next, config);
    next.turn += 1;
  }
  next.log = log;
  next.rngState = rng.getState();
  return next;
}
