import { describe, expect, it } from 'vitest';
import configJson from '../data/config.json';
import eventsJson from '../data/events/core.json';
import { createRun, reduce, type Deps } from '../src/engine/reducer';
import { Rng } from '../src/engine/rng';
import type { GameConfig, RunState } from '../src/engine/types';
import { pickOutcome } from '../src/events/engine';
import type { EventDef } from '../src/events/types';
import { getSector } from '../src/galaxy/generate';
import { toHundredths } from '../src/threat/wake';

const config = configJson as GameConfig;
const events = eventsJson as unknown as EventDef[];

const probe = events.find((e) => e.id === 'any-wake-probe') as EventDef;

function sampleTags(optionIndex: number, samples: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < samples; i++) {
    const rng = Rng.fromString(`probe-dist:${i}`);
    const outcome = pickOutcome(probe.options[optionIndex].outcomes, rng);
    const tag = outcome.tags?.[0] ?? 'untagged';
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

describe('Wake probe outcome distribution (playtest patch §3)', () => {
  const N = 20000;

  it('destroy: ~70% clean / ~10% noticed (+1) / ~20% transmitted (+2)', () => {
    const counts = sampleTags(0, N);
    expect((counts.get('clean') ?? 0) / N).toBeCloseTo(0.7, 1);
    expect((counts.get('noticed') ?? 0) / N).toBeCloseTo(0.1, 1);
    expect((counts.get('transmitted') ?? 0) / N).toBeCloseTo(0.2, 1);
  });

  it('sneak: ~50% clean / ~50% spotted (+1)', () => {
    const counts = sampleTags(1, N);
    expect((counts.get('clean') ?? 0) / N).toBeCloseTo(0.5, 1);
    expect((counts.get('spotted') ?? 0) / N).toBeCloseTo(0.5, 1);
  });

  it('weights encode the advance sizes from the spec (data contract)', () => {
    const [destroy, sneak] = probe.options;
    const byTag = (opt: typeof destroy, tag: string) =>
      opt.outcomes.find((o) => o.tags?.includes(tag));
    expect(byTag(destroy, 'clean')?.effects?.wakeAdvance ?? 0).toBe(0);
    expect(byTag(destroy, 'noticed')?.effects?.wakeAdvance).toBe(1);
    expect(byTag(destroy, 'transmitted')?.effects?.wakeAdvance).toBe(2);
    expect(byTag(sneak, 'clean')?.effects?.wakeAdvance ?? 0).toBe(0);
    expect(byTag(sneak, 'spotted')?.effects?.wakeAdvance).toBe(1);
  });

  it('sampling is seed-deterministic', () => {
    const rngA = Rng.fromString('probe-det');
    const rngB = Rng.fromString('probe-det');
    expect(pickOutcome(probe.options[0].outcomes, rngA)).toEqual(
      pickOutcome(probe.options[0].outcomes, rngB),
    );
  });
});

describe('wakeAdvance effect integration', () => {
  // Synthetic deps: a rigged event whose only outcome always advances the
  // Wake by 2 — proves the effect path without depending on rng luck.
  const riggedEvent: EventDef = {
    id: 'test-probe-rigged',
    title: 'Rigged',
    text: 'test',
    trigger: { nodeTypes: ['planet', 'station', 'derelict', 'anomaly'] },
    options: [
      {
        label: 'go',
        outcomes: [{ weight: 1, text: 'transmitted', effects: { wakeAdvance: 2 } }],
      },
    ],
  };
  const opener = events.find((e) => e.trigger.fixed === 'run-opener') as EventDef;
  const ruin = events.find((e) => e.trigger.fixed === 'sector-ruin') as EventDef;
  const riggedDeps: Deps = { events: [opener, ruin, riggedEvent], config };

  function toMapRigged(): RunState {
    let s = createRun('probe-int-seed', config);
    s = reduce(s, { type: 'FINISH_INTRO' }, riggedDeps);
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, riggedDeps);
    s = reduce(s, { type: 'ACK_OUTCOME' }, riggedDeps);
    return s;
  }

  it('applies the advance through grace/progress exactly', () => {
    let s = toMapRigged();
    // Explore a non-ruin node to fire the rigged event.
    const sec = getSector(s.seed, 0, config);
    const node = sec.systems[s.currentSystemId].nodes.find((n) => n.type !== 'ruin');
    expect(node).toBeTruthy();
    const before = s.wake;
    s = reduce(s, { type: 'EXPLORE', nodeId: (node as { id: string }).id }, riggedDeps);
    expect(s.phase).toBe('event');
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, riggedDeps);

    // Total advance since map start = explore (0.2) + wakeAdvance (2) = 2.2 jumps.
    const expected = toHundredths(config.wakeAdvancePerExplore) + toHundredths(2);
    const spentGrace = before.graceHundredths - s.wake.graceHundredths;
    const gainedProgress =
      s.wake.progressHundredths -
      before.progressHundredths +
      100 * (s.wake.consumedIds.length - before.consumedIds.length);
    expect(spentGrace + gainedProgress).toBe(expected);
  });

  it('a wakeAdvance that catches the player kills on ACK, after the text is read', () => {
    let s = toMapRigged();
    s = structuredClone(s);
    // No grace left and the trail is just the entry system the player stands on.
    s.wake = { consumedIds: [], graceHundredths: 0, progressHundredths: 0 };
    const sec = getSector(s.seed, 0, config);
    const node = sec.systems[s.currentSystemId].nodes.find((n) => n.type !== 'ruin');
    s = reduce(s, { type: 'EXPLORE', nodeId: (node as { id: string }).id }, riggedDeps);
    expect(s.phase).toBe('event'); // survived the 0.2 explore advance
    s = reduce(s, { type: 'RESOLVE_OPTION', optionIndex: 0 }, riggedDeps);
    expect(s.phase).toBe('event'); // still reading the outcome
    expect(s.deathCause).toBe('wake');
    s = reduce(s, { type: 'ACK_OUTCOME' }, riggedDeps);
    expect(s.phase).toBe('dead');
  });
});
