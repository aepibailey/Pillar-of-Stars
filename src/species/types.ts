/**
 * Species, cultures, factions (§8) — the signature system. Every run generates
 * 4–6 major species from data-driven component pools, plus a disposition matrix
 * of wars/alliances/grudges between them. All of it derives PURELY from the run
 * seed: nothing generated here is stored in RunState — only the player's
 * mutations (standing, contact history) are state.
 */

export interface MorphologyDef {
  id: string;
  name: string;
  adjective: string;
  /** Pre-contact sensor blurb — the first-contact flow's opening read. */
  sensorReading: string;
}

export interface GovernmentDef {
  id: string;
  name: string;
  adjective: string;
  styleNote: string;
}

export interface ValueDef {
  id: string;
  name: string;
  /** The hook Phase-2 event content keys off. */
  eventNote: string;
}

export interface SpeciesNameParts {
  prefixes: string[];
  middles: string[];
  suffixes: string[];
}

/** All the component pools, loaded from /data/species-parts/*.json. */
export interface SpeciesParts {
  morphologies: MorphologyDef[];
  governments: GovernmentDef[];
  values: ValueDef[];
  names: SpeciesNameParts;
}

/** One generated major species. Deterministic from (seed, parts). */
export interface Species {
  /** Stable within the run: 'sp-0'..'sp-N' in generation order. */
  id: string;
  name: string;
  morphologyId: string;
  governmentId: string;
  /** 2–3 cultural values (§8) — drive event logic. */
  valueIds: string[];
}

/** Baseline stance between two species in the generated matrix (§8). */
export type Relation = 'war' | 'alliance' | 'grudge' | 'neutral';

/** Unordered-pair key → relation. Use pairKey() to build keys. */
export type DispositionMatrix = Record<string, Relation>;
