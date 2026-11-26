import { useState } from 'react';
import type { CompendiumEntity } from '../types/compendium';
import type { AbilityKey } from '../types/core';
import { diffEntities } from '../engine/content-fixes';

const ABILITY_OPTIONS: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

interface ContentFixEditorProps {
  /** The entry as it is now (approved fixes applied); the form is prefilled from it. */
  entity: CompendiumEntity;
  /** Where the changes are measured against when the form is submitted. */
  title?: string;
  initialNote?: string;
  submitLabel?: string;
  onSubmit: (edited: CompendiumEntity, note: string) => Promise<string | null> | string | null;
  onCancel: () => void;
}

type ActivityDraft = {
  id: string;
  label: string;
  type: string;
  attackBonusFormula: string;
  damageFormula: string;
  damageType: string;
  saveAbility: string;
  saveDcFormula: string;
};

const textOf = (e: CompendiumEntity) => e.entries.join('\n\n');
const orUndef = (s: string): string | undefined => (s.trim() === '' ? undefined : s.trim());

/** Editor for the common fields of a compendium entry. Saving proposes a fix; the entry itself is never edited. */
export function ContentFixEditor({ entity, title, initialNote = '', submitLabel = 'Propose fix', onSubmit, onCancel }: ContentFixEditorProps) {
  const [name, setName] = useState(entity.name);
  const [text, setText] = useState(textOf(entity));
  const [spellLevel, setSpellLevel] = useState(entity.spellLevel === undefined ? '' : String(entity.spellLevel));
  const [range, setRange] = useState(entity.range ?? '');
  const [cr, setCr] = useState(entity.monsterMeta?.cr ?? '');
  const [ac, setAc] = useState(entity.monsterMeta ? String(entity.monsterMeta.ac) : '');
  const [hp, setHp] = useState(entity.monsterMeta ? String(entity.monsterMeta.hp) : '');
  const [acts, setActs] = useState<ActivityDraft[]>(() =>
    entity.activities.map((a) => ({
      id: a.id,
      label: a.name,
      type: a.type,
      attackBonusFormula: a.attackBonusFormula ?? '',
      damageFormula: a.damageFormula ?? '',
      damageType: a.damageType ?? '',
      saveAbility: a.saveAbility ?? '',
      saveDcFormula: a.saveDcFormula ?? '',
    }))
  );
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setAct = (id: string, patch: Partial<ActivityDraft>) =>
    setActs((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const buildEdited = (): CompendiumEntity => {
    const out = structuredClone(entity);
    out.name = name.trim() || entity.name;
    if (text !== textOf(entity)) {
      out.entries = text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);
    }
    if (entity.spellLevel !== undefined || spellLevel !== '') {
      const n = Number.parseInt(spellLevel, 10);
      if (Number.isFinite(n)) out.spellLevel = Math.min(9, Math.max(0, n));
    }
    if (entity.range !== undefined || range !== '') {
      const r = orUndef(range);
      if (r === undefined) delete out.range;
      else out.range = r;
    }
    if (out.monsterMeta) {
      const meta = out.monsterMeta;
      const crv = orUndef(cr);
      if (crv === undefined) delete meta.cr;
      else meta.cr = crv;
      const acN = Number.parseInt(ac, 10);
      if (Number.isFinite(acN)) meta.ac = acN;
      const hpN = Number.parseInt(hp, 10);
      if (Number.isFinite(hpN)) meta.hp = hpN;
    }
    for (const d of acts) {
      const a = out.activities.find((x) => x.id === d.id);
      if (!a) continue;
      const setOrDrop = <K extends 'attackBonusFormula' | 'damageFormula' | 'damageType' | 'saveDcFormula'>(key: K, v: string) => {
        const val = orUndef(v);
        if (val === undefined) delete a[key];
        else a[key] = val;
      };
      setOrDrop('attackBonusFormula', d.attackBonusFormula);
      setOrDrop('damageFormula', d.damageFormula);
      setOrDrop('damageType', d.damageType);
      setOrDrop('saveDcFormula', d.saveDcFormula);
      if (d.saveAbility === '') delete a.saveAbility;
      else a.saveAbility = d.saveAbility as AbilityKey;
    }
    return out;
  };

  const changes = diffEntities(entity, buildEdited());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const err = await onSubmit(buildEdited(), note);
      if (err) setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fix-form forge-stack" data-testid="fix-editor">
      <div className="forge-section-label">{title ?? `Report / fix: ${entity.name}`}</div>
      <div className="forge-muted text-sm">
        Your change is saved as a proposed fix next to the original entry. It is applied only after the DM approves it.
      </div>

      <label className="fix-field">
        <span>Name</span>
        <input className="forge-input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="fix-field">
        <span>Text</span>
        <textarea className="forge-input fix-form__text" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      </label>

      {(entity.category === 'spell' || entity.range !== undefined) && (
        <div className="fix-form__row">
          {entity.category === 'spell' && (
            <label className="fix-field">
              <span>Spell level</span>
              <input className="forge-input" type="number" min={0} max={9} value={spellLevel} onChange={(e) => setSpellLevel(e.target.value)} />
            </label>
          )}
          <label className="fix-field">
            <span>Range</span>
            <input className="forge-input" value={range} onChange={(e) => setRange(e.target.value)} />
          </label>
        </div>
      )}

      {entity.monsterMeta && (
        <div className="fix-form__row">
          <label className="fix-field">
            <span>CR</span>
            <input className="forge-input" value={cr} onChange={(e) => setCr(e.target.value)} />
          </label>
          <label className="fix-field">
            <span>AC</span>
            <input className="forge-input" type="number" value={ac} onChange={(e) => setAc(e.target.value)} />
          </label>
          <label className="fix-field">
            <span>HP</span>
            <input className="forge-input" type="number" value={hp} onChange={(e) => setHp(e.target.value)} />
          </label>
        </div>
      )}

      {acts.map((a) => (
        <fieldset key={a.id} className="fix-form__activity">
          <legend>{a.label}</legend>
          <div className="fix-form__row">
            {(a.type === 'attack' || a.attackBonusFormula !== '') && (
              <label className="fix-field">
                <span>Attack bonus</span>
                <input className="forge-input" value={a.attackBonusFormula} onChange={(e) => setAct(a.id, { attackBonusFormula: e.target.value })} />
              </label>
            )}
            <label className="fix-field">
              <span>Damage formula</span>
              <input className="forge-input" value={a.damageFormula} onChange={(e) => setAct(a.id, { damageFormula: e.target.value })} />
            </label>
            <label className="fix-field">
              <span>Damage type</span>
              <input className="forge-input" value={a.damageType} onChange={(e) => setAct(a.id, { damageType: e.target.value })} />
            </label>
          </div>
          {(a.type === 'save' || a.saveAbility !== '' || a.saveDcFormula !== '') && (
            <div className="fix-form__row">
              <label className="fix-field">
                <span>Save ability</span>
                <select className="forge-input" value={a.saveAbility} onChange={(e) => setAct(a.id, { saveAbility: e.target.value })}>
                  <option value="">(none)</option>
                  {ABILITY_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {k.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fix-field">
                <span>Save DC</span>
                <input className="forge-input" value={a.saveDcFormula} onChange={(e) => setAct(a.id, { saveDcFormula: e.target.value })} />
              </label>
            </div>
          )}
        </fieldset>
      ))}

      <label className="fix-field">
        <span>Note (required): what is wrong?</span>
        <input className="forge-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Damage should be 2d6 per the book, p. 123" />
      </label>

      <div className="forge-muted text-sm" data-testid="fix-change-count">
        {changes.length === 0 ? 'No changes yet.' : `${changes.length} field${changes.length === 1 ? '' : 's'} changed: ${changes.map((c) => c.label).join(', ')}`}
      </div>
      {error && (
        <div className="fix-form__error" role="alert">
          {error}
        </div>
      )}
      <div className="forge-row gap-2">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
          {submitLabel}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
