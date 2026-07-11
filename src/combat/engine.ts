/**
 * Ship-combat state machine (§7.1). Pure and deterministic: every transition
 * is a function of (state, action) plus the combat RNG cursor carried inside
 * the state. No I/O, no Math.random — one seed reproduces a whole fight, and
 * save/resume mid-turn continues it exactly (§13).
 *
 * Turn model (one decision = one save point): the player submits a power
 * allocation + per-weapon targets + an action. The engine resolves the player
 * volley, then the enemy volley (by doctrine), then upkeep (shield/ion regen,
 * cooldowns, flee charge), and reports the new state.
 */

import { Rng } from '../engine/rng';
import type {
  CombatAction,
  CombatConfig,
  CombatOrigin,
  CombatShip,
  CombatState,
  EnemyArchetype,
  EnemyDoctrine,
  FireStatus,
  PlayerShipDef,
  PowerAllocation,
  Subsystem,
  SubsystemId,
  TargetId,
  WeaponDef,
  WeaponSlot,
} from './types';
import { SUBSYSTEM_IDS } from './types';

// ---------- helpers ----------

export function effLevel(sub: Subsystem): number {
  return Math.max(0, sub.level - sub.damage);
}

export function reactorOutput(ship: CombatShip): number {
  return effLevel(ship.subsystems.reactor);
}

function weaponDef(defs: readonly WeaponDef[], id: string): WeaponDef {
  const def = defs.find((w) => w.id === id);
  if (!def) throw new Error(`unknown weapon '${id}'`);
  return def;
}

function makeSubsystems(levels: Record<SubsystemId, number>): Record<SubsystemId, Subsystem> {
  const out = {} as Record<SubsystemId, Subsystem>;
  for (const id of SUBSYSTEM_IDS) out[id] = { level: levels[id] ?? 0, damage: 0 };
  return out;
}

function makeWeaponSlots(defs: readonly WeaponDef[], ids: string[]): WeaponSlot[] {
  return ids.map((id) => {
    const def = weaponDef(defs, id);
    return { defId: id, ammo: def.ammo ?? -1, cooldownLeft: 0 };
  });
}

/**
 * Clamp a requested allocation to what the reactor and subsystems can sustain.
 * Reactor damage (brownout, §5) shrinks the pool; each channel is capped by its
 * own effective subsystem level.
 */
export function clampPower(ship: CombatShip, req: PowerAllocation): PowerAllocation {
  // TWO constraints, both surfaced in the UI as "allocated/max":
  //  1. each channel is capped at its subsystem's effective level (a level-3
  //     weapons bay accepts at most 3 power; damage lowers this), and
  //  2. the total across channels can't exceed the reactor pool.
  const capEngines = Math.min(
    Math.max(0, Math.floor(req.engines)),
    effLevel(ship.subsystems.engines),
  );
  const capWeapons = Math.min(
    Math.max(0, Math.floor(req.weapons)),
    effLevel(ship.subsystems.weapons),
  );
  const capShields = Math.min(
    Math.max(0, Math.floor(req.shields)),
    effLevel(ship.subsystems.shields),
  );
  const out = { engines: capEngines, weapons: capWeapons, shields: capShields };
  // Trim to the reactor pool, shedding shields → engines → weapons last.
  let over = out.engines + out.weapons + out.shields - reactorOutput(ship);
  for (const chan of ['shields', 'engines', 'weapons'] as const) {
    if (over <= 0) break;
    const cut = Math.min(out[chan], over);
    out[chan] -= cut;
    over -= cut;
  }
  return out;
}

export function evasion(ship: CombatShip, config: CombatConfig): number {
  const raw = config.evasionPerEnginePower * ship.power.engines;
  return Math.max(0, Math.min(config.maxEvasion, raw));
}

/**
 * Point-defense capacity: how many incoming missiles this ship can ENGAGE per
 * turn (§7.1). It's the effective level of the pointDefense subsystem, so ion
 * (or any subsystem hit) shrinks it and a disabled PD engages nothing. A salvo
 * larger than the capacity overwhelms it — the overflow leaks even against
 * intact PD. Each engaged missile still rolls `pdChance` to actually be killed.
 */
