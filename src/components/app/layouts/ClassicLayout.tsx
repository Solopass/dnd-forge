import { Suspense } from 'react';
import { BattlemapModal } from '../lazy';
import type { AppLayoutProps } from '../types';

export function ClassicLayout({ ui, panels }: AppLayoutProps) {
  const {
    centerStage,
    setCenterStage,
    showClassicCombat,
    mobileTab,
    setMobileTab,
    mobileTablistRef,
    effectivePlayerView,
    isCombatActive,
    showCenterBattlemap,
  } = ui;
  const {
    vitalsNode,
    actionBoardNode,
    rightSlotNode,
    sharedBattlemapProps,
  } = panels;
  return (
    <>
      <div className="mobile-tab-bar" role="tablist" aria-label="Workspace panels" ref={mobileTablistRef}>
        {(
          [
            { key: 'vitals', label: 'Vitals & Skills' },
            { key: 'actions', label: 'Actions & Spells' },
            { key: 'combat', label: 'Combat & Encounter' },
          ] as const
        ).map((tab, idx, arr) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`tab-${tab.key}`}
            className="mobile-tab"
            aria-selected={mobileTab === tab.key}
            tabIndex={mobileTab === tab.key ? 0 : -1}
            onClick={() => setMobileTab(tab.key)}
            onKeyDown={(e) => {
              let nextIdx: number | null = null;
              if (e.key === 'ArrowRight') nextIdx = (idx + 1) % arr.length;
              else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + arr.length) % arr.length;
              else if (e.key === 'Home') nextIdx = 0;
              else if (e.key === 'End') nextIdx = arr.length - 1;
              if (nextIdx !== null && arr[nextIdx]) {
                e.preventDefault();
                setMobileTab(arr[nextIdx]!.key);
                const buttons = mobileTablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                buttons?.[nextIdx]?.focus();
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        className={`workspace-grid ${!showClassicCombat ? 'classic-no-combat' : ''}`}
        data-active-tab={mobileTab}
      >
        {vitalsNode}
        <div className="pane center-stage-pane" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, gap: 10, padding: '10px 12px' }}>
          <div className="subpanel forge-row-between" style={{ padding: '5px 10px', flexWrap: 'wrap', gap: 6, flexShrink: 0 }}>
            <div className="pill-row">
              <button
                type="button"
                className={`pill ${!showCenterBattlemap ? 'active' : ''}`}
                onClick={() => setCenterStage('sheet')}
              >
                Actions &amp; Sheet
              </button>
              <button
                type="button"
                className={`pill ${showCenterBattlemap ? 'active' : ''}`}
                onClick={() => setCenterStage('battlemap')}
              >
                Active Battlemap {isCombatActive ? '• Combat Live' : ''}
              </button>
              <button
                type="button"
                className={`pill ${centerStage === 'auto' ? 'active' : ''}`}
                onClick={() => setCenterStage('auto')}
                title="Automatically show Battlemap above Actions & Sheet when combat is active"
              >
                Auto
              </button>
            </div>
          </div>
          {showCenterBattlemap ? (
            <div className="center-battlemap-slot" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <Suspense fallback={null}>
                <BattlemapModal
                  isOpen
                  embeddedFull
                  onClose={() => setCenterStage('sheet')}
                  {...sharedBattlemapProps}
                  playerView={effectivePlayerView}
                />
              </Suspense>
            </div>
          ) : (
            actionBoardNode
          )}
        </div>
        {showClassicCombat && rightSlotNode}
      </div>
    </>
  );
}
