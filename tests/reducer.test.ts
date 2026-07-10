import { describe, expect, it } from 'vitest';
import configJson from '../data/config.json';
import eventsJson from '../data/events/core.json';
import {
  createRun,
  currentSector,
  exploreCost,
  jumpCost,
  reduce,
  type Deps,
} from '../src/engine/reducer';
import type { GameConfig, RunState } from '../src/engine/types';
import type { EventDef } from '../src/events/types';
import { getSector } from '../src/galaxy/generate';

const config = configJson as GameConfig;
const events = eventsJson as unknown as EventDef[];
const deps: Deps = { events, config };

const SEED = 'reducer-test-seed';

function freshRun(): RunState {
  return createRun(SEED, config);
}

/** Run through intro + opener so we land on the map. */
function toMap(state: RunState = freshRun()): RunState {
  let s = reduce(state, { type: 'FINISH_INTRO' }, deps);
  s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, deps);
  s = reduce(s, { type: 'ACK_OUTCOME' }, deps);
  return s;
}

describe('run creation', () => {
  it('starts at the sector entry, in intro, with configured resources', () => {
    const s = freshRun();
    const sector = getSector(SEED, 0, config);
    expect(s.phase).toBe('intro');
    expect(s.currentSystemId).toBe(sector.entrySystemId);
    expect(s.fuel).toBe(config.startFuel);
    expect(s.scrap).toBe(config.startScrap);
    expect(s.visitOrder).toEqual([sector.entrySystemId]);
  });

  it('GUARDRAIL §6.4: run identity is not the captain', () => {
    const s = freshRun();
    expect(s.runId).toBeTruthy();
    expect(s.captainId).toBeTruthy();
    expect(s.runId).not.toBe(s.captainId);
    // captain is a reference into the roster, swappable without touching the run
    expect(s.characters.find((c) => c.id === s.captainId)?.role).toBe('captain');
  });

  it('is deterministic: same seed, same initial state', () => {
    expect(freshRun()).toEqual(freshRun());
  });
});

describe('opening flow (§12.0 → §9.3)', () => {
  it('intro flows into the data-flagged run-opener event', () => {
    const s = reduce(freshRun(), { type: 'FINISH_INTRO' }, deps);
    expect(s.phase).toBe('event');
    const def = events.find((e) => e.id === s.activeEvent?.defId);
    expect(def?.trigger.fixed).toBe('run-opener');
  });

  it('resolving the opener recovers the map and returns to the map screen', () => {
    const s = toMap();
    expect(s.phase).toBe('map');
    expect(s.flags['mapRecovered']).toBe(true);
    expect(s.activeEvent).toBeNull();
  });

  it('the waypoint is only meaningful after map recovery (flag gate)', () => {
    const s = freshRun();
    expect(s.flags['mapRecovered']).toBeUndefined();
  });
});

describe('jumping and fuel', () => {
  it('jumps along lanes cost fuel and update the trail', () => {
    const s = toMap();
    const sector = currentSector(s, config);
    const target = sector.systems[s.currentSystemId].links[0];
    const before = s.fuel;
    const after = reduce(s, { type: 'JUMP', toSystemId: target }, deps);
    expect(after.currentSystemId).toBe(target);
    expect(after.fuel).toBe(before - config.jumpFuelCost);
    expect(after.visitOrder).toContain(target);
    expect(after.stats.jumps).toBe(1);
  });

  it('rejects jumps to non-adjacent systems', () => {
    const s = toMap();
    const sector = currentSector(s, config);
    const here = sector.systems[s.currentSystemId];
    const far = sector.systemIds.find((id) => id !== here.id && !here.links.includes(id));
    expect(far).toBeTruthy();
    const after = reduce(s, { type: 'JUMP', toSystemId: far as string }, deps);
    expect(after).toBe(s); // unchanged reference = rejected
  });

  it('rejects jumps without fuel', () => {
    let s = toMap();
    s = { ...s, fuel: 0 };
    const sector = currentSector(s, config);
    const target = sector.systems[s.currentSystemId].links[0];
    const after = reduce(s, { type: 'JUMP', toSystemId: target }, deps);
    expect(after).toBe(s);
  });

  it('jumpCost prices Wake-held destinations by approach (total cost)', () => {
    let s = toMap();
    const sector = currentSector(s, config);
    const target = sector.systems[s.currentSystemId].links[0];
    expect(jumpCost(s, target, config)).toBe(config.jumpFuelCost);
    s = { ...s, wake: { ...s.wake, consumedIds: [target] } };
    expect(jumpCost(s, target, config, 'casual')).toBe(config.wakeSpace.casual.fuelCost);
    expect(jumpCost(s, target, config, 'fast')).toBe(config.wakeSpace.fast.fuelCost);
    expect(jumpCost(s, target, config, 'sneak')).toBe(config.wakeSpace.sneak.fuelCost);
    // approach pricing only applies to consumed space
    const other = sector.systems[s.currentSystemId].links.find((id) => id !== target) ?? target;
    if (other !== target) {
      expect(jumpCost(s, other, config, 'sneak')).toBe(config.jumpFuelCost);
    }
  });
});