export function pdCapacity(ship: CombatShip): number {
  return effLevel(ship.subsystems.pointDefense);
}

function maxShieldLayers(ship: CombatShip): number {
  return Math.min(effLevel(ship.subsystems.shields), ship.power.shields);
}

/** Apply a landed shot's damage: hull hit, or subsystem hit that partly spills to hull. */
function applyDamage(ship: CombatShip, dmg: number, target: TargetId, config: CombatConfig): void {
  if (target === 'hull') {
    ship.hull = Math.max(0, ship.hull - dmg);
    return;
  }
  ship.subsystems[target].damage += dmg;
  const spill = Math.floor(dmg * config.subsystemHullFactor);
  ship.hull = Math.max(0, ship.hull - spill);
}

// ---------- construction ----------

export function makeCombatShip(
  name: string,
  hullMax: number,
  levels: Record<SubsystemId, number>,
  pdChance: number,
  weaponIds: string[],
  weaponDefs: readonly WeaponDef[],
): CombatShip {
  const subsystems = makeSubsystems(levels);
  const ship: CombatShip = {
    name,
    hull: hullMax,
    hullMax,
    subsystems,
    weapons: makeWeaponSlots(weaponDefs, weaponIds),
    pdChance,
    shieldLayers: 0,
    power: { engines: 0, weapons: 0, shields: 0 },
    fleeCharge: 0,
  };
  // Sensible default allocation: weapons first, then shields, then engines.
  ship.power = defaultEnemyPower(ship);
  ship.shieldLayers = maxShieldLayers(ship);
  return ship;
}

function defaultEnemyPower(ship: CombatShip): PowerAllocation {
  let pool = reactorOutput(ship);
  const w = Math.min(effLevel(ship.subsystems.weapons), pool);
  pool -= w;
  const s = Math.min(effLevel(ship.subsystems.shields), pool);
  pool -= s;
  const e = Math.min(effLevel(ship.subsystems.engines), pool);
  return { engines: e, weapons: w, shields: s };
}

export interface StartCombatArgs {
  seed: string;
  encounterId: string;
  playerDef: PlayerShipDef;
  /** Player's persistent ship state (hull, subsystem damage, weapon ammo). */
  playerShip: CombatShip;
  archetype: EnemyArchetype;
  weaponDefs: readonly WeaponDef[];
  config: CombatConfig;
  origin: CombatOrigin;
  /** 'fast' Wake-space approach grants a flee-charge head start. */
  fleeHeadstart?: number;
  /** Override the enemy's display name (Wake ships get a brutal generated name). */
  enemyNameOverride?: string;
}

export function startCombat(args: StartCombatArgs): CombatState {
  const { archetype, weaponDefs, config, playerShip } = args;
  const enemy = makeCombatShip(
    args.enemyNameOverride ?? archetype.name,
    archetype.hullMax,
    archetype.subsystems,
    archetype.pdChance,
    archetype.weapons,
    weaponDefs,
  );
  const player: CombatShip = structuredClone(playerShip);
  player.fleeCharge = args.fleeHeadstart ?? 0;
  player.shieldLayers = maxShieldLayers(player);

  const rng = Rng.fromString(args.seed, `combat:${args.encounterId}`);
  return {
    player,
    enemy,
    enemyArchetypeId: archetype.id,
    enemyThreat: archetype.threat,
    readSeed: `${args.seed}:threat:${args.encounterId}`,
    doctrine: archetype.doctrine,
    turn: 1,
    log: [`A ${args.enemyNameOverride ?? archetype.name} closes to knife-fight range.`],
    rngState: rng.getState(),
    outcome: 'ongoing',
    fleeThreshold: config.fleeThreshold,
    salvageScrap: archetype.salvageScrap,
    salvageFuel: archetype.salvageFuel,
    acceptsSurrender: archetype.acceptsSurrender,
    acceptsBribe: archetype.acceptsBribe,
    bribeCost: config.bribeCost,
    surrenderScrapCost: config.surrenderScrapCost,
    origin: args.origin,
  };
}

// ---------- resolution ----------

