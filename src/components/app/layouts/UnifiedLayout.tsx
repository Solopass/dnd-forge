import { Suspense } from 'react';
import { BackpackIcon, BookIcon, MapIcon, SwordsIcon } from '../../Icons';
import { BattlemapModal, DmHubModal } from '../lazy';
import type { AppLayoutProps } from '../types';

export function UnifiedLayout({ store, ui, panels }: AppLayoutProps) {
  const {
    setPaletteOpen,
    setBuilderOpen,
    setGearOpen,
    setShortRestOpen,
    setEncounterBuilderOpen,
    unifiedView,
    setUnifiedView,
    isPlayerRole,
    effectivePlayerView,
    isCombatActive,
    charLevel,
    isInDmStudio,
  } = ui;
  const {
    vitalsNode,
    actionBoardNode,
    rightSlotNode,
    sharedBattlemapProps,
    sharedDmHubProps,
  } = panels;
  return (
    <div className="unified-shell">
      <nav className="unified-rail" aria-label="Unified workspace navigation">
        <button
          type="button"
          className={`unified-rail-btn ${unifiedView === 'sheet' ? 'active' : ''}`}
          aria-label="Play Sheet"
          aria-current={unifiedView === 'sheet' ? 'page' : undefined}
          onClick={() => setUnifiedView('sheet')}
        >
          <span className="forge-row gap-2"><SwordsIcon size={14} /> Play Sheet</span>
          <span className="badge">Lvl {charLevel}</span>
        </button>
        {!isPlayerRole && (
          <button
            type="button"
            className={`unified-rail-btn ${unifiedView === 'dm' ? 'active' : ''}`}
            aria-label="DM Studio"
            aria-current={unifiedView === 'dm' ? 'page' : undefined}
            onClick={() => setUnifiedView('dm')}
          >
            <span className="forge-row gap-2"><BookIcon size={14} /> DM Studio</span>
            <span className="badge">{store.campaign.entries.length}</span>
          </button>
        )}
        <button
          type="button"
          className={`unified-rail-btn ${unifiedView === 'vtt' ? 'active' : ''}`}
          aria-label="Tactical VTT"
          aria-current={unifiedView === 'vtt' ? 'page' : undefined}
          onClick={() => setUnifiedView('vtt')}
        >
          <span className="forge-row gap-2"><MapIcon size={14} /> Tactical VTT</span>
          <span className="badge">{isCombatActive ? `Live R${store.encounter.round}` : `Rnd ${store.encounter.round}`}</span>
        </button>
        {!isInDmStudio && (
          <>
            <div className="subpanel forge-stack" style={{ padding: '8px', gap: 6, marginTop: 4 }}>
              <div className="forge-row-between tabular text-sm">
                <strong>HP {store.resolvedSheet.hp.current}/{store.resolvedSheet.hp.max}</strong>
                <span>AC {store.resolvedSheet.ac.final}</span>
              </div>
              <div className="forge-row gap-1">
                <button type="button" className="btn flex-1 text-sm" onClick={() => setShortRestOpen(true)}>
                  Short Rest
                </button>
                <button type="button" className="btn flex-1 text-sm" onClick={() => store.takeRest('long_rest')}>
                  Long Rest
                </button>
              </div>
            </div>
            <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--border-subtle)', margin: '4px 0' }} />
            <button type="button" className="unified-rail-btn" onClick={() => setBuilderOpen(true)}>
              <span>Build &amp; Stats</span>
            </button>
            <button type="button" className="unified-rail-btn" onClick={() => setGearOpen(true)}>
              <span className="forge-row gap-2"><BackpackIcon size={14} /> Gear &amp; Spells</span>
              <span className="badge">{store.resolvedSheet.attunementCount}/3</span>
            </button>
          </>
        )}
        {!isPlayerRole && (
          <button type="button" className="unified-rail-btn" onClick={() => setEncounterBuilderOpen(true)}>
            <span>Encounter Forge</span>
          </button>
        )}
        <button type="button" className="unified-rail-btn" onClick={() => setPaletteOpen(true)}>
          <span>Compendium / PDF</span>
        </button>
      </nav>

      <div className="unified-main-with-combat">
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, height: '100%', overflow: 'hidden' }}>
          {unifiedView !== 'sheet' && (
            <div
              className="subpanel forge-row-between"
              style={{
                margin: '10px 14px 0',
                padding: '6px 10px',
                flexWrap: 'wrap',
                gap: 8,
                flexShrink: 0,
              }}
            >
              <div className="forge-row gap-3 wrap">
                <span className="badge tabular">
                  Round {store.encounter.round} • Turn:{' '}
                  {store.encounter.combatants[store.encounter.activeTurnIndex]?.name ?? 'None'}
                </span>
                {store.consoleLines.length > 0 && (
                  <span className="forge-muted" style={{ fontSize: 11, maxWidth: 460, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Latest: {store.consoleLines[store.consoleLines.length - 1]?.text}
                  </span>
                )}
              </div>
              <button type="button" className="btn" onClick={() => setUnifiedView('sheet')}>
                ← Play Sheet
              </button>
            </div>
          )}
          {unifiedView === 'sheet' && (
            <div className="unified-sheet-split" style={{ flex: 1, minHeight: 0 }}>
              {vitalsNode}
              {actionBoardNode}
            </div>
          )}
          {unifiedView === 'dm' && !isPlayerRole && (
            <div className="pane" style={{ padding: 14, flex: 1, minHeight: 0 }}>
              <Suspense fallback={null}>
                <DmHubModal isOpen embedded onClose={() => setUnifiedView('sheet')} {...sharedDmHubProps} />
              </Suspense>
            </div>
          )}
          {(unifiedView === 'vtt' || (unifiedView === 'dm' && isPlayerRole)) && (
            <div className="pane center-stage-pane" style={{ padding: '10px 14px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="subpanel forge-row-between" style={{ padding: '6px 10px', flexWrap: 'wrap', gap: 8, flexShrink: 0 }}>
                <div className="pill-row tabular">
                  <span className="badge">
                    HP {store.resolvedSheet.hp.current}/{store.resolvedSheet.hp.max}
                    {store.resolvedSheet.hp.temp > 0 ? ` (+${store.resolvedSheet.hp.temp})` : ''}
                  </span>
                  <span className="badge">AC {store.resolvedSheet.ac.final}</span>
                  <button type="button" className="btn" onClick={store.rollCharacterInitiative}>
                    Init {store.resolvedSheet.initiative.final >= 0 ? `+${store.resolvedSheet.initiative.final}` : store.resolvedSheet.initiative.final}
                  </button>
                  <span className="badge">Speed {store.resolvedSheet.speed.final}ft</span>
                </div>
                <div className="forge-row gap-1">
                  <button type="button" className="btn btn-danger" onClick={() => store.adjustHp(-5)}>
                    -5 HP
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => store.adjustHp(5)}>
                    +5 HP
                  </button>
                </div>
              </div>
              <div className="center-battlemap-slot" style={{ flexShrink: 0 }}>
                <Suspense fallback={null}>
                  <BattlemapModal
                    isOpen
                    embeddedFull
                    onClose={() => setUnifiedView('sheet')}
                    {...sharedBattlemapProps}
                    playerView={effectivePlayerView}
                  />
                </Suspense>
              </div>
              {actionBoardNode}
            </div>
          )}
        </div>
        {rightSlotNode}
      </div>
    </div>
  );
}