describe('the Wake in play', () => {
  it('advances only after grace and consumes the trail', () => {
    let s = toMap();
    const jumpsToMake = config.wakeGraceJumps + 1;
    for (let i = 0; i < jumpsToMake && s.phase === 'map'; i++) {
      const sector = currentSector(s, config);
      const here = sector.systems[s.currentSystemId];
      // prefer an unvisited neighbor to keep moving forward
      const target = here.links.find((id) => !s.visitOrder.includes(id)) ?? here.links[0];
      s = reduce(s, { type: 'JUMP', toSystemId: target }, deps);
      if (s.phase === 'event') {
        s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, deps);
        s = reduce(s, { type: 'ACK_OUTCOME' }, deps);
      }
    }
    expect(s.wake.consumedIds.length).toBe(1);
    expect(s.wake.consumedIds[0]).toBe(s.visitOrder[0]); // oldest first — the entry
  });
});

describe('exploration and events', () => {
  it('exploring a node marks it and fires a data-driven event (or none)', () => {
    const s = toMap();
    const sector = currentSector(s, config);
    const node = sector.systems[s.currentSystemId].nodes[0];
    const after = reduce(s, { type: 'EXPLORE', nodeId: node.id }, deps);
    expect(after.exploredNodeIds).toContain(node.id);
    expect(['event', 'map', 'dead']).toContain(after.phase);
  });

  /** Teleport to a system with at least `minNodes` nodes (test-only). */
  function placeAtSystemWithNodes(s: RunState, minNodes: number): RunState {
    const sector = currentSector(s, config);
    const target = sector.systemIds
      .map((id) => sector.systems[id])
      .find((sys) => sys.nodes.length >= minNodes);
    expect(target, `no system with >=${minNodes} nodes in test sector`).toBeTruthy();
    const next = structuredClone(s);
    next.currentSystemId = (target as { id: string }).id;
    if (!next.visitOrder.includes(next.currentSystemId)) {
      next.visitOrder.push(next.currentSystemId);
    }
    return next;
  }

  it('exploration costs exploreFuelCost while 2+ nodes remain', () => {
    const s = placeAtSystemWithNodes(toMap(), 2);
    const sector = currentSector(s, config);
    const node = sector.systems[s.currentSystemId].nodes[0];
    const after = reduce(s, { type: 'EXPLORE', nodeId: node.id }, deps);
    expect(after.fuel).toBe(s.fuel - config.exploreFuelCost);
  });

  it('exploration is rejected without enough fuel for it', () => {
    let s = placeAtSystemWithNodes(toMap(), 2);
    s = { ...s, fuel: 0.1 };
    const sector = currentSector(s, config);
    const node = sector.systems[s.currentSystemId].nodes[0];
    const after = reduce(s, { type: 'EXPLORE', nodeId: node.id }, deps);
    expect(after).toBe(s);
  });

  it('the exploration that COMPLETES a system is free (patch2 §5)', () => {
    let s = placeAtSystemWithNodes(toMap(), 2);
    s = structuredClone(s);
    s.fuel = 99;
    const sector = currentSector(s, config);
    const here = sector.systems[s.currentSystemId];
    // Pre-mark all but one node explored (order-independent "last remaining").
    s.exploredNodeIds.push(...here.nodes.slice(0, -1).map((n) => n.id));
    const last = here.nodes[here.nodes.length - 1];
    expect(exploreCost(s, config)).toBe(0);
    const after = reduce(s, { type: 'EXPLORE', nodeId: last.id }, deps);
    expect(after.fuel).toBe(s.fuel); // free
    expect(after.exploredNodeIds).toContain(last.id);
  });

  it("a single-node system's only exploration is free (flagged edge of the literal rule)", () => {
    let s = toMap();
    const sector = currentSector(s, config);
    const single = sector.systemIds
      .map((id) => sector.systems[id])
      .find((sys) => sys.nodes.length === 1);
    if (!single) return; // this seed rolled no single-node system — rule covered above
    s = structuredClone(s);
    s.currentSystemId = single.id;
    if (!s.visitOrder.includes(single.id)) s.visitOrder.push(single.id);
    expect(exploreCost(s, config)).toBe(0);
  });

  it('at 0 fuel with one unexplored node left, the player is NOT stranded — the free closer remains', () => {
    let s = placeAtSystemWithNodes(toMap(), 2);
    s = structuredClone(s);
    const sector = currentSector(s, config);
    const here = sector.systems[s.currentSystemId];
    s.exploredNodeIds.push(...here.nodes.slice(0, -1).map((n) => n.id));
    s.fuel = 0;
    const last = here.nodes[here.nodes.length - 1];
    const after = reduce(s, { type: 'EXPLORE', nodeId: last.id }, deps);
    expect(after).not.toBe(s); // action accepted despite empty tanks
  });

  it('exploration advances the Wake by wakeAdvancePerExplore', () => {
    let s = toMap();
    s = structuredClone(s);
    s.wake.graceHundredths = 0; // grace spent — pursuit is live
    s.fuel = 99;
    const sector = currentSector(s, config);
    const node = sector.systems[s.currentSystemId].nodes[0];
    const after = reduce(s, { type: 'EXPLORE', nodeId: node.id }, deps);
    const spent =
      after.wake.progressHundredths +
      100 * after.wake.consumedIds.length -
      (s.wake.progressHundredths + 100 * s.wake.consumedIds.length);
    expect(spent).toBe(Math.round(config.wakeAdvancePerExplore * 100));
  });

  it('cannot explore the same node twice', () => {
    const s = toMap();
    const sector = currentSector(s, config);
    const node = sector.systems[s.currentSystemId].nodes[0];
    let after = reduce(s, { type: 'EXPLORE', nodeId: node.id }, deps);
    if (after.phase === 'event') {
      after = reduce(after, { type: 'RESOLVE_OPTION', optionIndex: 0 }, deps);
      after = reduce(after, { type: 'ACK_OUTCOME' }, deps);
    }
    const again = reduce(after, { type: 'EXPLORE', nodeId: node.id }, deps);
    expect(again).toBe(after);
  });

  it('event resolution is deterministic from state (save/resume safe)', () => {
    const s = toMap();
    const sector = currentSector(s, config);
    const node = sector.systems[s.currentSystemId].nodes[0];
    const a = reduce(s, { type: 'EXPLORE', nodeId: node.id }, deps);
    const b = reduce(structuredClone(s), { type: 'EXPLORE', nodeId: node.id }, deps);
    expect(a).toEqual(b);
  });
});

