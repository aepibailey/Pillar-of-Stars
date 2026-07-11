/**
 * ONE coherent sensor-accuracy engine (§7.4 + designer's 5-level sensor decision).
 *
 * Every "read" in the game — an enemy's threat band, the odds a destroyed Wake
 * probe transmitted, whether a sneak was spotted, what the next system holds —
 * flows through here. The single knob is the ship's effective SENSOR LEVEL
 * (0..5): higher = more accurate AND more detailed, *across the board*, not just
 * unlocking tiers. Damaged sensors drop the effective level; at 0 you get
 * UNKNOWN and are gambling blind (§7.4).
 *
 * Reads are PURE and SEEDED: a read is a deterministic function of
 * (trueValue, tier, seed, salt), so it's stable across re-renders and survives
 * save/resume without storing the fuzzed result. Pass a per-subject stable seed
 * (e.g. `${runSeed}:threat:${encounterId}`) and a salt naming the read.
 */

import { Rng } from '../engine/rng';
import type { ThreatBand } from '../combat/types';

/** Threat bands in ascending danger. UNKNOWN is "no usable read", not a rank. */
export const THREAT_ORDER = ['GREEN', 'SEASONED', 'VETERAN', 'ELITE'] as const;
export type KnownBand = (typeof THREAT_ORDER)[number];

export type Confidence = 'none' | 'vague' | 'rough' | 'solid' | 'exact';

/** Clamp a sensor subsystem's effective level onto the 0..5 accuracy scale. */
export function sensorTier(effSensorLevel: number): number {
  return Math.max(0, Math.min(5, Math.round(effSensorLevel)));
}

/**
 * Per-tier accuracy profile. `spread` = how far the band estimate can drift from
 * the truth (0 = exact); `detail` = how much crew intel comes through
 * (0 none · 1 lifesign count · 2 count+role · 3 full manifest). Monotonic: the
 * band sharpens over tiers 1→3, then the manifest fills in over 3→5.
 */
const TIERS: Record<number, { spread: number; confidence: Confidence; detail: number }> = {
  1: { spread: 2, confidence: 'vague', detail: 0 },
  2: { spread: 1, confidence: 'rough', detail: 0 },
  3: { spread: 0, confidence: 'solid', detail: 1 },
  4: { spread: 0, confidence: 'solid', detail: 2 },
  5: { spread: 0, confidence: 'exact', detail: 3 },
};

/** A seeded integer offset in [-spread, +spread], biased toward 0 (two-die avg). */
function seededDrift(rng: Rng, spread: number): number {
  if (spread <= 0) return 0;
  const a = rng.int(-spread, spread);
  const b = rng.int(-spread, spread);
  return Math.round((a + b) / 2);
}

export interface ThreatRead {
  /** What to display — may be UNKNOWN. */
  band: ThreatBand;
  confidence: Confidence;
  /** Optional sharper intel (crew count / manifest) at high sensor tiers. */
  detail: string | null;
}

/**
 * Read an enemy's threat band through the sensors. `crew` (optional) drives the
 * high-tier manifest detail; when absent the detail line is omitted.
 */
export function readThreat(
  trueBand: KnownBand,
  tier: number,
  seed: string,
  crew?: { count: number; note?: string },
): ThreatRead {
  const t = sensorTier(tier);
  if (t <= 0) return { band: 'UNKNOWN', confidence: 'none', detail: null };
  const prof = TIERS[t];
  const rng = Rng.fromString(seed, `threat:t${t}`);
  const trueIdx = THREAT_ORDER.indexOf(trueBand);
  const shownIdx = Math.max(0, Math.min(THREAT_ORDER.length - 1, trueIdx + seededDrift(rng, prof.spread)));
  const band = THREAT_ORDER[shownIdx];

  let detail: string | null = null;
  if (crew && prof.detail >= 1) {
    if (prof.detail === 1) {
      // Fuzzy lifesign count: a small seeded range around the truth.
      const jitter = Rng.fromString(seed, 'crew:count').int(0, 1);
      detail = `lifesigns ~${Math.max(1, crew.count - jitter)}–${crew.count + jitter}`;
    } else if (prof.detail === 2) {
      detail = `${crew.count} crew`;
    } else {
      detail = crew.note ? `${crew.count} crew · ${crew.note}` : `${crew.count} crew`;
    }
  }
  return { band, confidence: prof.confidence, detail };
}

export interface ProbabilityRead {
  /** Best estimate of the probability (0..1), or null when sensors can't tell. */
  estimate: number | null;
  /** Human phrasing: a word band at low tiers, a rough % at high tiers. */
  text: string;
  confidence: Confidence;
}

/**
 * Read a hidden probability (probe transmit odds, spotted-while-sneaking odds,
 * loot quality). Low sensors give a fuzzy word ("likely"); high sensors give a
 * rough percentage. The estimate never claims more precision than the tier earns.
 */
export function readProbability(
  trueP: number,
  tier: number,
  seed: string,
  salt: string,
): ProbabilityRead {
  const t = sensorTier(tier);
  if (t <= 0) return { estimate: null, text: 'no reading', confidence: 'none' };
  const prof = TIERS[t];
  const rng = Rng.fromString(seed, `prob:${salt}:t${t}`);
  // Noise shrinks with tier: ±0.32 at tier 1 down to 0 at tier 5.
  const amp = ((5 - t) / 5) * 0.4;
  const est = Math.max(0, Math.min(1, trueP + rng.range(-amp, amp)));

  if (t <= 2) {
    const word = est < 0.15 ? 'unlikely' : est < 0.45 ? 'possible' : est < 0.75 ? 'likely' : 'near-certain';
    return { estimate: est, text: `${word}?`, confidence: prof.confidence };
  }
  const step = t >= 5 ? 0.05 : 0.1; // finer rounding only at max sensors
  const pct = Math.round(est / step) * step * 100;
  return { estimate: est, text: `~${Math.round(pct)}%`, confidence: prof.confidence };
}
