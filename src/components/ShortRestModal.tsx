import React, { useEffect, useState } from 'react';
import { ClassLevel, ResolvedCharacterSheet } from '../types/character';
import { ModalDialog } from './ModalDialog';

interface ShortRestModalProps {
  isOpen: boolean;
  onClose: () => void;
  sheet: ResolvedCharacterSheet;
  classes: ClassLevel[];
  onSpendHitDice: (count: number, dieSize?: 6 | 8 | 10 | 12) => void;
  onCompleteShortRest: () => void;
}

export const ShortRestModal: React.FC<ShortRestModalProps> = ({
  isOpen,
  onClose,
  sheet,
  classes,
  onSpendHitDice,
  onCompleteShortRest,
}) => {
  const hitDicePool = sheet.resources.find((r) => r.id === 'hit_dice');
  const availableDice = hitDicePool?.current ?? 0;
  const maxDice = hitDicePool?.max ?? sheet.totalLevel;
  const conMod = sheet.abilities.con.modifier;
  const uniqueDice = Array.from(new Set(classes.map((c) => c.hitDie))) as Array<6 | 8 | 10 | 12>;
  const defaultDie = uniqueDice[0] ?? 8;

  const [count, setCount] = useState(1);
  const [dieSize, setDieSize] = useState<6 | 8 | 10 | 12>(defaultDie);

  useEffect(() => {
    if (isOpen) {
      setCount(availableDice > 0 ? 1 : 0);
      setDieSize(defaultDie);
    }
  }, [isOpen, availableDice, defaultDie]);

  const conSign = conMod >= 0 ? '+' : '';
  const avgPerDie = Math.max(1, Math.floor(dieSize / 2) + 1 + conMod);
  const missingHp = Math.max(0, sheet.hp.max - sheet.hp.current);

  const handleConfirm = () => {
    if (count > 0 && availableDice > 0) {
      onSpendHitDice(count, dieSize);
    }
    onCompleteShortRest();
    onClose();
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Short Rest — Spend Hit Dice"
    >
      <div className="forge-stack">
        <div className="forge-row-between card" style={{ padding: 10 }}>
          <div>
            <div className="forge-label">CURRENT HP</div>
            <div className="tabular" style={{ fontSize: 16, fontWeight: 700 }}>
              {sheet.hp.current} / {sheet.hp.max}
              {missingHp > 0 && (
                <span className="forge-muted" style={{ fontSize: 12, marginLeft: 6 }}>
                  ({missingHp} missing)
                </span>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="forge-label">HIT DICE</div>
            <div className="tabular" style={{ fontSize: 16, fontWeight: 700 }}>
              {availableDice} / {maxDice}
            </div>
          </div>
        </div>

        <div className="forge-stack" style={{ gap: 6 }}>
          <div className="forge-row-between">
            <span className="forge-label">HIT DICE TO SPEND</span>
            <span className="badge tabular">
              1d{dieSize} {conSign}{conMod} CON (avg {avgPerDie} HP/die)
            </span>
          </div>

          {uniqueDice.length > 1 && (
            <div className="pill-row">
              {uniqueDice.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`pill ${dieSize === d ? 'active' : ''}`}
                  onClick={() => setDieSize(d)}
                >
                  d{d}
                </button>
              ))}
            </div>
          )}

          <div className="forge-row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn"
              disabled={count <= 0}
              onClick={() => setCount((c) => Math.max(0, c - 1))}
            >
              -1
            </button>
            <input
              type="number"
              min={0}
              max={availableDice}
              className="forge-input tabular"
              style={{ width: 80, textAlign: 'center' }}
              value={count}
              onChange={(e) =>
                setCount(
                  Math.min(
                    availableDice,
                    Math.max(0, Number.parseInt(e.target.value, 10) || 0)
                  )
                )
              }
            />
            <button
              type="button"
              className="btn"
              disabled={count >= availableDice}
              onClick={() => setCount((c) => Math.min(availableDice, c + 1))}
            >
              +1
            </button>
            <button
              type="button"
              className="btn"
              disabled={availableDice <= 0}
              onClick={() => setCount(availableDice)}
            >
              Max ({availableDice})
            </button>
          </div>
        </div>

        <div className="forge-muted" style={{ fontSize: 11 }}>
          Completing a Short Rest also restores Warlock Pact Magic slots and Short-Rest resource pools.
        </div>

        <div className="forge-row-between" style={{ marginTop: 4 }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleConfirm}>
            {count > 0
              ? `Roll ${count}×d${dieSize} & Finish Short Rest`
              : 'Finish Short Rest (0 Dice)'}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
};