describe('ruin, gate, and winning (§14 definition of done)', () => {
  /** Teleport helper for tests: walk state to a system ignoring lanes. */
  function placeAt(s: RunState, systemId: string): RunState {
    const next = structuredClone(s);
    next.currentSystemId = systemId;
    if (!next.visitOrder.includes(systemId)) next.visitOrder.push(systemId);
    return next;
  }

  function decodeCurrentSector(s: RunState): RunState {
    const sector = currentSector(s, config);
    let next = placeAt(s, sector.ruinSystemId);
    const ruinNode = sector.systems[sector.ruinSystemId].nodes.find((n) => n.type === 'ruin');
    next = reduce(next, { type: 'EXPLORE', nodeId: (ruinNode as { id: string }).id }, deps);
    expect(next.phase).toBe('event');
    const def = events.find((e) => e.id === next.activeEvent?.defId);
    expect(def?.trigger.fixed).toBe('sector-ruin');
    next = reduce(next, { type: 'RESOLVE_OPTION', optionIndex: 0 }, deps);
    next = reduce(next, { type: 'ACK_OUTCOME' }, deps);
    return next;
  }

  it('the gate is locked until the sector ruin decodes the map leg', () => {
    let s = toMap();
    const sector = currentSector(s, config);
    s = placeAt(s, sector.gateSystemId);
    const locked = reduce(s, { type: 'ENTER_GATE' }, deps);
    expect(locked).toBe(s); // rejected
  });

  it('exploring the ruin node decodes the sector and unlocks the gate', () => {
    let s = toMap();
    s = decodeCurrentSector(s);
    expect(s.decodedSectorIndexes).toContain(0);
    const sector = currentSector(s, config);
    s = placeAt(s, sector.gateSystemId);
    const through = reduce(s, { type: 'ENTER_GATE' }, deps);
    expect(through.sectorIndex).toBe(1);
    expect(through.phase).toBe('map');
    // fresh sector: trail and Wake reset
    const s1 = getSector(SEED, 1, config);
    expect(through.currentSystemId).toBe(s1.entrySystemId);
    expect(through.visitOrder).toEqual([s1.entrySystemId]);
    expect(through.wake.consumedIds).toEqual([]);
  });

  it('reaching sector 3 wins the M1 build', () => {
    let s = toMap();
    for (let sectorIdx = 0; sectorIdx < 2; sectorIdx++) {
      s = decodeCurrentSector(s);
      const sector = currentSector(s, config);
      s = placeAt(s, sector.gateSystemId);
      s = reduce(s, { type: 'ENTER_GATE' }, deps);
    }
    expect(s.phase).toBe('won');
  });
});

