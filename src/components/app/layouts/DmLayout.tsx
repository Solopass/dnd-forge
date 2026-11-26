import { Suspense } from 'react';
import { computeCharacterSheet } from '../../../engine/rules-math';
import type { DmHubTab } from '../../DmHubModal';
import { BattlemapModal, DmHubModal } from '../lazy';
import type { AppLayoutProps } from '../types';

export function DmLayout({ store, ui, panels }: AppLayoutProps) {
  const {
    dmSection,
    setDmSection,
    openPcSheetFromDm,
    effectivePlayerView,
  } = ui;
  const {
    combatDrawerNode,
    sharedBattlemapProps,
    sharedDmHubProps,
  } = panels;
  return (
    <div className="dm-workspace-grid">
      <nav className="dm-left-rail" aria-label="DM Studio navigation">
        {(
          [
            ['party', 'Party & Sync'],
            ['binder', 'Campaign Binder'],
            ['clock', 'World Clock'],
            ['loot', 'Loot & Shops'],
            ['dmscreen', 'DM Screen'],
            ['xp', 'Party XP & Milestones'],
            ['improv', 'Improv'],
            ['worldmap', 'World Map'],
            ['soundboard', 'Soundboard'],
            ['battlemap', 'Tactical Battlemap'],
          ] as Array<[DmHubTab | 'battlemap', string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`unified-rail-btn ${dmSection === key ? 'active' : ''}`}
            aria-label={label}
            aria-current={dmSection === key ? 'page' : undefined}
            onClick={() => setDmSection(key)}
          >
            <span>{label}</span>
          </button>
        ))}

        <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--border-subtle)', margin: '6px 0' }} />
        <div className="forge-section-label" style={{ paddingLeft: 4, marginBottom: 2 }}>
          PARTY ({store.characterList.length})
        </div>
        {store.characterList.map((pc) => {
          const resolved = computeCharacterSheet(pc);
          return (
            <div key={pc.id} className="dm-party-mini-card">
              <div className="forge-row-between gap-1">
                <strong style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pc.name}
                </strong>
                <span className="badge tabular">AC {resolved.ac.final}</span>
              </div>
              <div className="forge-row-between tabular forge-muted text-sm">
                <span>HP {resolved.hp.current}/{resolved.hp.max}</span>
                <span>PP {resolved.passivePerception}</span>
              </div>
              <button
                type="button"
                className="btn"
                style={{ width: '100%', fontSize: 11, padding: '3px 6px' }}
                onClick={() => void openPcSheetFromDm(pc.id)}
              >
                Open Sheet
              </button>
            </div>
          );
        })}
      </nav>

      <main className="dm-center-stage">
        {dmSection === 'battlemap' ? (
          <Suspense fallback={null}>
            <BattlemapModal
              isOpen
              embeddedFull
              onClose={() => setDmSection('party')}
              {...sharedBattlemapProps}
              playerView={effectivePlayerView}
            />
          </Suspense>
        ) : (
          <Suspense fallback={null}>
            <DmHubModal
              isOpen
              embedded
              activeTab={dmSection}
              onTabChange={(t) => setDmSection(t)}
              onOpenCharacterSheet={(id) => void openPcSheetFromDm(id)}
              onClose={() => {}}
              {...sharedDmHubProps}
            />
          </Suspense>
        )}
      </main>

      {combatDrawerNode}
    </div>
  );
}
