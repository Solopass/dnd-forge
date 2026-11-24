import React, { useMemo, useRef, useState } from 'react';
import { RawCharacterState } from '../types/character';
import { Ruleset } from '../types/core';
import { ModalDialog } from './ModalDialog';

interface CharacterManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  characters: RawCharacterState[];
  activeCharacterId: string;
  onSelectCharacter: (id: string) => void;
  onOpenNewCharacter: () => void;
  onOpenBuilderForActive: () => void;
  onDuplicateCharacter: (targetId?: string) => Promise<void>;
  onDeleteCharacter: (id: string) => Promise<void>;
  onImportDdbPdf: (file: File) => Promise<void>;
  onImportCharacterJson: (char: RawCharacterState) => Promise<void>;
  onExportMarkdown?: (char: RawCharacterState) => void;
}

export const CharacterManagerModal: React.FC<CharacterManagerModalProps> = ({
  isOpen,
  onClose,
  characters,
  activeCharacterId,
  onSelectCharacter,
  onOpenNewCharacter,
  onOpenBuilderForActive,
  onDuplicateCharacter,
  onDeleteCharacter,
  onImportDdbPdf,
  onImportCharacterJson,
  onExportMarkdown,
}) => {
  const [query, setQuery] = useState('');
  const [rulesetFilter, setRulesetFilter] = useState<'all' | Ruleset>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characters.filter((c) => {
      if (rulesetFilter !== 'all' && c.ruleset !== rulesetFilter) return false;
      if (!q) return true;
      const clsStr = c.classes.map((cl) => cl.className).join(' ').toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.species.toLowerCase().includes(q) ||
        clsStr.includes(q)
      );
    });
  }, [characters, query, rulesetFilter]);

  const downloadJson = (c: RawCharacterState) => {
    const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'character'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Character Manager (${characters.length})`}
    >
      <div className="forge-stack">
        <div className="forge-row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="forge-row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onClose();
                onOpenNewCharacter();
              }}
            >
              + New Character
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => pdfInputRef.current?.click()}
            >
              Import D&amp;D Beyond PDF
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => jsonInputRef.current?.click()}
            >
              Import JSON
            </button>
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf,.pdf"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onImportDdbPdf(file);
                e.target.value = '';
              }}
            />
            <input
              ref={jsonInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const parsed = JSON.parse(await file.text()) as RawCharacterState;
                  if (parsed?.name && Array.isArray(parsed?.classes)) {
                    await onImportCharacterJson(parsed);
                  }
                } catch {
                  // ignore malformed file
                }
                e.target.value = '';
              }}
            />
          </div>
        </div>

        <div className="forge-row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <input
            type="text"
            className="forge-input"
            style={{ flex: '1 1 180px' }}
            placeholder="Filter by name, class, or species..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {(['all', '2024', '2014'] as const).map((rs) => (
            <button
              key={rs}
              type="button"
              className={`pill ${rulesetFilter === rs ? 'active' : ''}`}
              onClick={() => setRulesetFilter(rs)}
            >
              {rs === 'all' ? 'All Rulesets' : rs}
            </button>
          ))}
        </div>

        <div className="forge-stack" style={{ maxHeight: 420, overflowY: 'auto', gap: 8 }}>
          {filtered.length === 0 ? (
            <div className="forge-muted" style={{ fontSize: 12 }}>
              No matching characters found.
            </div>
          ) : (
            filtered.map((c) => {
              const isActive = c.id === activeCharacterId;
              const totalLevel = c.classes.reduce((s, cl) => s + cl.level, 0);
              const classSummary = c.classes
                .map((cl) => `${cl.className}${cl.subclassName ? ` (${cl.subclassName})` : ''} ${cl.level}`)
                .join(' / ');
              return (
                <div
                  key={c.id}
                  className="card"
                  style={{
                    padding: 10,
                    borderColor: isActive ? 'var(--accent-blue)' : undefined,
                  }}
                >
                  <div className="forge-row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div className="forge-row" style={{ gap: 10 }}>
                      {c.avatarUrl ? (
                        <img
                          src={c.avatarUrl}
                          alt={c.name}
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: '50%',
                            objectFit: 'cover',
                            border: '1px solid var(--border-subtle)',
                          }}
                        />
                      ) : (
                        <div
                          className="subpanel tabular"
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 800,
                            fontSize: 15,
                          }}
                        >
                          {c.name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="forge-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <strong>{c.name}</strong>
                          {isActive && <span className="badge" style={{ color: 'var(--accent-blue)' }}>ACTIVE</span>}
                          <span className="badge">{c.ruleset.toUpperCase()}</span>
                        </div>
                        <div className="forge-muted" style={{ fontSize: 11 }}>
                          Lvl {totalLevel} • {c.species} • {classSummary} • HP {c.hp.current}/{c.hp.max}
                        </div>
                      </div>
                    </div>

                    <div className="pill-row" style={{ gap: 4 }}>
                      {!isActive && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => {
                            onSelectCharacter(c.id);
                            onClose();
                          }}
                        >
                          Switch
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          if (!isActive) onSelectCharacter(c.id);
                          onClose();
                          onOpenBuilderForActive();
                        }}
                      >
                        Builder
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={async () => {
                          await onDuplicateCharacter(c.id);
                        }}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => downloadJson(c)}
                      >
                        JSON
                      </button>
                      {onExportMarkdown && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => onExportMarkdown(c)}
                        >
                          .md
                        </button>
                      )}
                      {characters.length > 1 && (
                        confirmDeleteId === c.id ? (
                          <button
                            type="button"
                            className="btn"
                            style={{ color: 'var(--accent-red)', borderColor: 'var(--accent-red)' }}
                            onClick={async () => {
                              await onDeleteCharacter(c.id);
                              setConfirmDeleteId(null);
                            }}
                          >
                            Confirm Delete
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn"
                            style={{ color: 'var(--accent-red)' }}
                            onClick={() => setConfirmDeleteId(c.id)}
                          >
                            Delete
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </ModalDialog>
  );
};
