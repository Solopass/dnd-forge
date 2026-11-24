import { useEffect, useState } from 'react';
import { isSoundEnabled, playTableSound, setSoundEnabled } from '../engine/sound';
import { applyUiMode, readStoredUiMode, UiMode } from '../engine/ui-mode';
import { ModalDialog } from './ModalDialog';

type SchemeChoice = 'system' | 'light' | 'dark';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  uiMode?: UiMode;
  onChangeUiMode?: (mode: UiMode) => void;
  rulesetPresetLabel?: string;
  onOpenRulesetModal?: () => void;
  onExportBackup: () => Promise<void>;
  onExportActiveCharacter: () => void;
}

function readStoredScheme(): SchemeChoice {
  try {
    const val = localStorage.getItem('color-scheme');
    if (val === 'light' || val === 'dark') return val;
  } catch {
    // ignore
  }
  return 'system';
}

function readStoredContrast(): boolean {
  try {
    return localStorage.getItem('dnd-forge-contrast') === 'high';
  } catch {
    return false;
  }
}

export function SettingsModal({
  isOpen,
  onClose,
  uiMode,
  onChangeUiMode,
  rulesetPresetLabel,
  onOpenRulesetModal,
  onExportBackup,
  onExportActiveCharacter,
}: SettingsModalProps) {
  const [scheme, setScheme] = useState<SchemeChoice>(readStoredScheme);
  const [localUiMode, setLocalUiMode] = useState<UiMode>(readStoredUiMode);
  const effectiveUiMode = uiMode ?? localUiMode;
  const setUiMode = (next: UiMode) => {
    setLocalUiMode(next);
    applyUiMode(next);
    onChangeUiMode?.(next);
  };
  const [highContrast, setHighContrast] = useState<boolean>(readStoredContrast);
  const [soundOn, setSoundOn] = useState<boolean>(isSoundEnabled);
  const [systemIsDark, setSystemIsDark] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onMqChange = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mq.addEventListener('change', onMqChange);

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'color-scheme') {
        const next = readStoredScheme();
        setScheme(next);
        const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
        if (meta) meta.content = next === 'system' ? 'light dark' : next;
      }
      if (e.key === 'dnd-forge-contrast') {
        const hc = readStoredContrast();
        setHighContrast(hc);
        if (hc) document.documentElement.dataset.contrast = 'high';
        else delete document.documentElement.dataset.contrast;
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      mq.removeEventListener('change', onMqChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const applyScheme = (next: SchemeChoice) => {
    setScheme(next);
    const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
    if (meta) meta.content = next === 'system' ? 'light dark' : next;
    try {
      if (next === 'system') localStorage.removeItem('color-scheme');
      else localStorage.setItem('color-scheme', next);
    } catch {
      // ignore storage failure
    }
  };

  const toggleHighContrast = () => {
    const next = !highContrast;
    setHighContrast(next);
    if (next) document.documentElement.dataset.contrast = 'high';
    else delete document.documentElement.dataset.contrast;
    try {
      if (next) localStorage.setItem('dnd-forge-contrast', 'high');
      else localStorage.removeItem('dnd-forge-contrast');
    } catch {
      // ignore
    }
  };

  return (
    <ModalDialog isOpen={isOpen} onClose={onClose} title="Appearance, Print & Backup Settings">
      <div className="forge-stack">
        <div className="card forge-stack">
          <div className="card-header">
            <div className="forge-section-label">INTERFACE LAYOUT</div>
            <span className="badge">{effectiveUiMode === 'classic' ? 'D&D Beyond Classic' : 'Unified Command'}</span>
          </div>
          <div className="pill-row">
            <button
              type="button"
              className={`pill ${effectiveUiMode === 'classic' ? 'active' : ''}`}
              onClick={() => setUiMode('classic')}
            >
              D&amp;D Beyond Classic (Default)
            </button>
            <button
              type="button"
              className={`pill ${effectiveUiMode === 'unified' ? 'active' : ''}`}
              onClick={() => setUiMode('unified')}
            >
              Unified Command Studio
            </button>
          </div>
          <div className="forge-muted">
            Classic mimics the familiar D&amp;D Beyond character sheet with modal DM/VTT tools. Unified embeds DM Studio &amp; Tactical VTT directly in the main canvas with a left workspace rail.
          </div>
        </div>

        {onOpenRulesetModal && (
          <div className="card forge-stack">
            <div className="card-header">
              <div className="forge-section-label">RULESET &amp; HOUSE RULES</div>
              <span className="badge">{rulesetPresetLabel ?? '2024 Revised'}</span>
            </div>
            <div className="forge-row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div className="forge-muted" style={{ flex: 1, minWidth: 220 }}>
                Compare 2014 vs 2024 rules (Exhaustion, Healing Potions, Weapon Mastery, Surprise, Flanking, Crits) or mix &amp; match your own custom ruleset.
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onClose();
                  onOpenRulesetModal();
                }}
              >
                Customize Ruleset...
              </button>
            </div>
          </div>
        )}

        <div className="card forge-stack">
          <div className="card-header">
            <div className="forge-section-label">COLOR THEME &amp; ACCESSIBILITY</div>
          </div>
          <div className="pill-row">
            <button
              type="button"
              className={`pill ${scheme === 'system' ? 'active' : ''}`}
              onClick={() => applyScheme('system')}
            >
              System (Currently {systemIsDark ? 'Dark' : 'Light'})
            </button>
            <button
              type="button"
              className={`pill ${scheme === 'light' ? 'active' : ''}`}
              onClick={() => applyScheme('light')}
            >
              Light
            </button>
            <button
              type="button"
              className={`pill ${scheme === 'dark' ? 'active' : ''}`}
              onClick={() => applyScheme('dark')}
            >
              Dark
            </button>
          </div>
          <div className="forge-row-between">
            <div>
              <strong>High Contrast Borders &amp; Labels</strong>
              <div className="forge-muted">Strengthens card borders and secondary text contrast.</div>
            </div>
            <button
              type="button"
              className={`pill ${highContrast ? 'active' : ''}`}
              aria-pressed={highContrast}
              onClick={toggleHighContrast}
            >
              {highContrast ? 'Enabled' : 'Disabled'}
            </button>
          </div>
          <div className="forge-row-between">
            <div>
              <strong>Dice Roll Sound Effects</strong>
              <div className="forge-muted">Plays a subtle synthesized chime on rolls, crits, and heals.</div>
            </div>
            <button
              type="button"
              className={`pill ${soundOn ? 'active' : ''}`}
              aria-pressed={soundOn}
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                setSoundEnabled(next);
                if (next) playTableSound('roll', true);
              }}
            >
              {soundOn ? 'Enabled' : 'Muted'}
            </button>
          </div>
        </div>

        <div className="card forge-stack">
          <div className="card-header">
            <div className="forge-section-label">PRINT &amp; DATA EXPORT</div>
          </div>
          <div className="forge-row" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onClose();
                setTimeout(() => window.print(), 100);
              }}
            >
              Print / Save Character Sheet PDF
            </button>
            <button
              type="button"
              className="btn"
              onClick={onExportActiveCharacter}
            >
              Export Active Character (.json)
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void onExportBackup()}
            >
              Export Full Backup (.json)
            </button>
          </div>
          <div className="forge-muted">
            All characters, custom maps, homebrew entries, and encounters are saved offline in your browser IndexedDB.
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
