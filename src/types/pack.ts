/** Pack format v1: the `pack.json` at the root of a pack repo. */
export const PACK_FORMAT_V1 = 'dnd-forge-pack@1';

export interface PackManifest {
  format: typeof PACK_FORMAT_V1;
  /** Lower-case id, letters/digits/hyphens: used to namespace entity ids (`<id>:<slug>`). */
  id: string;
  name: string;
  version: string;
  author?: string;
  license?: string;
  ruleset?: '2014' | '2024' | 'any';
  description?: string;
  /** Ids of other packs this one builds on (informational: the app warns when one is missing). */
  requires: string[];
  /** File paths or globs (`*`, `**`) of content files. */
  content: string[];
  /** File paths or globs of character files. */
  characters: string[];
  /** Optional JSON file with campaign binder entries. */
  campaign?: string;
}

/** A pack that is installed in this browser (the Dexie `packs` table). */
export interface InstalledPack {
  id: string;
  name: string;
  version: string;
  /** `owner/repo` */
  repo: string;
  /** The ref the user asked for ("" = the repo's default, treated as main). */
  ref: string;
  /** Commit sha the files were read from, when GitHub could tell us. */
  sha?: string;
  license?: string;
  requires?: string[];
  entityCount?: number;
  installedAt: string;
}
