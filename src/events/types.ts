import type { NodeType } from '../galaxy/types';

/**
 * Data-driven event definitions (§10, §13). The engine never hardcodes an
 * event — content lives in /data/events/*.json and uses this schema.
 *
 * `trigger.fixed` marks structurally special events, still authored as data:
 *  - 'run-opener'  — fires automatically right after the intro (§9.3, the
 *                    opening ruin excavation). Every outcome MUST set the
 *                    'mapRecovered' flag or the run cannot progress.
 *  - 'sector-ruin' — fires when the player explores a sector's ruin node.
 *                    Every outcome MUST include decodeSector: true.
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
  outcomes: EventOutcome[];
}

export interface EventTrigger {
  nodeTypes?: NodeType[];
  fixed?: 'run-opener' | 'sector-ruin';
}

export interface EventDef {
  id: string;
  title: string;
  text: string;
  trigger: EventTrigger;
  weight?: number;
  options: EventOption[];
}
