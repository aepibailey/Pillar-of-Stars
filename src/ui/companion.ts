/**
 * Pure companion-UI helpers (§6.3/§6.4). Kept DOM-free and out of the App class
 * so the render path is unit-testable without a browser — the M4 companion was
 * invisible precisely because nothing rendered it, so this logic is the
 * regression surface and deserves direct tests.
 */

import { COMPANION_ID } from '../ground/engine';
import type { GroundState } from '../ground/types';
import type { Gender, RunState } from '../engine/types';

function hbar(cur: number, max: number, label: string): string {
  const pct = Math.max(0, Math.round((cur / max) * 100));
  return `<div class="hbar"><div class="hfill" style="width:${pct}%"></div><span>${label}</span></div>`;
}

/**
 * The §6.3 companion panel HTML, or '' when no companion boarded this scene.
 * Display only (the companion auto-acts). Stays visible when downed — muted,
 * with the down tag — so the player sees the body, not a vanished card.
 */
export function companionCardHtml(g: GroundState): string {
  const comp = g.fighters.find((f) => f.id === COMPANION_ID);
  if (!comp) return '';
  const zone = g.zones.find((z) => z.id === comp.zoneId);
  const downTag = comp.down ? ` <span class="downtag">${comp.down}</span>` : '';
  const suppressed = comp.suppressed ? ' · suppressed' : '';
  const line =
    comp.down === null ? `heat ${comp.heat}/${comp.heatMax} · ${zone?.name ?? ''}${suppressed}` : 'down';
  return `
    <div class="shipstat mine companion ${comp.down ? 'down' : ''}">
      <div class="sname">${comp.name}${downTag}</div>
      ${hbar(comp.hp, comp.hpMax, `HP ${comp.hp}/${comp.hpMax}`)}
      <div class="dim">${line}</div>
    </div>`;
}

/** What a companion-death beat needs to render, or null when none is pending. */
export interface CompanionBeat {
  name: string;
  /** Founder death additionally locks ASCEND (§9.4) — drives the extra line. */
  isFounder: boolean;
  gender: Gender | undefined;
}

/**
 * The §6.4 full-screen companion-death beat (R3): a founder falling interrupts
 * the fight. Fires only MID-fight (outcome still ongoing — a same-turn captain
 * death routes to succession/death instead) and only for a companion whose
 * down state is 'killed'. Pure decision; the App gates it to once-per-scene by
 * readSeed and resolves the portrait. Returns null when no beat is pending.
 */
export function pendingCompanionBeat(state: RunState): CompanionBeat | null {
  const g = state.ground;
  if (!g || g.outcome !== 'ongoing') return null;
  const comp = g.fighters.find((f) => f.id === COMPANION_ID);
  if (comp?.down !== 'killed') return null;
  const char = state.characters.find((c) => c.id === state.companionId);
  return { name: comp.name, isFounder: char?.isFounder ?? false, gender: char?.gender };
}