/**
 * Decide, per weapon, whether it fires this volley and — if not — why. The UI
 * and the resolution share this so the warning the player sees BEFORE firing
 * matches exactly what the log reports AFTER (playtest items 4 & 5).
 */
export function planVolley(
  ship: CombatShip,
  targets: (TargetId | null)[],
  weaponDefs: readonly WeaponDef[],
): FireStatus[] {
  const offline = effLevel(ship.subsystems.weapons) <= 0;
  let powerLeft = ship.power.weapons;
  return ship.weapons.map((slot, i) => {
    if (targets[i] == null) return 'hold';
    if (offline) return 'offline';
    const def = weaponDef(weaponDefs, slot.defId);
    if (slot.cooldownLeft > 0) return 'cooldown';
    if (slot.ammo === 0) return 'no-ammo';
    if (def.powerCost > powerLeft) return 'underpowered';
    powerLeft -= def.powerCost;
    return 'fire';
  });
}

function fireVolley(
  attacker: CombatShip,
  defender: CombatShip,
  targets: (TargetId | null)[],
  plan: FireStatus[],
  weaponDefs: readonly WeaponDef[],
  config: CombatConfig,
  rng: Rng,
  log: string[],
  attackerLabel: string,
): void {
  // The `plan` is decided BEFORE any volley executes this turn (simultaneous
  // resolution) — so damage from the other side can't retroactively change
  // which of these weapons fire. Every targeted weapon reports SOMETHING; an
  // untargeted weapon ('hold') is silent by design (you chose not to fire it).
  //
  // Point defense is a per-turn budget shared across the whole volley: this
  // defender can ENGAGE at most `pdCapacity` incoming missiles this turn, no
  // matter how many are launched. It's a live counter (not turn-start) so an
  // ion hit landing earlier in the SAME volley can't shrink it mid-flight —
  // capacity for the turn is fixed here, then drawn down missile by missile.
  const pd = { left: pdCapacity(defender) };
  attacker.weapons.forEach((slot, i) => {
    const def = weaponDef(weaponDefs, slot.defId);
    switch (plan[i]) {
      case 'hold':
        return;
      case 'offline':
        log.push(`${attackerLabel}'s ${def.name} — weapons systems are offline, cannot fire.`);
        return;
      case 'cooldown':
        log.push(`${attackerLabel}'s ${def.name} — still recharging, holds fire.`);
        return;
      case 'no-ammo':
        log.push(`${attackerLabel}'s ${def.name} — out of ammunition.`);
        return;
      case 'underpowered':
        log.push(
          `${attackerLabel}'s ${def.name} — NOT ENOUGH POWER to fire (needs ${def.powerCost} weapon power).`,
        );
        return;
      case 'fire':
        if (slot.ammo > 0) slot.ammo -= 1;
        slot.cooldownLeft = def.cooldown ?? 0;
        resolveHit(def, defender, targets[i] as TargetId, config, rng, log, attackerLabel, pd);
        return;
    }
  });
}

/** Mutable per-volley point-defense budget (intercept attempts left this turn). */
interface PdBudget {
  left: number;
}

