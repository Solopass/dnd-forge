import { getQualitativeHealthLabel } from '../engine/dm-tools';
import { CombatantNode } from '../types/combat';
import { Activity } from '../types/compendium';
import { ModalDialog } from './ModalDialog';

interface MonsterStatblockModalProps {
  combatant: CombatantNode | null;
  playerView: boolean;
  onClose: () => void;
  onTriggerActivity: (combatantName: string, act: Activity) => void;
  onAdjustLegendary: (combatantId: string, delta: number) => void;
  onToggleOrRollRecharge: (combatantId: string, abilityName: string, forceSpend?: boolean) => void;
}

export function MonsterStatblockModal({
  combatant,
  playerView,
  onClose,
  onTriggerActivity,
  onAdjustLegendary,
  onToggleOrRollRecharge,
}: MonsterStatblockModalProps) {
  if (!combatant) return null;
  const meta = combatant.monsterMeta;
  const hideStats = playerView && combatant.kind !== 'pc';

  return (
    <ModalDialog isOpen={Boolean(combatant)} onClose={onClose} title={`Statblock — ${combatant.name}`}>
      <div className="forge-stack">
        <div className="card forge-row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="forge-row" style={{ gap: 10 }}>
            {combatant.portraitUrl && (
              <img
                src={combatant.portraitUrl}
                alt={combatant.name}
                loading="lazy"
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 'var(--radius-sm)',
                  objectFit: 'cover',
                  border: '1px solid var(--border-subtle)',
                }}
              />
            )}
            <div>
              <strong>{combatant.name}</strong>
              <div className="forge-muted" style={{ fontSize: 12 }}>
                {(combatant.size ?? meta?.size ?? 'medium').toUpperCase()} • CR {combatant.cr ?? meta?.cr ?? '—'}
                {meta?.speeds ? ` • Speed ${meta.speeds}` : ''}
              </div>
            </div>
          </div>
          <div className="pill-row tabular">
            <span className="pill active">AC {hideStats ? '?' : combatant.ac}</span>
            <span className="pill active">
              {hideStats
                ? `Status: ${getQualitativeHealthLabel(combatant.hp.current, combatant.hp.max)}`
                : `HP ${combatant.hp.current} / ${combatant.hp.max}`}
            </span>
            <span className="pill">
              DEX {combatant.dexModifier >= 0 ? `+${combatant.dexModifier}` : combatant.dexModifier}
            </span>
          </div>
        </div>

        {!hideStats && meta && (meta.saves || meta.skills || meta.senses || meta.resistances?.length || meta.immunities?.length) && (
          <div className="card forge-stack" style={{ fontSize: 12 }}>
            {meta.saves && <div><strong>Saving Throws:</strong> {meta.saves}</div>}
            {meta.skills && <div><strong>Skills:</strong> {meta.skills}</div>}
            {meta.senses && <div><strong>Senses:</strong> {meta.senses}</div>}
            {meta.resistances && meta.resistances.length > 0 && (
              <div><strong>Damage Resistances:</strong> {meta.resistances.join(', ')}</div>
            )}
            {meta.immunities && meta.immunities.length > 0 && (
              <div><strong>Damage Immunities:</strong> {meta.immunities.join(', ')}</div>
            )}
            {meta.vulnerabilities && meta.vulnerabilities.length > 0 && (
              <div><strong>Damage Vulnerabilities:</strong> {meta.vulnerabilities.join(', ')}</div>
            )}
          </div>
        )}

        {combatant.notes && (
          <div className="card" style={{ fontSize: 12 }}>
            <div className="forge-section-label">TRAITS &amp; NOTES</div>
            <div>{combatant.notes}</div>
          </div>
        )}

        {!hideStats && combatant.legendaryActions && (
          <div className="card forge-row-between">
            <div>
              <strong>Legendary Actions</strong>
              <div className="forge-muted tabular" style={{ fontSize: 11 }}>
                Remaining: {combatant.legendaryActions.current} / {combatant.legendaryActions.max} (Resets at start of turn)
              </div>
            </div>
            <div className="forge-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={combatant.legendaryActions.current <= 0}
                onClick={() => onAdjustLegendary(combatant.id, -1)}
              >
                Use 1
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => onAdjustLegendary(combatant.id, combatant.legendaryActions!.max)}
              >
                Restore
              </button>
            </div>
          </div>
        )}

        {!hideStats && combatant.rechargeStates && combatant.rechargeStates.length > 0 && (
          <div className="card forge-stack">
            <div className="forge-section-label">RECHARGE ABILITIES</div>
            {combatant.rechargeStates.map((rec) => (
              <div key={rec.name} className="forge-row-between">
                <span>
                  {rec.name}{' '}
                  <span className="forge-muted" style={{ fontSize: 11 }}>
                    ({rec.available ? 'Ready' : `Needs ${rec.minRoll}+ on 1d6`})
                  </span>
                </span>
                <button
                  type="button"
                  className={`btn ${rec.available ? '' : 'btn-primary'}`}
                  onClick={() => onToggleOrRollRecharge(combatant.id, rec.name)}
                >
                  {rec.available ? 'Mark Spent' : 'Roll 1d6 Recharge'}
                </button>
              </div>
            ))}
          </div>
        )}

        {!hideStats && combatant.actions && combatant.actions.length > 0 && (
          <div className="card forge-stack">
            <div className="forge-section-label">ACTIONS &amp; ABILITIES</div>
            {combatant.actions.map((act) => (
              <div key={act.id} className="forge-list-row">
                <div>
                  <strong>{act.name}</strong>{' '}
                  <span className="forge-muted" style={{ fontSize: 11 }}>
                    {act.attackBonusFormula ? `${act.attackBonusFormula} to hit` : ''}
                    {act.saveDcFormula ? `DC ${act.saveDcFormula} ${act.saveAbility?.toUpperCase()}` : ''}
                    {act.damageFormula ? ` • ${act.damageFormula} ${act.damageType ?? ''}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary tabular"
                  onClick={() => onTriggerActivity(combatant.name, act)}
                >
                  Roll
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
