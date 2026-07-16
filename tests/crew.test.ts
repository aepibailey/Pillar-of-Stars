import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifestJson from '../data/character-art-manifest.json';
import archetypesJson from '../data/recruit-archetypes.json';
import { newRun } from './fixtures';
import { addRecruit, canRecruit, MAX_CREW, setCompanion } from '../src/crew/slots';
import type { DownsideResource, RecruitArchetypes } from '../src/crew/types';
import type { Character } from '../src/engine/types';

const archetypes = (archetypesJson as unknown as RecruitArchetypes).archetypes;

const DOWNSIDES: DownsideResource[] = [
  'scrap',
  'morale',
  'reputation',
  'combat-risk',
  'narrative-risk',
  'time',
  'meta-knowledge',
];

function recruit(id: string): Character {
  return {
    id,
    name: `R-${id}`,
    role: 'crew',
    isFounder: false,
    speciesId: 'sp-0',
    archetype: 'mercenary',
    skills: [],
    traits: [],
    xp: 0,
    level: 1,
    unspentSkillPoints: 0,
    scars: [],
    alive: true,
  };
}

describe('recruitment archetype schema (§6.1 — architecture, not content)', () => {
  it('all 9 archetypes exist with a vector, a catch, and a valid downside type', () => {
    expect(archetypes).toHaveLength(9);
    const ids = archetypes.map((a) => a.id).sort();
    expect(ids).toEqual(
      [
        'debtor',
        'defector',
        'duelist',
        'long-shot',
        'mercenary',
        'prisoner',
        'salvage',
        'stowaway',
        'wide-eyed-adventurer',
      ].sort(),
    );
    for (const a of archetypes) {
      expect(a.vector.length).toBeGreaterThan(0);
      expect(a.catch.length).toBeGreaterThan(0);
      expect(DOWNSIDES).toContain(a.downside);
    }
  });

  it('content values are EMPTY by design (Phase 2 fills them)', () => {
    for (const a of archetypes) {
      expect(a.skills).toEqual([]);
      expect(a.traits).toEqual([]);
      expect(a.agendas).toEqual([]);
    }
  });

  it('every non-null artKey resolves in the art manifest', () => {
    const m = manifestJson as unknown as { characters: Record<string, unknown> };
    for (const a of archetypes) {
      if (a.artKey !== null) expect(m.characters[a.artKey]).toBeDefined();
    }
  });
});

describe('character-art manifest maps only files that actually exist', () => {
  const m = manifestJson as unknown as {
    spriteRoot: string;
    portraitRoot: string;
    fallbackKey: string;
    characters: Record<string, { sprites: Record<string, string>; portrait?: string }>;
  };

  it('every referenced sprite and portrait is on disk (exact filename)', () => {
    for (const [key, entry] of Object.entries(m.characters)) {
      for (const [dir, file] of Object.entries(entry.sprites)) {
        const p = join(process.cwd(), m.spriteRoot, file);
        expect(existsSync(p), `${key}/${dir} → ${file}`).toBe(true);
      }
      if (entry.portrait) {
        const p = join(process.cwd(), m.portraitRoot, entry.portrait);
        expect(existsSync(p), `${key}/portrait → ${entry.portrait}`).toBe(true);
      }
    }
  });

  it('the fallback key exists and has a front sprite', () => {
    expect(m.characters[m.fallbackKey]).toBeDefined();
    expect(m.characters[m.fallbackKey].sprites.front).toBeDefined();
  });
});

describe('crew slots (§6, §6.3)', () => {
  it('max crew is 4: two founders + two recruits, then the door closes', () => {
    const s = structuredClone(newRun('slots-seed'));
    expect(canRecruit(s)).toBe(true); // 2 founders aboard
    expect(addRecruit(s, recruit('r1'))).toBe(true);
    expect(addRecruit(s, recruit('r2'))).toBe(true);
    expect(s.characters.filter((c) => c.alive)).toHaveLength(MAX_CREW);
    expect(canRecruit(s)).toBe(false);
    expect(addRecruit(s, recruit('r3'))).toBe(false); // no berth left
    expect(s.characters).toHaveLength(4);
  });

  it('a death frees a berth', () => {
    const s = structuredClone(newRun('slots-seed'));
    addRecruit(s, recruit('r1'));
    addRecruit(s, recruit('r2'));
    s.characters.find((c) => c.id === 'r1')!.alive = false;
    expect(canRecruit(s)).toBe(true);
  });

  it('the companion slot only accepts a living, non-captain crew member', () => {
    const s = structuredClone(newRun('slots-seed'));
    addRecruit(s, recruit('r1'));
    expect(setCompanion(s, 'r1')).toBe(true);
    expect(s.companionId).toBe('r1');
    expect(setCompanion(s, s.captainId)).toBe(false); // captains can't be their own plus-one
    expect(setCompanion(s, 'ghost')).toBe(false);
    s.characters.find((c) => c.id === 'r1')!.alive = false;
    expect(setCompanion(s, 'r1')).toBe(false); // the dead don't board
    expect(setCompanion(s, null)).toBe(true); // clearing is always fine
  });
});
