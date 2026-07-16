/**
 * Crew & recruitment data model (§6.1) — M4 Phase 1 ARCHITECTURE. The 9
 * archetype ids live in engine/types (RecruitArchetypeId); this module holds
 * the data schema their content is authored against (Phase 2) and the slot
 * rules. Skill/trait/agenda VALUES are deliberately empty in the data for now.
 */

import type { RecruitArchetypeId } from '../engine/types';

/** §6.1: every catch costs you in one of these currencies. */
export type DownsideResource =
  | 'scrap'
  | 'morale'
  | 'reputation'
  | 'combat-risk'
  | 'narrative-risk'
  | 'time'
  | 'meta-knowledge';

export interface RecruitArchetypeDef {
  id: RecruitArchetypeId;
  name: string;
  /** How you get them aboard (§6.1's recruitment vector). */
  vector: string;
  /** The §6.1 catch, in words. */
  catch: string;
  downside: DownsideResource;
  /** Key into character-art-manifest.json; null = fallback art until generated. */
  artKey: string | null;
  // Phase-2 content pools (empty in Phase 1 by design):
  skills: { domain: string; level: number }[];
  traits: string[];
  agendas: string[];
}

export interface RecruitArchetypes {
  archetypes: RecruitArchetypeDef[];
}
