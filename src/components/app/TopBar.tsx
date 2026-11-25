import { APP_VERSION } from '../../version';
import { RedoIcon, UndoIcon } from '../Icons';
import { MoreMenu, type MoreMenuItem } from './MoreMenu';
import { detectRulesetPreset } from '../../engine/ruleset-config';
import type { AppSectionProps } from './types';

export function TopBar({ store, ui }: AppSectionProps) {
  const {
    setPaletteOpen,
    setNewCharOpen,
    setBattlemapOpen,
    setSettingsOpen,
    setRulesetOpen,
    setThemeStudioOpen,
    modularMode,
    isEditingLayout,
    setIsEditingLayout,
    setLevelUpOpen,
    setCharManagerOpen,
    setLiveTableOpen,
    setEncounterBuilderOpen,
    uiMode,
    setUiMode,
    setShortcutsOpen,
    dmSection,
    setDmSection,
    isPlayerRole,
    setTableRolePersisted,
    setModularEnabled,
  } = ui;
  const rulesetPreset = detectRulesetPreset(store.houseRules);
  const moreItems: MoreMenuItem[] = [
    {
      key: 'themes',
      label: 'Themes',
      title: 'Open Theme Studio, Custom Theme Editor & Setup Sharing',
      onSelect: () => setThemeStudioOpen(true),
    },
    {
      key: 'rules',
      label: `Rules: ${rulesetPreset === '2014' ? '2014' : rulesetPreset === '2024' ? '2024' : 'Custom'}`,
      title: 'View 2014 vs 2024 rule differences & customize house rules',
      onSelect: () => setRulesetOpen(true),
    },
    // In DM role the DM Studio tabs already cover the battlemap and the DM hub.
    ...(isPlayerRole
      ? [{ key: 'battlemap', label: 'Battlemap', onSelect: () => setBattlemapOpen(true) }]
      : []),
    {
      key: 'shortcuts',
      label: 'Keyboard Shortcuts & Tips (?)',
      onSelect: () => setShortcutsOpen(true),
    },
    { key: 'settings', label: 'Settings', title: 'Settings & Theme', onSelect: () => setSettingsOpen(true) },
  ];
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span
          className="topbar-brand-badge"
          style={{
            display: 'inline-flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            lineHeight: 1.05,
            gap: 1,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="topbar-brand-dot" aria-hidden="true" />
            SIDEREROLL
          </span>
          <span
            className="tabular"
            style={{ fontSize: 9, opacity: 0.72, letterSpacing: '0.06em', paddingLeft: 14 }}
          >
            {APP_VERSION}
          </span>
        </span>
        {!isPlayerRole ? (
          <>
            <select
              aria-label="Active campaign"
              value={store.campaign.id}
              onChange={(e) => void store.switchCampaign(e.target.value)}
              style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '4px 8px', fontSize: 12, fontWeight: 700 }}
            >
              {store.campaignList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.entries.length} notes)
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              onClick={() => setCharManagerOpen(true)}
              title="Manage Party Characters, Import PDFs, or Open a Sheet"
            >
              Party ({store.characterList.length})
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setEncounterBuilderOpen(true)}
              title="Build & Launch Encounters"
            >
              Encounter Forge
            </button>
          </>
        ) : (
          <>
            <select
              aria-label="Active character"
              value={store.rawChar.id}
              onChange={(e) => void store.switchCharacter(e.target.value)}
              style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
            >
              {store.characterList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (Lvl {c.classes.reduce((s, x) => s + x.level, 0)})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              onClick={() => setCharManagerOpen(true)}
              title="Open Character Manager (switch, import, export, duplicate, delete)"
            >
              Roster ({store.characterList.length})
            </button>
            <button
              type="button"
              className="btn btn-brand"
              onClick={() => setNewCharOpen(true)}
            >
              + New
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setLevelUpOpen(true)}>
              Level Up
            </button>
          </>
        )}
      </div>

      <div className="topbar-center">
        <div className="mode-switcher" role="group" aria-label="Table role">
          <button
            type="button"
            className={`mode-switcher-btn ${!isPlayerRole ? 'active' : ''}`}
            aria-pressed={!isPlayerRole}
            disabled={store.liveStatus.role === 'player'}
            onClick={() => setTableRolePersisted('dm')}
            title="DM View: full encounter, monster, and campaign controls"
          >
            DM
          </button>
          <button
            type="button"
            className={`mode-switcher-btn ${isPlayerRole ? 'active' : ''}`}
            aria-pressed={isPlayerRole}
            onClick={() => setTableRolePersisted('player')}
            title="Player View: sheet, dice, and your own token only (hides monster tools)"
          >
            Player
          </button>
        </div>
        {!isPlayerRole ? (
          <div className="mode-switcher" role="group" aria-label="DM Workspace View">
            <button
              type="button"
              className={`mode-switcher-btn ${dmSection !== 'battlemap' ? 'active' : ''}`}
              aria-pressed={dmSection !== 'battlemap'}
              onClick={() => {
                if (dmSection === 'battlemap') setDmSection('party');
              }}
            >
              DM Studio
            </button>
            <button
              type="button"
              className={`mode-switcher-btn ${dmSection === 'battlemap' ? 'active' : ''}`}
              aria-pressed={dmSection === 'battlemap'}
              onClick={() => setDmSection('battlemap')}
            >
              Tactical Battlemap
            </button>
          </div>
        ) : (
          <div className="mode-switcher" role="group" aria-label="Interface layout mode">
            <button
              type="button"
              className={`mode-switcher-btn ${!modularMode && uiMode === 'classic' ? 'active' : ''}`}
              aria-pressed={!modularMode && uiMode === 'classic'}
              onClick={() => {
                setModularEnabled(false);
                setUiMode('classic');
              }}
            >
              Beyond Classic
            </button>
            <button
              type="button"
              className={`mode-switcher-btn ${!modularMode && uiMode === 'unified' ? 'active' : ''}`}
              aria-pressed={!modularMode && uiMode === 'unified'}
              onClick={() => {
                setModularEnabled(false);
                setUiMode('unified');
              }}
            >
              Unified Command
            </button>
            <button
              type="button"
              className={`mode-switcher-btn ${modularMode ? 'active' : ''}`}
              aria-pressed={modularMode}
              onClick={() => setModularEnabled(true)}
            >
              Modular Grid
            </button>
          </div>
        )}
      </div>

      <div className="topbar-actions">
        {modularMode && isPlayerRole && (
          <button
            type="button"
            className={`btn ${isEditingLayout ? 'btn-primary' : ''}`}
            onClick={() => setIsEditingLayout((v) => !v)}
            title="Reorder, resize, hide, or restore workspace blocks"
          >
            {isEditingLayout ? 'Done Editing' : 'Edit Blocks'}
          </button>
        )}
        <button type="button" className="btn" onClick={() => setPaletteOpen(true)} title="Compendium, Packs & PDF Import (Ctrl+K)">
          Packs (Ctrl+K)
        </button>
        <button
          type="button"
          className={`btn ${store.liveStatus.role !== 'idle' ? 'btn-primary' : ''}`}
          onClick={() => setLiveTableOpen(true)}
        >
          Live Table{store.liveStatus.role !== 'idle' ? ` (${store.liveStatus.peers.length + 1})` : ''}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!store.canUndo}
          onClick={store.undo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          className="btn"
          disabled={!store.canRedo}
          onClick={store.redo}
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
        >
          <RedoIcon />
        </button>
        <MoreMenu items={moreItems} />
      </div>
    </header>
  );
}
