import type { Rng } from '../engine/rng';
import type { NodeType } from '../galaxy/types';
import type { EventDef, EventOutcome } from './types';

/** Find a fixed-trigger event. Deterministic: lowest id wins if data has several. */
export function findFixedEvent(
  defs: readonly EventDef[],
  fixed: 'run-opener' | 'sector-ruin',
): EventDef {
  const matches = defs
    .filter((d) => d.trigger.fixed === fixed)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (matches.length === 0) throw new Error(`No event with fixed trigger '${fixed}' in data`);
  return matches[0];
}

/** Weighted pick among events whose trigger matches the node type. */
export function pickNodeEvent(
  defs: readonly EventDef[],
  nodeType: NodeType,
  rng: Rng,
): EventDef | null {
  const pool = defs.filter((d) => !d.trigger.fixed && d.trigger.nodeTypes?.includes(nodeType));
  if (pool.length === 0) return null;
  return rng.weighted(pool, (d) => d.weight ?? 1);
}

export function pickOutcome(outcomes: readonly EventOutcome[], rng: Rng): EventOutcome {
  return rng.weighted(outcomes, (o) => o.weight);
}

export function getEvent(defs: readonly EventDef[], id: string): EventDef {
  const def = defs.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown event id '${id}'`);
  return def;
}
