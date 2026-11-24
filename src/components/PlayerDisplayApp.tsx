import { lazy, Suspense, useEffect, useState } from 'react';
import { getQualitativeHealthLabel } from '../engine/dm-tools';
import { SharedHandoutPayload } from '../types/campaign';
import { CombatEncounterState, MapPingEvent } from '../types/combat';

const BattlemapModal = lazy(() =>
  import('./BattlemapModal').then((m) => ({ default: m.BattlemapModal }))
);

const EMPTY_ENCOUNTER: CombatEncounterState = {
  id: 'player-wait',
  name: 'Waiting for DM Sync…',
  round: 1,
  activeTurnIndex: 0,
  combatants: [],
  activeEffects: [],
  log: [],
};

export function PlayerDisplayApp() {
  const [encounter, setEncounter] = useState<CombatEncounterState>(EMPTY_ENCOUNTER);
  const [sharedHandout, setSharedHandout] = useState<SharedHandoutPayload | null>(null);
  const [pings, setPings] = useState<MapPingEvent[]>([]);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('dnd-forge-player-display');
    ch.onmessage = (evt: MessageEvent) => {
      if (evt.data?.type === 'sync_state') {
        if (evt.data.encounter) setEncounter(evt.data.encounter as CombatEncounterState);
        setSharedHandout((evt.data.sharedHandout as SharedHandoutPayload | null) ?? null);
        setPings(Array.isArray(evt.data.pings) ? (evt.data.pings as MapPingEvent[]) : []);
        setSynced(true);
      }
    };
    ch.postMessage({ type: 'request_sync' });
    return () => ch.close();
  }, []);

  const visibleCombatants = encounter.combatants.filter((c) => !c.hidden || c.kind === 'pc');
  const activeId = encounter.combatants[encounter.activeTurnIndex]?.id;

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg-base)',
        color: 'var(--text-primary)',
        padding: 16,
        display: 'grid',
        gap: 14,
        gridTemplateRows: 'auto 1fr',
      }}
    >
      <header className="panel forge-row-between" style={{ padding: '10px 14px', flexWrap: 'wrap', gap: 8 }}>
        <div className="forge-row">
          <strong>{encounter.name}</strong>
          <span className="badge tabular">Round {encounter.round}</span>
          <span className="badge">{synced ? 'Live Synced' : 'Awaiting DM Tab'}</span>
        </div>
        <span className="muted-label">Sidereroll • Player Display (No DM Spoilers)</span>
      </header>

      <div className="player-display-grid">
        <section className="panel" style={{ padding: 10 }}>
          <Suspense fallback={null}>
            <BattlemapModal
              isOpen
              embedded
              encounter={encounter}
              playerView
              activePings={pings}
              onTogglePlayerView={() => {}}
              onClose={() => {}}
              onMoveToken={() => {}}
              onSetMapImage={() => {}}
              onAddTemplate={() => {}}
              onClearTemplates={() => {}}
              onToggleFogCells={() => {}}
              onFillAllFog={() => {}}
              onClearAllFog={() => {}}
              onSetTerrainCell={() => {}}
              onClearTerrain={() => {}}
              onUpdateMapSettings={() => {}}
              onNextTurn={() => {}}
            />
          </Suspense>
        </section>

        <aside className="panel forge-stack" style={{ padding: 12 }}>
          <h2 className="panel-title">Initiative Order</h2>
          {visibleCombatants.length === 0 ? (
            <p className="muted-label">No visible combatants yet.</p>
          ) : (
            visibleCombatants.map((c) => {
              const isActive = c.id === activeId;
              const isPc = c.kind === 'pc';
              return (
                <div
                  key={c.id}
                  className="subpanel forge-row-between"
                  style={{
                    padding: '8px 10px',
                    borderColor: isActive ? 'var(--accent)' : undefined,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: isActive ? 700 : 500 }}>
                      {isActive ? '▶ ' : ''}
                      {c.name}
                    </div>
                    {c.conditions.length > 0 && (
                      <div className="muted-label">{c.conditions.join(', ')}</div>
                    )}
                  </div>
                  <span className="badge tabular">
                    {isPc
                      ? `${c.hp.current}/${c.hp.max} HP`
                      : getQualitativeHealthLabel(c.hp.current, c.hp.max)}
                  </span>
                </div>
              );
            })
          )}
        </aside>
      </div>

      {sharedHandout && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Shared Handout: ${sharedHandout.title}`}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5, 7, 11, 0.78)',
            display: 'grid',
            placeItems: 'center',
            padding: 20,
            zIndex: 100,
          }}
        >
          <div className="panel forge-stack" style={{ maxWidth: 640, width: '100%', padding: 18 }}>
            <div className="forge-row-between">
              <h2 className="panel-title">{sharedHandout.title}</h2>
              <span className="badge">Shared by {sharedHandout.senderName}</span>
            </div>
            {sharedHandout.summary && <p style={{ margin: 0, fontWeight: 600 }}>{sharedHandout.summary}</p>}
            {sharedHandout.imageDataUrl && (
              <img
                src={sharedHandout.imageDataUrl}
                alt={sharedHandout.title}
                style={{ maxWidth: '100%', maxHeight: '52vh', objectFit: 'contain', borderRadius: 8 }}
              />
            )}
            {sharedHandout.body && (
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                {sharedHandout.body}
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
