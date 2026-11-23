import { useState } from 'react';
import { ResolvedCharacterSheet } from '../types/character';
import { AbilityKey, RecoveryTrigger, SkillKey, STANDARD_CONDITIONS } from '../types/core';
import { SKILL_ABILITY_MAP } from '../engine/rules-math';

interface VitalsColumnProps {
  sheet: ResolvedCharacterSheet;
  onAdjustHp: (delta: number) => void;
  onSetTempHp: (temp: number) => void;
  onUpdateDeathSaves: (kind: 'successes' | 'failures', count: number) => void;
  onAdjustResource: (poolId: string, delta: number) => void;
  onAddResource: (name: string, max: number, recovery: RecoveryTrigger) => void;
  onSetAcOverride: (val: number | null) => void;
  onRollCheck: (label: string, modifier: number) => void;
  onRollInitiative: () => void;
  onToggleCondition: (cond: string) => void;
  onTakeRest: (type: 'short_rest' | 'long_rest') => void;
  onSpendHitDie: () => void;
}

const ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ALL_SKILLS = Object.keys(SKILL_ABILITY_MAP) as SkillKey[];

function formatSkillLabel(key: SkillKey): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function VitalsColumn({
  sheet,
  onAdjustHp,
  onSetTempHp,
  onUpdateDeathSaves,
  onAdjustResource,
  onAddResource,
  onSetAcOverride,
  onRollCheck,
  onRollInitiative,
  onToggleCondition,
  onTakeRest,
  onSpendHitDie,
}: VitalsColumnProps) {
  const [inspectAc, setInspectAc] = useState(false);
  const [acInput, setAcInput] = useState('');
  const [tempHpInput, setTempHpInput] = useState('');
  const [skillsExpanded, setSkillsExpanded] = useState(true);
  const [selectedCondition, setSelectedCondition] = useState<string>(STANDARD_CONDITIONS[0]);
  const [newPoolName, setNewPoolName] = useState('');
  const [newPoolMax, setNewPoolMax] = useState('3');

  const initSign = sheet.initiative.final >= 0 ? '+' : '';

  return (
    <aside className="pane" aria-label="Character Vitals">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>{sheet.name}</strong>
            <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
              Lvl {sheet.totalLevel} • Prof +{sheet.proficiencyBonus.final} • DC {sheet.spellcasting.saveDc.final}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              className="btn tabular"
              onClick={onRollInitiative}
              title="Roll Initiative and join Active Combat"
            >
              Init {initSign}{sheet.initiative.final}
            </button>
            <button
              type="button"
              className="btn tabular"
              onClick={() => setInspectAc((v) => !v)}
              title="Click to inspect AC math or set override"
            >
              AC {sheet.ac.final}
            </button>
          </div>
        </div>

        {inspectAc && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Formula: {sheet.ac.activeFormulaSource} ({sheet.ac.base})
              {sheet.ac.modifiers.map((m) => ` + ${m.value} (${m.source})`).join('')}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input
                type="number"
                placeholder="Override AC"
                value={acInput}
                onChange={(e) => setAcInput(e.target.value)}
                style={{ width: 95, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '2px 6px' }}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const parsed = Number.parseInt(acInput, 10);
                  onSetAcOverride(Number.isNaN(parsed) ? null : parsed);
                }}
              >
                Set
              </button>
              <button type="button" className="btn" onClick={() => onSetAcOverride(null)}>
                Reset
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <span className="tabular">
            HP <strong>{sheet.hp.current}</strong> / {sheet.hp.max}
            {sheet.hp.temp > 0 ? ` (+${sheet.hp.temp} tmp)` : ''}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" className="btn" onClick={() => onAdjustHp(-5)}>-5</button>
            <button type="button" className="btn" onClick={() => onAdjustHp(-1)}>-1</button>
            <button type="button" className="btn" onClick={() => onAdjustHp(1)}>+1</button>
            <button type="button" className="btn" onClick={() => onAdjustHp(5)}>+5</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          <input
            type="number"
            placeholder="Temp HP"
            value={tempHpInput}
            onChange={(e) => setTempHpInput(e.target.value)}
            className="tabular"
            style={{ width: 82, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '2px 6px' }}
          />
          <button
            type="button"
            className="btn"
            onClick={() => {
              const val = Number.parseInt(tempHpInput, 10);
              if (!Number.isNaN(val)) onSetTempHp(val);
              setTempHpInput('');
            }}
          >
            Set Temp HP
          </button>
        </div>

        {sheet.hp.current === 0 && (
          <div style={{ marginTop: 8, padding: 6, background: 'rgba(248, 81, 73, 0.12)', borderRadius: 4 }}>
            <div style={{ fontSize: 11, color: 'var(--accent-red)', marginBottom: 4 }}>
              DEATH SAVING THROWS
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span>
                Succ: {sheet.deathSaves.successes}/3{' '}
                <button
                  type="button"
                  className="btn"
                  onClick={() => onUpdateDeathSaves('successes', (sheet.deathSaves.successes + 1) % 4)}
                >
                  +
                </button>
              </span>
              <span>
                Fail: {sheet.deathSaves.failures}/3{' '}
                <button
                  type="button"
                  className="btn"
                  onClick={() => onUpdateDeathSaves('failures', (sheet.deathSaves.failures + 1) % 4)}
                >
                  +
                </button>
              </span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={() => onTakeRest('short_rest')}>
            Short Rest
          </button>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={onSpendHitDie}>
            Spend Hit Die
          </button>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={() => onTakeRest('long_rest')}>
            Long Rest
          </button>
        </div>

        <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          <select
            aria-label="Condition to toggle"
            value={selectedCondition}
            onChange={(e) => setSelectedCondition(e.target.value)}
            style={{ flex: 1, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '3px 6px' }}
          >
            {STANDARD_CONDITIONS.map((cond) => (
              <option key={cond} value={cond}>
                {cond}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => onToggleCondition(selectedCondition)}>
            Toggle Cond
          </button>
        </div>

        {sheet.conditions.length > 0 && (
          <div className="pill-row" style={{ marginTop: 6 }}>
            {sheet.conditions.map((cond) => (
              <button
                key={cond}
                type="button"
                className="pill active"
                onClick={() => onToggleCondition(cond)}
                title="Click to remove condition"
              >
                {cond} ×
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
          ABILITIES &amp; SAVING THROWS
        </div>
        {ABILITIES.map((key) => {
          const ab = sheet.abilities[key];
          const modSign = ab.modifier >= 0 ? '+' : '';
          const saveSign = ab.save.final >= 0 ? '+' : '';
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 0',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <span className="tabular" style={{ textTransform: 'uppercase', width: 46 }}>
                {key} {ab.score.final}
              </span>
              <button
                type="button"
                className="btn tabular"
                onClick={() => onRollCheck(`${key.toUpperCase()} Check`, ab.modifier)}
              >
                Check {modSign}{ab.modifier}
              </button>
              <button
                type="button"
                className="btn tabular"
                onClick={() => onRollCheck(`${key.toUpperCase()} Save`, ab.save.final)}
              >
                Save {saveSign}{ab.save.final}
              </button>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
          RESOURCE POOLS
        </div>
        {sheet.resources.map((pool) => (
          <div
            key={pool.id}
            style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{pool.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button type="button" className="btn" onClick={() => onAdjustResource(pool.id, -1)}>-</button>
                <span className="tabular" style={{ minWidth: 38, textAlign: 'center' }}>
                  {pool.current}/{pool.max}
                </span>
                <button type="button" className="btn" onClick={() => onAdjustResource(pool.id, 1)}>+</button>
              </div>
            </div>
            {pool.max > 0 && pool.max <= 10 && (
              <div className="pip-row">
                {Array.from({ length: pool.max }, (_, idx) => {
                  const filled = idx < pool.current;
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`pip ${filled ? 'filled' : ''}`}
                      aria-label={`${pool.name} slot ${idx + 1} of ${pool.max}`}
                      onClick={() => onAdjustResource(pool.id, filled ? -1 : 1)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          <input
            type="text"
            placeholder="Custom Pool (e.g. Ki)"
            value={newPoolName}
            onChange={(e) => setNewPoolName(e.target.value)}
            style={{ flex: 1, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '2px 6px' }}
          />
          <input
            type="number"
            value={newPoolMax}
            onChange={(e) => setNewPoolMax(e.target.value)}
            className="tabular"
            style={{ width: 42, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '2px 4px' }}
          />
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (!newPoolName.trim()) return;
              onAddResource(newPoolName, Number.parseInt(newPoolMax, 10) || 1, 'short_rest');
              setNewPoolName('');
            }}
          >
            +
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            SKILLS (PASSIVE PERC {sheet.passivePerception})
          </span>
          <button type="button" className="btn" onClick={() => setSkillsExpanded((v) => !v)}>
            {skillsExpanded ? 'Hide' : 'Show'}
          </button>
        </div>
        {skillsExpanded &&
          ALL_SKILLS.map((skillKey) => {
            const stat = sheet.skills[skillKey];
            const sign = stat.final >= 0 ? '+' : '';
            const hasProf = stat.modifiers.length > 0;
            return (
              <div
                key={skillKey}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '2px 0',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <span style={{ color: hasProf ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                  {hasProf ? '● ' : '○ '}
                  {formatSkillLabel(skillKey)}
                </span>
                <button
                  type="button"
                  className="btn tabular"
                  onClick={() => onRollCheck(formatSkillLabel(skillKey), stat.final)}
                >
                  {sign}{stat.final}
                </button>
              </div>
            );
          })}
      </div>
    </aside>
  );
}
