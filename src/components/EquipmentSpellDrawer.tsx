import { CompendiumEntity } from '../types/compendium';
import { ModalDialog } from './ModalDialog';

interface EquipmentSpellDrawerProps {
  isOpen: boolean;
  items: CompendiumEntity[];
  attunementCount: number;
  onClose: () => void;
  onToggleEquipped: (id: string) => void;
  onTogglePrepared: (id: string) => void;
  onToggleAttuned: (id: string) => void;
  onRemoveItem: (id: string) => void;
}

export function EquipmentSpellDrawer({
  isOpen,
  items,
  attunementCount,
  onClose,
  onToggleEquipped,
  onTogglePrepared,
  onToggleAttuned,
  onRemoveItem,
}: EquipmentSpellDrawerProps) {
  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title={
        <>
          Equipment, Attunement (<span className="tabular">{attunementCount}/3</span>) &amp; Spell Preparation
        </>
      }
    >

        {items.map((item) => (
          <div
            key={item.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 0',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <strong>{item.name}</strong>{' '}
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                ({item.category.toUpperCase()})
              </span>
            </div>

            <div className="pill-row">
              {(item.category === 'armor' || item.category === 'shield' || item.category === 'weapon' || item.category === 'gear') && (
                <button
                  type="button"
                  className={`pill ${item.equipped ? 'active' : ''}`}
                  onClick={() => onToggleEquipped(item.id)}
                >
                  {item.equipped ? 'Equipped' : 'Stowed'}
                </button>
              )}

              {item.category === 'spell' && (item.spellLevel ?? 0) > 0 && (
                <button
                  type="button"
                  className={`pill ${item.prepared !== false ? 'active' : ''}`}
                  onClick={() => onTogglePrepared(item.id)}
                >
                  {item.prepared !== false ? 'Prepared' : 'Unprepared'}
                </button>
              )}

              {item.requiresAttunement && (
                <button
                  type="button"
                  className={`pill ${item.attuned ? 'active' : ''}`}
                  onClick={() => onToggleAttuned(item.id)}
                >
                  {item.attuned ? 'Attuned' : 'Unattuned'}
                </button>
              )}

              <button
                type="button"
                className="btn btn-danger"
                title="Remove from sheet"
                onClick={() => onRemoveItem(item.id)}
              >
                ×
              </button>
            </div>
          </div>
        ))}
    </ModalDialog>
  );
}
