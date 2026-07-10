/**
 * The Wake — the hunter at your back (§4, §9.1).
 *
 * M1 pursuit model (designer-approved): the Wake follows the PLAYER'S OWN
 * TRAIL. They are hunting you specifically, so what they consume is the path
 * you actually took. Advance sources (playtest patch):
 *  - each inter-system jump advances the hunt by `wakeAdvancePerJump` (1.0)
 *  - each intra-system exploration advances it by `wakeAdvancePerExplore` (0.2)
 * After the grace period, every full jump of accumulated advance consumes the
 * oldest not-yet-consumed system in the player's first-visit order.
 *
 * All arithmetic is in integer HUNDREDTHS of a jump — fractional advances stay
 * exactly deterministic with no floating-point drift.
 *
 * Consumed systems can still be entered as a desperate transit at a cost (§4
 * "entering one is a desperate gamble"). If the Wake's front arrives at the
 * system you occupy — or the whole trail is eaten and the hunt's next meal is
 * you — you are caught.
 */

import type { WakeState } from '../engine/types';

export function toHundredths(jumps: number): number {
  return Math.round(jumps * 100);
}

export interface WakeAdvanceResult {
  wake: WakeState;
  /**
   * True if the front arrived where the player stands on this advance, or the
   * trail is fully consumed and a consumption was due. Deliberately NOT
   * `consumedIds.includes(current)`: transiting already-consumed space is a
   * survivable gamble.
   */
  caught: boolean;
}

export function createWakeState(graceJumps: number): WakeState {
  return { consumedIds: [], graceHundredths: toHundredths(graceJumps), progressHundredths: 0 };
}

export function advanceWake(
  wake: WakeState,
  visitOrder: readonly string[],
  currentSystemId: string,
  advanceJumps: number,
): WakeAdvanceResult {
  let amount = toHundredths(advanceJumps);
  let grace = wake.graceHundredths;
  if (grace > 0) {
    const absorbed = Math.min(grace, amount);
    grace -= absorbed;
    amount -= absorbed;
  }

  let progress = wake.progressHundredths + amount;
  const consumedIds = [...wake.consumedIds];
  let caught = false;
  while (progress >= 100) {
    progress -= 100;
    const next = visitOrder.find((id) => !consumedIds.includes(id));
    if (next === undefined) {
      // Whole trail eaten and another consumption is due: the next meal is you.
      caught = true;
      break;
    }
    consumedIds.push(next);
    if (next === currentSystemId) caught = true;
  }

  return {
    wake: { ...wake, consumedIds, graceHundredths: grace, progressHundredths: progress },
    caught,
  };
}

export function isConsumed(wake: WakeState, systemId: string): boolean {
  return wake.consumedIds.includes(systemId);
}

/** Jumps of advance left before the Wake reaches the player (UI readout). */
export function jumpsBehind(
  wake: WakeState,
  visitOrder: readonly string[],
  currentSystemId: string,
): number {
  const idx = visitOrder.indexOf(currentSystemId);
  const trail = idx === -1 ? visitOrder.length : idx + 1;
  const unconsumed = visitOrder
    .slice(0, trail)
    .filter((id) => !wake.consumedIds.includes(id)).length;
  return (wake.graceHundredths + unconsumed * 100 - wake.progressHundredths) / 100;
}
