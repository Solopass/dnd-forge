import { useState } from 'react';
import { ResolvedCharacterSheet } from '../types/character';
import { AbilityKey, RecoveryTrigger, SkillKey, STANDARD_CONDITIONS } from '../types/core';
import { SKILL_ABILITY_MAP } from '../engine/rules-math';

interface VitalsColumnProps {
  sheet: ResolvedCharacterSheet;
  onAdjustHp: (delta: number) => void;
  onSetTempHp: (temp: number) => void;
  onSetExhaustion: (level: number) => void;
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

function getHpBarClass(current: number, max: number): string {
  if (max <= 0) return 'hp-low';
  const ratio = current / max;
  if (ratio > 0.5) return 'hp-high';
  if (ratio > 0.25) return 'hp-mid';
  return 'hp-low';
}

export function VitalsColumn({
  sheet,
  onAdjustHp,
  onSetTempHp,
  onSetExhaustion,
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
  const [hpDeltaInput, setHpDeltaInput] = useState('');
  const [tempHpInput, setTempHpInput] = useState('');
  const [skillsExpanded, setSkillsExpanded] = useState(true);
  const [skillFilter, setSkillFilter] = useState('');
  const [selectedCondition, setSelectedCondition] = useState<string>(STANDARD_CONDITIONS[0]);
  const [newPoolName, setNewPoolName] = useState('');
  const [newPoolMax, setNewPoolMax] = useState('3');

  const initSign = sheet.initiative.final >= 0 ? '+' : '';
  const hpPct = sheet.hp.max > 0 ? Math.max(0, Math.min(100, (sheet.hp.current / sheet.hp.max) * 100)) : 0;
  const exhaustionCheckPenalty = sheet.ruleset === '2024' ? -2 * sheet.exhaustion : 0;

  const filteredSkills = ALL_SKILLS.filter((sk) =>
    formatSkillLabel(sk).toLowerCase().includes(skillFilter.trim().toLowerCase())
  );

  const applyCustomHp = (sign: 1 | -1) => {
    const amount = Math.abs(Number.parseInt(hpDeltaInput, 10));
    if (!Number.isNaN(amount) && amount > 0) {
      onAdjustHp(sign * amount);
      setHpDeltaInput('');
    }
  };

  return (
    <aside className="pane" aria-label="Character Vitals">
      <div className="card">
        <div className="forge-row-between">
          <div>
            <strong>{sheet.name}</strong>
            <div className="forge-muted" style={{ fontSize: 11 }}>
              Lvl {sheet.totalLevel} • {sheet.ruleset.toUpperCase()} • Prof +{sheet.proficiencyBonus.final}
            </div>
          </div>
          <div className="forge-row">
            <span className="forge-muted" style={{ fontSize: 11 }}>Exh</span>
            <button
              type="button"
              className="btn"
              aria-label="Decrease exhaustion"
              onClick={() => onSetExhaustion(sheet.exhaustion - 1)}
            >
              -
            </button>
            <span className="tabular" style={{ minWidth: 16, textAlign: 'center' }}>
              {sheet.exhaustion}
            </span>
            <button
              type="button"
              className="btn"
              aria-label="Increase exhaustion"
              onClick={() => onSetExhaustion(sheet.exhaustion + 1)}
            >
              +
            </button>
          </div>
        </div>

        {sheet.exhaustion > 0 && sheet.ruleset === '2024' && (
          <div className="forge-muted" style={{ color: 'var(--accent-amber)', fontSize: 11, marginTop: 4 }}>
            2024 Exhaustion active: {-2 * sheet.exhaustion} to d20 tests &amp; Save DCs
          </div>
        )}

        <div className="stat-strip">
          <button
            type="button"
            className="stat-tile"
            onClick={() => setInspectAc((v) => !v)}
            title="Click to inspect AC math or set override"
          >
            <span className="stat-tile-label">AC</span>
            <span className="stat-tile-val tabular">{sheet.ac.final}</span>
          </button>
          <button
            type="button"
            className="stat-tile"
            onClick={onRollInitiative}
            title="Roll Initiative and join Active Combat"
          >
            <span className="stat-tile-label">INIT</span>
            <span className="stat-tile-val tabular">{initSign}{sheet.initiative.final}</span>
          </button>
          <div className="stat-tile">
            <span className="stat-tile-label">SPEED</span>
            <span className="stat-tile-val tabular">{sheet.speed.final}ft</span>
          </div>
          <div className="stat-tile">
            <span className="stat-tile-label">
              {sheet.spellcasting.primaryAbility ? 'SPELL DC' : 'PROF'}
            </span>
            <span className="stat-tile-val tabular">
              {sheet.spellcasting.primaryAbility
                ? sheet.spellcasting.saveDc.final
                : `+${sheet.proficiencyBonus.final}`}
            </span>
          </div>
        </div>

        {inspectAc && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
            <div className="forge-muted" style={{ fontSize: 11 }}>
              Formula: {sheet.ac.activeFormulaSource} ({sheet.ac.base})
              {sheet.ac.modifiers.map((m) => ` + ${m.value} (${m.source})`).join('')}
            </div>
            <div className="forge-row" style={{ marginTop: 6 }}>
              <input
                aria-label="Override AC"
                type="number"
                placeholder="Override AC"
                value={acInput}
                onChange={(e) => setAcInput(e.target.value)}
                className="forge-input tabular"
                style={{ width: 95 }}
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

        <div className="forge-row-between" style={{ marginTop: 10 }}>
          <span className="tabular">
            HP <strong>{sheet.hp.current}</strong> / {sheet.hp.max}
            {sheet.hp.temp > 0 ? ` (+${sheet.hp.temp} tmp)` : ''}
          </span>
          <div className="forge-row">
            <button type="button" className="btn" onClick={() => onAdjustHp(-5)}>-5</button>
            <button type="button" className="btn" onClick={() => onAdjustHp(-1)}>-1</button>
            <button type="button" className="btn" onClick={() => onAdjustHp(1)}>+1</button>
            <button type="button" className="btn" onClick={() => onAdjustHp(5)}>+5</button>
          </div>
        </div>

        <div className="hp-bar-track" aria-hidden="true">
          <div
            className={`hp-bar-fill ${getHpBarClass(sheet.hp.current, sheet.hp.max)}`}
            style={{ width: `${hpPct}%` }}
          />
        </div>

        <div className="forge-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <input
            aria-label="Exact damage or healing amount"
            type="number"
            min={1}
            placeholder="Amt"
            value={hpDeltaInput}
            onChange={(e) => setHpDeltaInput(e.target.value)}
            className="forge-input tabular"
            style={{ width: 64, padding: '3px 6px' }}
          />
          <button type="button" className="btn btn-danger" onClick={() => applyCustomHp(-1)}>
            Dmg
          </button>
          <button type="button" className="btn btn-primary" onClick={() => applyCustomHp(1)}>
            Heal
          </button>
          <input
            aria-label="Temporary HP"
            type="number"
            placeholder="Temp"
            value={tempHpInput}
            onChange={(e) => setTempHpInput(e.target.value)}
            className="forge-input tabular"
            style={{ width: 64, padding: '3px 6px' }}
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
            Temp
          </button>
        </div>

        {sheet.hp.current === 0 && (
          <div style={{ marginTop: 8, padding: 6, background: 'rgba(248, 81, 73, 0.12)', borderRadius: 4 }}>
            <div style={{ fontSize: 11, color: 'var(--accent-red)', marginBottom: 4 }}>
              DEATH SAVING THROWS
            </div>
            <div className="forge-row-between" style={{ fontSize: 12 }}>
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

        <div className="forge-row" style={{ marginTop: 8 }}>
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

        <div className="forge-row" style={{ marginTop: 8 }}>
          <select
            aria-label="Condition to toggle"
            className="forge-input"
            value={selectedCondition}
            onChange={(e) => setSelectedCondition(e.target.value)}
            style={{ flex: 1, padding: '3px 6px' }}
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
        <div className="forge-section-label">ABILITIES &amp; SAVING THROWS</div>
        <div className="ability-grid">
          {ABILITIES.map((key) => {
            const ab = sheet.abilities[key];
            const checkMod = ab.modifier + exhaustionCheckPenalty;
            const modSign = checkMod >= 0 ? '+' : '';
            const saveSign = ab.save.final >= 0 ? '+' : '';
            const isSaveProf = ab.save.modifiers.some((m) => m.id.startsWith('save-prof-'));
            return (
              <div key={key} className="ability-tile">
                <div className="ability-tile-head">
                  <strong>{key}</strong>
                  <span className="tabular">{ab.score.final}</span>
                </div>
                <div className="ability-tile-mod tabular">
                  {modSign}{checkMod}
                </div>
                <div className="ability-tile-actions">
                  <button
                    type="button"
                    className="btn tabular"
                    onClick={() => onRollCheck(`${key.toUpperCase()} Check`, checkMod)}
                    title={`Roll ${key.toUpperCase()} ability check`}
                  >
                    Chk
                  </button>
                  <button
                    type="button"
                    className={`btn tabular ${isSaveProf ? 'btn-primary' : ''}`}
                    onClick={() => onRollCheck(`${key.toUpperCase()} Save`, ab.save.final)}
                    title={`Roll ${key.toUpperCase()} saving throw`}
                  >
                    {isSaveProf ? '★' : ''}
                    {saveSign}{ab.save.final}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="forge-section-label">RESOURCE POOLS</div>
        {sheet.resources.map((pool) => (
          <div key={pool.id} className="forge-list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <div className="forge-row-between">
              <span>{pool.name}</span>
              <div className="forge-row">
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
        <div className="forge-row" style={{ marginTop: 6 }}>
          <input
            aria-label="Custom resource pool name"
            type="text"
            placeholder="Custom Pool (e.g. Luck)"
            value={newPoolName}
            onChange={(e) => setNewPoolName(e.target.value)}
            className="forge-input"
            style={{ flex: 1, padding: '3px 6px' }}
          />
          <input
            aria-label="Custom resource pool max"
            type="number"
            value={newPoolMax}
            onChange={(e) => setNewPoolMax(e.target.value)}
            className="forge-input tabular"
            style={{ width: 46, padding: '3px 4px' }}
          />
          <button
            type="button"
            className="btn"
            aria-label="Add custom resource pool"
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
        <div className="forge-row-between" style={{ marginBottom: 6 }}>
          <span className="forge-label tabular">
            PASSIVE: PERC {sheet.passivePerception} • INV {sheet.passiveInvestigation} • INS {sheet.passiveInsight}
          </span>
          <button type="button" className="btn" onClick={() => setSkillsExpanded((v) => !v)}>
            {skillsExpanded ? 'Hide' : 'Show'}
          </button>
        </div>
        {skillsExpanded && (
          <>
            <input
              aria-label="Filter skills"
              type="text"
              placeholder="Filter skills..."
              value={skillFilter}
              onChange={(e) => setSkillFilter(e.target.value)}
              className="forge-input"
              style={{ width: '100%', padding: '3px 6px', marginBottom: 6 }}
            />
            {filteredSkills.map((skillKey) => {
              const stat = sheet.skills[skillKey];
              const sign = stat.final >= 0 ? '+' : '';
              const profMod = stat.modifiers.find((m) => m.id.startsWith('skill-prof-'));
              const badge =
                profMod?.source === 'Expertise'
                  ? '★★ '
                  : profMod?.source === 'Proficiency'
                  ? '● '
                  : profMod?.source === 'Half-Proficiency'
                  ? '◐ '
                  : '○ ';
              return (
                <div
                  key={skillKey}
                  className="forge-list-row"
                  style={{ padding: '2px 0' }}
                >
                  <span style={{ color: profMod ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    {badge}
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
          </>
        )}
      </div>
    </aside>
  );
}
