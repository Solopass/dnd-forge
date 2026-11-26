import type { PendingImport } from '../state/store/core';
import { summarizeReport } from '../engine/import-pipeline';
import { ModalDialog } from './ModalDialog';

interface ImportPreviewModalProps {
  pending: PendingImport | null;
  onImport: () => void;
  onCancel: () => void;
}

/** Shown before any import writes to the database: counts of new, exact-duplicate and possible-duplicate entries. */
export function ImportPreviewModal({ pending, onImport, onCancel }: ImportPreviewModalProps) {
  const plan = pending?.plan;
  const report = pending?.report;
  const LIST_CAP = 100;
  return (
    <ModalDialog isOpen={pending !== null} onClose={onCancel} title={`Import preview: ${pending?.label ?? ''}`}>
      {plan && (
        <div className="forge-stack">
          <p data-testid="import-summary">{plan.summary}</p>
          {report && (
            <div className="card forge-stack" data-testid="import-report">
              <div className="forge-section-label">PACK DOCTOR</div>
              <p data-testid="import-report-summary">{summarizeReport(report)}</p>
              {report.topProblems.length > 0 && (
                <ul className="forge-muted">
                  {report.topProblems.map((p) => (
                    <li key={p.text}>
                      {p.count}x {p.text}
                    </li>
                  ))}
                </ul>
              )}
              {report.repaired.length > 0 && (
                <details data-testid="import-repaired">
                  <summary>{report.repaired.length} repaired (fixed automatically)</summary>
                  <ul className="forge-muted">
                    {report.repaired.slice(0, LIST_CAP).map((r, i) => (
                      <li key={`${r.name}-${i}`}>
                        {r.name} ({r.category}): {r.notes.join('; ')}
                      </li>
                    ))}
                    {report.repaired.length > LIST_CAP && <li>and {report.repaired.length - LIST_CAP} more</li>}
                  </ul>
                </details>
              )}
              {report.rejected.length > 0 && (
                <details data-testid="import-rejected">
                  <summary>{report.rejected.length} rejected (not imported)</summary>
                  <ul className="forge-muted">
                    {report.rejected.slice(0, LIST_CAP).map((r, i) => (
                      <li key={`${r.source}-${i}`}>
                        {r.source}: {r.reason}
                      </li>
                    ))}
                    {report.rejected.length > LIST_CAP && <li>and {report.rejected.length - LIST_CAP} more</li>}
                  </ul>
                </details>
              )}
              {report.unreadable.length > 0 && (
                <details data-testid="import-unreadable" open>
                  <summary>
                    {report.unreadable.length} file{report.unreadable.length === 1 ? '' : 's'} unreadable
                    {report.keptEntries ? ` — ${report.keptEntries} entr${report.keptEntries === 1 ? 'y' : 'ies'} kept as they were` : ''}
                  </summary>
                  <ul className="forge-muted">
                    {report.unreadable.slice(0, LIST_CAP).map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
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