function resolveHit(
  def: WeaponDef,
  target: CombatShip,
  targetId: TargetId,
  config: CombatConfig,
  rng: Rng,
  log: string[],
  attackerLabel: string,
  pd: PdBudget,
): void {
  if (def.type === 'missile') {
    const salvo = Math.max(1, def.salvo ?? 1);
    const label = `${attackerLabel}'s ${def.name}`;
    const prefix = salvo > 1 ? `${label} salvo` : label;
    for (let m = 0; m < salvo; m++) {
      resolveMissile(def, target, targetId, config, rng, log, prefix, pd);
    }
    return;
  }

  // Kinetic / laser / ion can be evaded.
  if (rng.next() < evasion(target, config)) {
    log.push(`${attackerLabel}'s ${def.name} — evaded.`);
    return;
  }

  if (def.type === 'kinetic') {
    if (target.shieldLayers > 0) {
      target.shieldLayers -= 1;
      log.push(`${attackerLabel}'s ${def.name} — shields hold (${target.shieldLayers} left).`);
      return;
    }
    applyDamage(target, def.damage, targetId, config);
    log.push(`${attackerLabel}'s ${def.name} bites into ${targetId}.`);
    return;
  }

  if (def.type === 'laser') {
    const before = target.shieldLayers;
    const strip = def.shieldStrip ?? 1;
    target.shieldLayers = Math.max(0, before - strip);
    if (strip >= before) {
      applyDamage(target, def.damage, targetId, config);
      log.push(`${attackerLabel}'s ${def.name} shreds the last shield and burns ${targetId}.`);
    } else {
      log.push(`${attackerLabel}'s ${def.name} strips shields (${target.shieldLayers} left).`);
    }
    return;
  }

  // ion — subsystem disable only, absorbed by shields
  if (target.shieldLayers > 0) {
    target.shieldLayers -= 1;
    log.push(`${attackerLabel}'s ${def.name} — shields absorb the ion charge.`);
    return;
  }
  const sid: TargetId = targetId === 'hull' ? 'weapons' : targetId;
  target.subsystems[sid].damage += def.damage;
  log.push(`${attackerLabel}'s ${def.name} overloads ${sid}.`);
}

/**
 * One missile resolving against point defense (§7.1). Missiles ignore shields —
 * the only thing between them and the hull is PD, and PD can engage only
 * `pdCapacity` of them per turn. The log distinguishes WHY each missile got
 * through so the two counter-strategies read clearly: crippling PD (capacity 0)
 * vs. saturating an intact PD (more missiles than it can engage).
 */
function resolveMissile(
  def: WeaponDef,
  target: CombatShip,
  targetId: TargetId,
  config: CombatConfig,
  rng: Rng,
  log: string[],
  label: string,
  pd: PdBudget,
): void {
  if (pd.left > 0) {
    // PD engages this warhead — it spends capacity whether or not it connects.
    pd.left -= 1;
    if (rng.next() < target.pdChance) {
      log.push(`${label} — shot down by point defense.`);
      return;
    }
    applyDamage(target, def.damage, targetId, config);
    log.push(`${label} — beats point defense, strikes ${targetId}.`);
    return;
  }
  // No PD capacity left for this warhead. Two very different reasons:
  applyDamage(target, def.damage, targetId, config);
  if (pdCapacity(target) <= 0) {
    log.push(`${label} — point defense is down, strikes ${targetId} unopposed.`);
  } else {
    log.push(`${label} — overwhelms saturated point defense, strikes ${targetId}.`);
  }
}

/** Enemy doctrine: pick a target for every ready weapon. */
function enemyTargets(state: CombatState, weaponDefs: readonly WeaponDef[]): (TargetId | null)[] {
  const pick = (doctrine: EnemyDoctrine): TargetId => {
    switch (doctrine) {
      case 'bombard':
        return 'hull';
      case 'grind':
        return effLevel(state.player.subsystems.weapons) > 0 ? 'weapons' : 'hull';
      case 'aggressive':
      default:
        // Kill engines to stop the escape, then the weapons, then the hull.
        if (effLevel(state.player.subsystems.engines) > 0) return 'engines';
        if (effLevel(state.player.subsystems.weapons) > 0) return 'weapons';
        return 'hull';
    }
  };
  return state.enemy.weapons.map((slot) => {
    const def = weaponDef(weaponDefs, slot.defId);
    // Missiles always go for the hull — bypassing the shields is their point.
    if (def.type === 'missile') return 'hull';
    return pick(state.doctrine);
  });
}

function upkeep(ship: CombatShip, config: CombatConfig): void {
  // Shield regen (only while powered), capped by powered max.
  const cap = maxShieldLayers(ship);
  if (ship.power.shields > 0 && ship.shieldLayers < cap) {
    ship.shieldLayers = Math.min(cap, ship.shieldLayers + config.shieldRegenPerTurn);
  } else if (ship.shieldLayers > cap) {
    ship.shieldLayers = cap;
  }
  // Ion damage bleeds off as systems reboot.
  for (const id of SUBSYSTEM_IDS) {
    const sub = ship.subsystems[id];
    if (sub.damage > 0) sub.damage = Math.max(0, sub.damage - config.ionRegenPerTurn);
  }
  // Weapon cooldowns tick.
  for (const slot of ship.weapons) {
    if (slot.cooldownLeft > 0) slot.cooldownLeft -= 1;
  }
}

