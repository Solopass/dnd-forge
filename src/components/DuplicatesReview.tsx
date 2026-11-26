import { useMemo, useState } from 'react';
import {
  findNearDuplicates,
  sourceTierOf,
  SOURCE_TIER_LABELS,
  type DuplicateAction,
  type DuplicateDecision,
  type NearDuplicateGroup,
  type SourceTier,
} from '../engine/compendium-dedupe';
import type { CompendiumEntity } from '../types/compendium';

interface DuplicatesReviewProps {
  entities: readonly CompendiumEntity[];
  priority: readonly SourceTier[];
  decisions: readonly DuplicateDecision[];
  onResolve: (group: NearDuplicateGroup, action: DuplicateAction, keepId?: string) => void | Promise<void>;
  onUndo: (groupId: string) => void | Promise<void>;
}

const ACTION_LABEL: Record<DuplicateAction, string> = {
  'keep-one': 'Kept one',
  'keep-both': 'Kept both',
  merge: 'Merged',
};

function describe(e: CompendiumEntity): string {
  const bits: string[] = [SOURCE_TIER_LABELS[sourceTierOf(e)].split(' (')[0]!, e.source, e.ruleset];
  if (e.spellLevel !== undefined) bits.push(e.spellLevel === 0 ? 'Cantrip' : `Level ${e.spellLevel}`);
  if (e.monsterMeta?.cr !== undefined) bits.push(`CR ${e.monsterMeta.cr}`);
  return bits.join(' • ');
}

/** Lists possible (near) duplicates; exact duplicates are already folded automatically. Nothing here deletes data. */
export function DuplicatesReview({ entities, priority, decisions, onResolve, onUndo }: DuplicatesReviewProps) {
  const groups = useMemo(() => findNearDuplicates(entities, priority), [entities, priority]);
  const [showResolved, setShowResolved] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const decided = new Map(decisions.map((d) => [d.id, d]));
  const open = groups.filter((g) => !decided.has(g.id));
  const resolved = groups.filter((g) => decided.has(g.id));
  const shown = showResolved ? groups : open;

  return (
    <div className="forge-stack">
      <div className="forge-row-between wrap gap-2">
        <div className="forge-muted">
          <span className="tabular">{open.length}</span> possible duplicate group{open.length === 1 ? '' : 's'} to review
          {resolved.length > 0 && (
            <>
              , <span className="tabular">{resolved.length}</span> resolved
            </>
          )}
          . Exact duplicates are already folded automatically.
        </div>
        <button type="button" className={`pill ${showResolved ? 'active' : ''}`} onClick={() => setShowResolved((v) => !v)}>
          Show resolved
        </button>
      </div>
      {shown.length === 0 && <div className="forge-muted">No possible duplicates to review.</div>}
      {shown.slice(0, 100).map((group) => {
        const decision = decided.get(group.id);
        const keepId = picked[group.id] ?? decision?.keepId ?? group.members[0]!.id;
        return (
          <div key={group.id} className="card forge-stack" data-testid="dup-group">
            <div className="forge-section-label">
              {group.category.toUpperCase()}: {group.members.map((m) => m.name).join(' / ')}
            </div>
            <div className="forge-stack">
              {group.members.map((m) => (
                <label key={m.id} className="forge-row gap-2">
                  <input
                    type="radio"
                    name={`keep-${group.id}`}
                    checked={keepId === m.id}
                    disabled={!!decision}
                    onChange={() => setPicked((p) => ({ ...p, [group.id]: m.id }))}
                  />
                  <span>
                    <strong>{m.name}</strong> <span className="forge-muted text-sm">{describe(m)}</span>
                  </span>
                </label>
              ))}
            </div>
            {decision ? (
              <div className="forge-row-between gap-2">
                <span className="badge">{ACTION_LABEL[decision.action]}</span>
                <button type="button" className="btn" onClick={() => void onUndo(group.id)}>
                  Undo
                </button>
              </div>
            ) : (
              <div className="forge-row gap-2 wrap">
                <button type="button" className="btn btn-primary" onClick={() => void onResolve(group, 'keep-one', keepId)}>
                  Keep one (selected)
                </button>
                <button type="button" className="btn" onClick={() => void onResolve(group, 'keep-both')}>
                  Keep both
                </button>
                <button type="button" className="btn" onClick={() => void onResolve(group, 'merge', keepId)}>
                  Merge into selected
                </button>
              </div>
            )}
          </div>
        );
      })}
      {shown.length > 100 && <div className="forge-muted">Showing the first 100 groups.</div>}
    </div>
  );
}
