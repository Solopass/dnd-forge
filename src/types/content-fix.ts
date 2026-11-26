export type ContentFixStatus = 'proposed' | 'approved' | 'rejected';

/** Changed fields only, keyed by path: "name", "range", "entries", "monsterMeta.ac", "activities.<activityId>.damageFormula". null removes a field. */
export type ContentFixPatch = Record<string, unknown>;

/** A reviewable correction to one compendium entry. Kept in its own table, separate from the source data. */
export interface ContentFix {
  id: string;
  entityId: string;
  /** Hash of the original entry when the fix was made; a mismatch later means the source changed (needs re-review). */
  baseSnapshotHash: string;
  patch: ContentFixPatch;
  note: string;
  /** "Player" or "DM" (the table role), optionally with a name: "Player (Mira)". */
  author: string;
  status: ContentFixStatus;
  createdAt: string;
  reviewedAt: string | null;
  /** The entry this fix points at is gone (its pack was uninstalled). Kept, not deleted; cleared if the entry returns. */
  orphaned?: boolean;
}
