import { describe, expect, it } from 'vitest';
import eventsJson from '../data/events/core.json';
import { Rng } from '../src/engine/rng';
import { findFixedEvent, pickNodeEvent, pickOutcome } from '../src/events/engine';
import type { EventDef } from '../src/events/types';

const events = eventsJson as unknown as EventDef[];

describe('event data contracts (content is data, but data has rules)', () => {
  it('event ids are unique', () => {
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exactly one run-opener exists and EVERY outcome recovers the map', () => {
    const openers = events.filter((e) => e.trigger.fixed === 'run-opener');
    expect(openers.length).toBe(1);
    for (const option of openers[0].options) {
      for (const outcome of option.outcomes) {
        expect(outcome.effects?.flags ?? []).toContain('mapRecovered');
      }
    }
  });

  it('exactly one sector-ruin event exists and EVERY outcome decodes the sector', () => {
    const ruins = events.filter((e) => e.trigger.fixed === 'sector-ruin');
    expect(ruins.length).toBe(1);
    for (const option of ruins[0].options) {
      for (const outcome of option.outcomes) {
        expect(outcome.effects?.decodeSector).toBe(true);
      }
    }
  });

  it('every explorable node type has at least one authored event', () => {
    for (const type of ['planet', 'station', 'derelict', 'anomaly'] as const) {
      const pool = events.filter((e) => !e.trigger.fixed && e.trigger.nodeTypes?.includes(type));
      expect(pool.length, `no events for node type '${type}'`).toBeGreaterThan(0);
    }
  });

  it('all options have at least one outcome with positive total weight', () => {
    for (const def of events) {
      expect(def.options.length).toBeGreaterThan(0);
      for (const option of def.options) {
        const total = option.outcomes.reduce((s, o) => s + o.weight, 0);
        expect(total, `${def.id} option '${option.label}'`).toBeGreaterThan(0);
      }
    }
  });

  it('the run cannot fuel-starve to unwinnable-by-design: refuel effects exist', () => {
    const anyRefuel = events.some((e) =>
      e.options.some((o) => o.outcomes.some((out) => (out.effects?.fuel ?? 0) > 0)),
    );
    expect(anyRefuel).toBe(true);
  });
});

describe('event engine', () => {
  it('findFixedEvent returns the flagged event without id hardcoding', () => {
    expect(findFixedEvent(events, 'run-opener').trigger.fixed).toBe('run-opener');
    expect(findFixedEvent(events, 'sector-ruin').trigger.fixed).toBe('sector-ruin');
  });

  it('pickNodeEvent is deterministic given the same rng state', () => {
    const a = pickNodeEvent(events, 'planet', Rng.fromString('pick'));
    const b = pickNodeEvent(events, 'planet', Rng.fromString('pick'));
    expect(a?.id).toBe(b?.id);
  });

  it('pickNodeEvent never returns fixed-trigger events', () => {
    const rng = Rng.fromString('no-fixed');
    for (let i = 0; i < 100; i++) {
      const def = pickNodeEvent(events, 'planet', rng);
      expect(def?.trigger.fixed).toBeUndefined();
    }
  });

  it('pickOutcome is deterministic and respects weights', () => {
    const def = findFixedEvent(events, 'run-opener');
    const a = pickOutcome(def.options[0].outcomes, Rng.fromString('out'));
    const b = pickOutcome(def.options[0].outcomes, Rng.fromString('out'));
    expect(a).toEqual(b);
  });
});
