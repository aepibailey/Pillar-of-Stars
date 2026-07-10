import type { DeathCause } from '../engine/types';
import type { NodeType } from '../galaxy/types';

/**
 * Data-driven event definitions (§10, §13). The engine never hardcodes an
 * event — content lives in /data/events/*.json and uses this schema.
 *
 * `trigger.fixed` marks structurally special events, still authored as data:
 *  - 'run-opener'      — fires automatically right after the intro (§9.3, the
 *                        opening ruin excavation). Every outcome MUST set the
 *                        'mapRecovered' flag or the run cannot progress.
 *  - 'sector-ruin'     — fires when the player explores the sector's SIGNAL
 *                        ruin. Every outcome MUST include decodeSector: true.
 *  - 'wake-fight'      — M1 placeholder for contact when entering Wake-held
 *                        space (patch §6). Swapped for the real ship-combat
 *                        state machine in M2.
 *  - 'wake-fight-fast' — same, for the 'move fast' approach: its flee option
 *                        carries reduced consequences.
 */

export interface EventEffects {
  fuel?: number;
  scrap?: number;
  /** Global flags to set true (e.g. 'mapRecovered'). */
  flags?: string[];
  /** Decode the current sector's map leg — unlocks its jump gate. */
  decodeSector?: boolean;
  /** Advance the Wake by this many jumps immediately (probe transmissions etc.). */
  wakeAdvance?: number;
  /** This outcome ends the run (applied on outcome acknowledgement). */
  death?: DeathCause;
}

/**
 * Optional data-side metadata on outcomes. The engine ignores tags entirely;
 * they exist so tests (and future tooling) can classify outcomes — e.g. the
 * ruin distribution contract uses 'danger' / 'loot' / 'empty'.
 */

export interface EventOutcome {
  weight: number;
  text: string;
  effects?: EventEffects;
  tags?: string[];
}

export interface EventOption {
  label: string;
  /** Resources the player must hold to pick this option (engine-enforced). */
  requires?: { scrap?: number; fuel?: number };
  outcomes: EventOutcome[];
}

export type FixedTrigger =
  | 'run-opener'
  | 'sector-ruin'
  | 'wake-fight'
  | 'wake-fight-fast'
  | 'stranded-tow'
  | 'stranded-robbery'
  | 'stranded-quiet';

export interface EventTrigger {
  nodeTypes?: NodeType[];
  fixed?: FixedTrigger;
}

export interface EventDef {
  id: string;
  title: string;
  text: string;
  trigger: EventTrigger;
  weight?: number;
  options: EventOption[];
}
