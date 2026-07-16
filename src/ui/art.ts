/**
 * Character art resolver. THE ONLY way art paths are looked up — filenames on
 * disk are inconsistently cased and (currently) live in an accidentally
 * double-nested directory, so nothing may construct a path by concatenation.
 * data/character-art-manifest.json maps logical keys → actual filenames; Vite's
 * import.meta.glob turns the real files into served URLs at build time.
 *
 * Fallback chain (art exists for only 3 of 9 archetypes right now):
 *   unknown key → manifest.fallbackKey; missing direction → 'front';
 *   missing portrait/file → null (caller renders nothing rather than a 404).
 */

import manifestJson from '../../data/character-art-manifest.json';

export type SpriteDirection = 'front' | 'back' | 'left' | 'right';

interface ArtManifest {
  spriteRoot: string;
  portraitRoot: string;
  fallbackKey: string;
  characters: Record<
    string,
    { sprites: Partial<Record<SpriteDirection, string>>; portrait?: string }
  >;
}

const manifest = manifestJson as unknown as ArtManifest;

// Bundle every png under /assets so each real file has a served URL, keyed by
// its repo path. `query: '?url'` = give us URLs, not module code.
const assetUrls = import.meta.glob('../../assets/**/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function urlFor(root: string, filename: string | undefined): string | null {
  if (!filename) return null;
  return assetUrls[`../../${root}/${filename}`] ?? null;
}

function entryFor(key: string | null | undefined) {
  if (key && manifest.characters[key]) return manifest.characters[key];
  return manifest.characters[manifest.fallbackKey];
}

/** Served URL for a character sprite, with key/direction/file fallbacks. */
export function spriteUrl(key: string | null | undefined, dir: SpriteDirection): string | null {
  const entry = entryFor(key);
  const filename = entry.sprites[dir] ?? entry.sprites.front;
  return urlFor(manifest.spriteRoot, filename);
}

/** Served URL for a character portrait, or null when none exists yet. */
export function portraitUrl(key: string | null | undefined): string | null {
  const entry = entryFor(key);
  return urlFor(manifest.portraitRoot, entry.portrait);
}

/** The founders' art keys — captain/spouse map by gender until the creator UI. */
export function founderArtKey(gender: 'M' | 'F' | undefined): string {
  return gender === 'F' ? 'main-female' : 'main-male';
}
