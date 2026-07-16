/**
 * XP / veterancy growth (§6.05). Pure helpers the reducer calls — growth is
 * strictly in-run (a NEW_RUN builds fresh characters; nothing here persists).
 *
 * Model: flat data-tuned cost per level; each level banks one skill raise
 * (spending UI comes with the crew screen); MILESTONE levels roll a second
 * trait from a data pool filtered by what the character has actually lived
 * through ("Boarding Veteran" only appears if they've survived boardings —
 * §6.05). Veterancy tiers mirror the §7.4 threat bands.
 */

import type { Rng } from '../engine/rng';
import type { ThreatBand } from '../combat/types';
import type { Character } from '../engine/types';

export interface MilestoneTraitDef {
  id: string;
  name: string;
  note: string;
  /** History gate: only rolled if the run's history matches (null = always). */
  requires: 'boarding' | 'ship-combat' | 'contact' | null;
}

export interface GrowthConfig {
  xpPerLevel: number;
  milestoneLevels: number[];
  /** Level floors for the bands above GREEN (below the lowest = GREEN). */
  tierThresholds: { SEASONED: number; VETERAN: number; ELITE: number };
  awards: {
    shipFightWon: number;
    boardingResolved: number;
    firstContact: number;
    discovery: number;
    questResolved: number;
  };
  milestoneTraitPool: MilestoneTraitDef[];
}

/** What this run has actually been through — gates the milestone trait roll. */
export interface GrowthHistory {
  boarding: boolean;
  'ship-combat': boolean;
  contact: boolean;
}

/** Veterancy tier from level (§6.05): GREEN → SEASONED → VETERAN → ELITE. */
export function tierForLevel(level: number, growth: GrowthConfig): ThreatBand {
  const t = growth.tierThresholds;
  if (level >= t.ELITE) return 'ELITE';
  if (level >= t.VETERAN) return 'VETERAN';
  if (level >= t.SEASONED) return 'SEASONED';
  return 'GREEN';
}

/**
 * Grant XP and resolve any level-ups (mutates the draft character,
 * reducer-style). Each level banks a skill point; milestone levels roll a
 * second trait from the history-eligible pool (deterministic via the caller's
 * rng cursor; never a duplicate of one already carried).
 */
export function grantXp(
  ch: Character,
  amount: number,
  growth: GrowthConfig,
  history: GrowthHistory,
  rng: Rng,
): void {
  if (!ch.alive || amount <= 0) return;
  ch.xp += amount;
  while (ch.xp >= growth.xpPerLevel) {
    ch.xp -= growth.xpPerLevel;
    ch.level += 1;
    ch.unspentSkillPoints += 1;
    if (growth.milestoneLevels.includes(ch.level)) {
      const eligible = growth.milestoneTraitPool.filter(
        (t) => (t.requires === null || history[t.requires]) && !ch.traits.includes(t.id),
      );
      if (eligible.length > 0) {
        ch.traits.push(eligible[Math.floor(rng.next() * eligible.length)].id);
      }
    }
  }
}
