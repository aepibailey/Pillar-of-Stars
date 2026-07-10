/**
 * The Wake — the hunter at your back (§4, §9.1).
 *
 * M1 pursuit model (designer-approved): the Wake follows the PLAYER'S OWN
 * TRAIL. They are hunting you specifically, so what they consume is the path
 * you actually took: after a grace period, each player jump lets the Wake
 * consume the oldest not-yet-consumed system in your first-visit order.
 * Standing still (exploring nodes) does not advance the Wake — jumps do.
 *
 * Consumed systems can still be entered as a desperate transit at extra fuel
 * cost (§4 "entering one is a desperate gamble" — combat odds arrive in M2+).
 * If the Wake consumes the system you are IN, they have found you: death.
 */

import type { WakeState } from '../engine/types';

export interface WakeAdvanceResult {
  wake: WakeState;
  /**
   * True if the Wake consumed the player's current system ON THIS ADVANCE.
   * Deliberately not `consumedIds.includes(current)`: the player is allowed to
   * transit already-consumed space (at extra fuel cost) — that's the gamble.
   * Being caught means the front arrived where you're standing.
   */
  caught: boolean;
}

export function createWakeState(graceJumps: number): WakeState {
  return { consumedIds: [], graceRemaining: graceJumps };
}

export function advanceWake(
  wake: WakeState,
  visitOrder: readonly string[],
  currentSystemId: string,
  consumesPerJump: number,
): WakeAdvanceResult {
  if (wake.graceRemaining > 0) {
    return {
      wake: { ...wake, graceRemaining: wake.graceRemaining - 1 },
      caught: false,
    };
  }
  const consumedIds = [...wake.consumedIds];
  const newlyConsumed: string[] = [];
  for (let i = 0; i < consumesPerJump; i++) {
    const next = visitOrder.find((id) => !consumedIds.includes(id));
    if (next === undefined) break;
    consumedIds.push(next);
    newlyConsumed.push(next);
  }
  // Caught if the front arrived where you stand — or if the whole trail is
  // already eaten, in which case the hunt's next meal is you. (The player is
  // always on their own trail, so "nothing left to consume" ⇒ you're inside
  // fully-overrun space with the hunters closing.)
  const caught = newlyConsumed.includes(currentSystemId) || newlyConsumed.length === 0;
  return {
    wake: { ...wake, consumedIds },
    caught,
  };
}

export function isConsumed(wake: WakeState, systemId: string): boolean {
  return wake.consumedIds.includes(systemId);
}

/** Jumps the player could stand still before the Wake reaches them (UI readout). */
export function jumpsBehind(
  wake: WakeState,
  visitOrder: readonly string[],
  currentSystemId: string,
): number {
  const idx = visitOrder.indexOf(currentSystemId);
  const trail = idx === -1 ? visitOrder.length : idx + 1;
  const unconsumedBeforeAndIncluding = visitOrder
    .slice(0, trail)
    .filter((id) => !wake.consumedIds.includes(id)).length;
  return wake.graceRemaining + unconsumedBeforeAndIncluding;
}
