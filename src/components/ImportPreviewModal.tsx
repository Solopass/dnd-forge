import type { PendingImport } from '../state/store/core';
import { ModalDialog } from './ModalDialog';

interface ImportPreviewModalProps {
  pending: PendingImport | null;
  onImport: () => void;
  onCancel: () => void;
}

/** Shown before any import writes to the database: counts of new, exact-duplicate and possible-duplicate entries. */
export function ImportPreviewModal({ pending, onImport, onCancel }: ImportPreviewModalProps) {
  const plan = pending?.plan;
  return (
    <ModalDialog isOpen={pending !== null} onClose={onCancel} title={`Import preview: ${pending?.label ?? ''}`}>
      {plan && (
        <div className="forge-stack">
          <p data-testid="import-summary">{plan.summary}</p>
          {plan.exact.length > 0 && (
            <div className="card forge-stack">
              <div className="forge-section-label">EXACT DUPLICATES (folded, nothing deleted)</div>
              <ul className="forge-muted">
                {plan.exact.slice(0, 8).map((x) => (
                  <li key={x.incoming.id}>
                    {x.incoming.name} ({x.incoming.category}) shows the {x.winner.source} copy
                  </li>
                ))}
                {plan.exact.length > 8 && <li>and {plan.exact.length - 8} more</li>}
              </ul>
            </div>
          )}
          {plan.near.length > 0 && (
            <div className="card forge-stack">
              <div className="forge-section-label">POSSIBLE DUPLICATES (imported; decide in the Duplicates tab)</div>
              <ul className="forge-muted">
                {plan.near.slice(0, 8).map((x) => (
                  <li key={x.incoming.id}>
                    {x.incoming.name} looks like {x.similar.map((s) => s.name).join(', ')}
                  </li>
                ))}
                {plan.near.length > 8 && <li>and {plan.near.length - 8} more</li>}
              </ul>
            </div>
          )}
          <div className="forge-row gap-2">
            <button type="button" className="btn btn-primary" onClick={onImport}>
              Import
            </button>
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
