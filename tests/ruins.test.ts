import { weapons, enemies, playerDef, wakeShipNames, newShip } from './fixtures';
import { describe, expect, it } from 'vitest';
import configJson from '../data/config.json';
import eventsJson from '../data/events/core.json';
import { createRun, currentSector, reduce, type Deps } from '../src/engine/reducer';
import { Rng } from '../src/engine/rng';
import type { GameConfig, RunState } from '../src/engine/types';
import { pickOutcome } from '../src/events/engine';
import type { EventDef, EventOutcome } from '../src/events/types';

const config = configJson as GameConfig;
const events = eventsJson as unknown as EventDef[];
const deps: Deps = { events, config, weapons, enemies, playerDef, wakeShipNames };

const decoyRuin = events.find((e) => e.id === 'ruin-silent-site') as EventDef;

describe('decoy ruin outcome distribution (patch §5)', () => {
  const excavate = decoyRuin.options[0];
  const N = 20000;

  function classify(outcome: EventOutcome): { danger: boolean; loot: boolean } {
    return {
      danger: outcome.tags?.includes('danger') ?? false,
      loot: outcome.tags?.includes('loot') ?? false,
    };
  }

  it('~30% of excavations turn dangerous; half of those still pay out', () => {
    let danger = 0;
    let dangerWithLoot = 0;
    for (let i = 0; i < N; i++) {
      const rng = Rng.fromString(`ruin-dist:${i}`);
      const c = classify(pickOutcome(excavate.outcomes, rng));
      if (c.danger) {
        danger++;
        if (c.loot) dangerWithLoot++;
      }
    }
    expect(danger / N).toBeCloseTo(0.3, 1);
    expect(dangerWithLoot / danger).toBeCloseTo(0.5, 1);
  });

  it('data contract: danger outcomes carry a cost; empty ones carry no gain', () => {
    for (const o of excavate.outcomes) {
      const fuel = o.effects?.fuel ?? 0;
      const scrap = o.effects?.scrap ?? 0;
      if (o.tags?.includes('danger')) {
        expect(fuel < 0 || scrap < 0, `danger outcome '${o.text.slice(0, 30)}…' has no cost`).toBe(
          true,
        );
      }
      if (o.tags?.includes('empty')) {
        expect(fuel).toBeLessThanOrEqual(0);
        expect(scrap).toBeLessThanOrEqual(0);
      }
      if (o.tags?.includes('loot')) {
        expect(scrap > 0 || fuel > 0).toBe(true);
      }
    }
  });

  it('distribution sampling is seed-deterministic', () => {
    const a = pickOutcome(excavate.outcomes, Rng.fromString('ruin-det'));
    const b = pickOutcome(excavate.outcomes, Rng.fromString('ruin-det'));
    expect(a).toEqual(b);
  });
});

describe('ruin routing in the reducer', () => {
  function toMap(seed: string): RunState {
    let s = createRun(seed, config, newShip());
    s = reduce(s, { type: 'FINISH_INTRO' }, deps);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, deps);
    s = reduce(s, { type: 'ACK_OUTCOME' }, deps);
    return s;
  }

  function placeAt(s: RunState, systemId: string): RunState {
    const next = structuredClone(s);
    next.currentSystemId = systemId;
    if (!next.visitOrder.includes(systemId)) next.visitOrder.push(systemId);
    next.fuel = 99;
    return next;
  }

  it('the SIGNAL ruin fires the fixed decode event', () => {
    let s = toMap('ruin-route-seed');
    const sector = currentSector(s, config);
    s = placeAt(s, sector.ruinSystemId);
    const node = sector.systems[sector.ruinSystemId].nodes.find((n) => n.type === 'ruin');
    s = reduce(s, { type: 'EXPLORE', nodeId: (node as { id: string }).id }, deps);
    expect(s.phase).toBe('event');
    const def = events.find((e) => e.id === s.activeEvent?.defId);
    expect(def?.trigger.fixed).toBe('sector-ruin');
  });

  it('a DECOY ruin fires a generic ruin event and never decodes the sector', () => {
    let s = toMap('ruin-route-seed');
    const sector = currentSector(s, config);
    expect(sector.extraRuinSystemIds.length).toBeGreaterThan(0);
    const decoyId = sector.extraRuinSystemIds[0];
    s = placeAt(s, decoyId);
    const node = sector.systems[decoyId].nodes.find((n) => n.type === 'ruin');
    s = reduce(s, { type: 'EXPLORE', nodeId: (node as { id: string }).id }, deps);
    expect(s.phase).toBe('event');
    const def = events.find((e) => e.id === s.activeEvent?.defId);
    expect(def?.trigger.fixed).toBeUndefined();
    expect(def?.trigger.nodeTypes).toContain('ruin');
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, deps);
    s = reduce(s, { type: 'ACK_OUTCOME' }, deps);
    expect(s.decodedSectorIndexes).not.toContain(s.sectorIndex);
  });
});
