import { useMemo, useState } from 'react';
import { crToXp, evaluateEncounterDifficulty } from '../engine/encounter-math';
import { BUILTIN_CONTENT_PACKS } from '../engine/srd-packs';
import { CompendiumEntity, CreatureSize } from '../types/compendium';
import { ModalDialog } from './ModalDialog';

interface EncounterBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  partyLevels: number[];
  compendiumMonsters?: CompendiumEntity[];
  onSpawnMonsters: (monsters: CompendiumEntity[]) => void;
  onCreateCustomMonster: (entity: CompendiumEntity) => void;
}

export function EncounterBuilderModal({
  isOpen,
  onClose,
  partyLevels,
  compendiumMonsters = [],
  onSpawnMonsters,
  onCreateCustomMonster,
}: EncounterBuilderModalProps) {
  const [tab, setTab] = useState<'builder' | 'forge'>('builder');
  const [query, setQuery] = useState('');
  const [crFilter, setCrFilter] = useState<'all' | 'low' | 'mid' | 'high' | 'boss'>('all');
  const [sizeFilter, setSizeFilter] = useState<'all' | CreatureSize>('all');
  const [staged, setStaged] = useState<Array<{ entity: CompendiumEntity; count: number }>>([]);

  // Custom Monster Forge fields
  const [mName, setMName] = useState('');
  const [mCr, setMCr] = useState('3');
  const [mSize, setMSize] = useState<CreatureSize>('large');
  const [mAc, setMAc] = useState(15);
  const [mHp, setMHp] = useState(65);
  const [mDex, setMDex] = useState(2);
  const [mSpeed, setMSpeed] = useState('40 ft');
  const [mAtkName, setMAtkName] = useState('Multiattack Strike');
  const [mAtkBonus, setMAtkBonus] = useState('+6');
  const [mDmg, setMDmg] = useState('2d8+4');
  const [mDmgType, setMDmgType] = useState('slashing');
  const [mTraits, setMTraits] = useState('Pack Tactics or Magic Resistance.');

  const allMonsters = useMemo(() => {
    const map = new Map<string, CompendiumEntity>();
    for (const m of BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities)) {
      if (m.category === 'monster') map.set(m.id, m);
    }
    for (const m of compendiumMonsters) {
      if (m.category === 'monster') map.set(m.id, m);
    }
    return Array.from(map.values());
  }, [compendiumMonsters]);

  const filteredMonsters = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allMonsters.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q)) return false;
      if (sizeFilter !== 'all' && (m.monsterMeta?.size ?? 'medium') !== sizeFilter) return false;
      const xp = crToXp(m.monsterMeta?.cr);
      if (crFilter === 'low' && xp > 200) return false;
      if (crFilter === 'mid' && (xp <= 200 || xp > 1800)) return false;
      if (crFilter === 'high' && (xp <= 1800 || xp > 8400)) return false;
      if (crFilter === 'boss' && xp <= 8400) return false;
      return true;
    });
  }, [allMonsters, query, sizeFilter, crFilter]);

  const stagedCrs = staged.flatMap((s) =>
    Array.from({ length: s.count }, () => s.entity.monsterMeta?.cr ?? '1')
  );
  const diff = useMemo(
    () => evaluateEncounterDifficulty(partyLevels, stagedCrs),
    [partyLevels, stagedCrs]
  );

  const addToStage = (entity: CompendiumEntity) => {
    setStaged((prev) => {
      const existing = prev.find((p) => p.entity.id === entity.id);
      if (existing) {
        return prev.map((p) => (p.entity.id === entity.id ? { ...p, count: p.count + 1 } : p));
      }
      return [...prev, { entity, count: 1 }];
    });
  };

  const handleSpawnStaged = () => {
    const expanded = staged.flatMap((s) => Array.from({ length: s.count }, () => s.entity));
    if (expanded.length === 0) return;
    onSpawnMonsters(expanded);
    setStaged([]);
    onClose();
  };

  const handleCreateCustom = (spawnNow: boolean) => {
    const clean = mName.trim();
    if (!clean) return;
    const entity: CompendiumEntity = {
      id: `custom-mob-${Date.now().toString(36)}`,
      name: clean,
      source: 'Custom Forge',
      ruleset: '2014',
      category: 'monster',
      monsterMeta: {
        ac: Math.max(5, mAc),
        hp: Math.max(1, mHp),
        dexModifier: mDex,
        cr: mCr.trim() || '1',
        size: mSize,
        speeds: mSpeed.trim() || '30 ft',
      },
      activities: [
        {
          id: `act-${Date.now().toString(36)}`,
          name: mAtkName.trim() || 'Strike',
          type: 'attack',
          actionEconomy: 'action',
          attackBonusFormula: mAtkBonus.trim() || '+4',
          damageFormula: mDmg.trim() || '1d8+2',
          damageType: mDmgType.trim() || 'slashing',
        },
      ],
      entries: [mTraits.trim() || 'Custom forged creature.'],
    };
    onCreateCustomMonster(entity);
    if (spawnNow) {
      onSpawnMonsters([entity]);
    }
    setMName('');
    onClose();
  };

  return (
    <ModalDialog isOpen={isOpen} wide onClose={onClose} title="Encounter Builder & Monster Forge">
      <div className="forge-stack">
        <div className="pill-row">
          <button
            type="button"
            className={`pill ${tab === 'builder' ? 'active' : ''}`}
            onClick={() => setTab('builder')}
          >
            Encounter Builder
          </button>
          <button
            type="button"
            className={`pill ${tab === 'forge' ? 'active' : ''}`}
            onClick={() => setTab('forge')}
          >
            Custom Monster Forge
          </button>
        </div>

        {tab === 'builder' && (
          <div className="forge-stack">
            <div className="subpanel forge-row-between" style={{ padding: 10, flexWrap: 'wrap', gap: 8 }}>
              <div className="forge-row" style={{ flexWrap: 'wrap' }}>
                <span className="badge tabular">Easy {diff.thresholds.easy}</span>
                <span className="badge tabular">Med {diff.thresholds.medium}</span>
                <span className="badge tabular">Hard {diff.thresholds.hard}</span>
                <span className="badge tabular">Deadly {diff.thresholds.deadly}</span>
              </div>
              <div className="forge-row">
                <span className="badge tabular">
                  Staged: <strong>{diff.adjustedXp} adj XP</strong> ({diff.rating})
                </span>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={staged.length === 0}
                  onClick={handleSpawnStaged}
                >
                  Spawn ({stagedCrs.length})
                </button>
              </div>
            </div>

            {staged.length > 0 && (
              <div className="pill-row">
                {staged.map((s) => (
                  <button
                    key={s.entity.id}
                    type="button"
                    className="pill active"
                    title="Click to remove one"
                    onClick={() =>
                      setStaged((prev) =>
                        prev
                          .map((p) => (p.entity.id === s.entity.id ? { ...p, count: p.count - 1 } : p))
                          .filter((p) => p.count > 0)
                      )
                    }
                  >
                    {s.count}× {s.entity.name} (CR {s.entity.monsterMeta?.cr ?? '?'}) ×
                  </button>
                ))}
              </div>
            )}

            <div className="forge-row" style={{ flexWrap: 'wrap' }}>
              <input
                type="text"
                className="input"
                style={{ flex: '1 1 180px' }}
                placeholder="Search monsters by name..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                className="select"
                aria-label="Filter by CR tier"
                value={crFilter}
                onChange={(e) => setCrFilter(e.target.value as typeof crFilter)}
              >
                <option value="all">All CRs</option>
                <option value="low">CR 0–1 (Tier 1)</option>
                <option value="mid">CR 2–5 (Tier 2)</option>
                <option value="high">CR 6–12 (Tier 3)</option>
                <option value="boss">CR 13+ (Boss)</option>
              </select>
              <select
                className="select"
                aria-label="Filter by size"
                value={sizeFilter}
                onChange={(e) => setSizeFilter(e.target.value as typeof sizeFilter)}
              >
                <option value="all">All Sizes</option>
                <option value="tiny">Tiny</option>
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
                <option value="huge">Huge</option>
                <option value="gargantuan">Gargantuan</option>
              </select>
            </div>

            <div className="table-wrapper" style={{ maxHeight: 340 }}>
              <table className="forge-table">
                <thead>
                  <tr>
                    <th>Monster</th>
                    <th>CR</th>
                    <th>Size</th>
                    <th>AC / HP</th>
                    <th>Add</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMonsters.map((m) => (
                    <tr key={m.id}>
                      <th scope="row">{m.name}</th>
                      <td data-label="CR" className="tabular">{m.monsterMeta?.cr ?? '1'}</td>
                      <td data-label="Size">{m.monsterMeta?.size ?? 'medium'}</td>
                      <td data-label="AC / HP" className="tabular">
                        AC {m.monsterMeta?.ac ?? 12} • {m.monsterMeta?.hp ?? 10} HP
                      </td>
                      <td data-label="Add">
                        <button type="button" className="btn" onClick={() => addToStage(m)}>
                          + Stage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'forge' && (
          <div className="subpanel forge-stack" style={{ padding: 12 }}>
            <div className="forge-row" style={{ flexWrap: 'wrap' }}>
              <input
                type="text"
                className="input"
                style={{ flex: '2 1 200px' }}
                placeholder="Monster Name (e.g. Ashfang Drake)"
                value={mName}
                onChange={(e) => setMName(e.target.value)}
              />
              <input
                type="text"
                className="input"
                style={{ width: 80 }}
                placeholder="CR"
                value={mCr}
                onChange={(e) => setMCr(e.target.value)}
              />
              <select
                className="select"
                aria-label="Monster size"
                value={mSize}
                onChange={(e) => setMSize(e.target.value as CreatureSize)}
              >
                <option value="tiny">Tiny</option>
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
                <option value="huge">Huge</option>
                <option value="gargantuan">Gargantuan</option>
              </select>
            </div>
            <div className="forge-row" style={{ flexWrap: 'wrap' }}>
              <label className="forge-row">
                <span className="muted-label">AC</span>
                <input
                  type="number"
                  className="input input-compact"
                  style={{ width: 64 }}
                  value={mAc}
                  onChange={(e) => setMAc(Number.parseInt(e.target.value, 10) || 10)}
                />
              </label>
              <label className="forge-row">
                <span className="muted-label">HP</span>
                <input
                  type="number"
                  className="input input-compact"
                  style={{ width: 74 }}
                  value={mHp}
                  onChange={(e) => setMHp(Number.parseInt(e.target.value, 10) || 10)}
                />
              </label>
              <label className="forge-row">
                <span className="muted-label">DEX</span>
                <input
                  type="number"
                  className="input input-compact"
                  style={{ width: 60 }}
                  value={mDex}
                  onChange={(e) => setMDex(Number.parseInt(e.target.value, 10) || 0)}
                />
              </label>
              <input
                type="text"
                className="input"
                style={{ flex: '1 1 140px' }}
                placeholder="Speeds (e.g. 40 ft, Fly 60 ft)"
                value={mSpeed}
                onChange={(e) => setMSpeed(e.target.value)}
              />
            </div>
            <div className="forge-row" style={{ flexWrap: 'wrap' }}>
              <input
                type="text"
                className="input"
                style={{ flex: '2 1 160px' }}
                placeholder="Primary Attack Name"
                value={mAtkName}
                onChange={(e) => setMAtkName(e.target.value)}
              />
              <input
                type="text"
                className="input"
                style={{ width: 70 }}
                placeholder="+Atk"
                value={mAtkBonus}
                onChange={(e) => setMAtkBonus(e.target.value)}
              />
              <input
                type="text"
                className="input"
                style={{ width: 100 }}
                placeholder="Damage"
                value={mDmg}
                onChange={(e) => setMDmg(e.target.value)}
              />
              <input
                type="text"
                className="input"
                style={{ width: 110 }}
                placeholder="Type"
                value={mDmgType}
                onChange={(e) => setMDmgType(e.target.value)}
              />
            </div>
            <textarea
              className="textarea"
              rows={3}
              placeholder="Traits, resistances, or tactical notes..."
              value={mTraits}
              onChange={(e) => setMTraits(e.target.value)}
            />
            <div className="forge-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!mName.trim()}
                onClick={() => handleCreateCustom(true)}
              >
                Save to Compendium &amp; Spawn
              </button>
              <button
                type="button"
                className="btn"
                disabled={!mName.trim()}
                onClick={() => handleCreateCustom(false)}
              >
                Save to Compendium Only
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
