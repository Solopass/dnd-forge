import type { RawCharacterState } from '../types/character';

export type CharacterJsonResult =
  | { ok: true; character: RawCharacterState }
  | { ok: false; reason: string };

/** Parses a character JSON file's text; on failure says why, so the UI can report it. */
export function parseCharacterJson(text: string): CharacterJsonResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `not valid JSON (${detail})` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'the file is not a single character object' };
  }
  const obj = parsed as Record<string, unknown>;
  const missing: string[] = [];
  if (typeof obj.name !== 'string' || !obj.name.trim()) missing.push('name');
  if (!Array.isArray(obj.classes)) missing.push('classes');
  if (missing.length > 0) {
    return { ok: false, reason: `missing ${missing.join(' and ')}, so it does not look like a character export` };
  }
  return { ok: true, character: obj as unknown as RawCharacterState };
}