export function combatReduce(
  state: CombatState,
  action: CombatAction,
  weaponDefs: readonly WeaponDef[],
  config: CombatConfig,
): CombatState {
  if (state.outcome !== 'ongoing') return state;
  const next: CombatState = structuredClone(state);
  const rng = new Rng(next.rngState);
  const log: string[] = [];

  // Non-combat outs resolve immediately.
  if (action.type === 'SURRENDER') {
    if (!next.acceptsSurrender) {
      next.log = ['They do not take prisoners. There is only the fight.'];
      next.rngState = rng.getState();
      return next;
    }
    next.outcome = 'surrendered';
    next.log = ['You cut power to weapons and broadcast surrender. They take their due and go.'];
    return next;
  }
  if (action.type === 'BRIBE') {
    if (!next.acceptsBribe) {
      next.log = ['Your offer goes unanswered. Some things are not for sale.'];
      next.rngState = rng.getState();
      return next;
    }
    next.outcome = 'bribed';
    next.log = [`You buy them off. The scrap hurts less than the alternative.`];
    return next;
  }

  // Apply the player's chosen power allocation (their commit for the turn).
  next.player.power = clampPower(next.player, action.power);
  next.player.shieldLayers = Math.min(next.player.shieldLayers, maxShieldLayers(next.player));

  // SIMULTANEOUS RESOLUTION: both sides decide their turn independently, from
  // the turn-START state, BEFORE either volley lands. The enemy AI never sees
  // the player's choices, and neither volley's damage can cancel the other's
  // firing this turn (so a killing blow doesn't retroactively stop the enemy's
  // simultaneous shot). RNG order is fixed (player rolls, then enemy) purely
  // for deterministic replay — it does not make one side "react" to the other.
  const playerTargets: (TargetId | null)[] =
    action.type === 'FIRE' ? action.targets : next.player.weapons.map(() => null);
  const eTargets = enemyTargets(next, weaponDefs);
  const playerPlan = planVolley(next.player, playerTargets, weaponDefs);
  const enemyPlan = planVolley(next.enemy, eTargets, weaponDefs);

  if (action.type === 'FLEE') {
    next.player.fleeCharge += next.player.power.engines;
    log.push(
      next.player.power.engines > 0
        ? `You break for the dark — drive charging (${next.player.fleeCharge}/${next.fleeThreshold}).`
        : `No power to the engines — the drive can't charge.`,
    );
  }

  // Execute both pre-decided volleys against the live ships.
  fireVolley(next.player, next.enemy, playerTargets, playerPlan, weaponDefs, config, rng, log, 'You');
  fireVolley(next.enemy, next.player, eTargets, enemyPlan, weaponDefs, config, rng, log, next.enemy.name);

  // Evaluate outcomes AFTER both volleys. Player death takes precedence: mutual
  // destruction is a loss (you can't sail on at zero hull). Flagged decision.
  if (next.player.hull <= 0) {
    next.outcome = 'lost';
    log.push(
      next.enemy.hull <= 0
        ? 'You trade killing blows — both ships come apart in the same breath. The dark takes you too.'
        : 'Your hull fails. The dark rushes in.',
    );
    finish(next, rng, log);
    return next;
  }
  if (next.enemy.hull <= 0) {
    next.outcome = 'won';
    log.push(`The ${next.enemy.name} comes apart in the dark.`);
    finish(next, rng, log);
    return next;
  }

  // Upkeep for both ships.
  upkeep(next.player, config);
  upkeep(next.enemy, config);

  if (action.type === 'FLEE' && next.player.fleeCharge >= next.fleeThreshold) {
    next.outcome = 'fled';
    log.push('The drive catches — you tear a hole in space and are gone.');
  }

  next.turn += 1;
  next.log = log;
  next.rngState = rng.getState();
  return next;
}

function finish(state: CombatState, rng: Rng, log: string[]): void {
  state.log = log;
  state.rngState = rng.getState();
}