describe('death', () => {
  it('stranded with no fuel and nothing to explore = dead (fuel)', () => {
    let s = toMap();
    const sector = currentSector(s, config);
    const here = sector.systems[s.currentSystemId];
    // Explore everything here, then set fuel to 0 and trigger a check via ACK path.
    s = structuredClone(s);
    s.exploredNodeIds = here.nodes.map((n) => n.id);
    s.fuel = 1;
    // jump away and back is complex; instead jump to a neighbor with fuel for exactly it
    const target = here.links[0];
    const targetNodes = sector.systems[target].nodes.map((n) => n.id);
    s.exploredNodeIds.push(...targetNodes);
    const after = reduce(s, { type: 'JUMP', toSystemId: target }, deps);
    expect(after.phase).toBe('dead');
    expect(after.deathCause).toBe('fuel');
  });

  it('being caught by the Wake ends the run', () => {
    let s = toMap();
    // Exhaust grace, then bounce between two systems until the front arrives.
    const maxSteps = 30;
    for (let i = 0; i < maxSteps && s.phase === 'map'; i++) {
      const sector = currentSector(s, config);
      const here = sector.systems[s.currentSystemId];
      const target = here.links[0];
      s = structuredClone(s);
      s.fuel = 99; // isolate the wake mechanic from fuel death
      s = reduce(s, { type: 'JUMP', toSystemId: target }, deps);
      if (s.phase === 'event') {
        s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, deps);
        s = reduce(s, { type: 'ACK_OUTCOME' }, deps);
      }
    }
    expect(s.phase).toBe('dead');
    expect(s.deathCause).toBe('wake');
  });
});
