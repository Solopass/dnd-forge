import { ShieldIcon } from '../Icons';
import { evaluateDiceExpression } from '../../engine/dice';
import type { AppSectionProps } from './types';

export function AppBanners({ store, ui }: AppSectionProps) {
  const {
    setBuilderOpen,
    setGearOpen,
    modularMode,
    setShortRestOpen,
    uiMode,
    showClassicCombat,
    setShowClassicCombat,
    isPlayerRole,
    charLevel,
    classSummary,
  } = ui;
  return (
    <>
      {isPlayerRole && !modularMode && uiMode === 'classic' && (
        <div className="beyond-hero-banner">
          <div className="beyond-hero-identity">
            <label
              className="beyond-crest"
              style={{ cursor: 'pointer', overflow: 'hidden' }}
              title="Click to upload character avatar"
            >
              {store.rawChar.avatarUrl ? (
                <img
                  src={store.rawChar.avatarUrl}
                  alt={store.rawChar.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                store.rawChar.name.slice(0, 2).toUpperCase()
              )}
              <input
                type="file"
                accept="image/*"
                className="is-hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === 'string') store.setCharacterAvatar(reader.result);
                  };
                  reader.readAsDataURL(file);
                  e.target.value = '';
                }}
              />
            </label>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.15 }}>
                {store.rawChar.name}
              </div>
              <div className="forge-muted text-sm">
                {store.rawChar.species} • {classSummary} • Level {charLevel}
              </div>
            </div>
          </div>
          <div className="forge-row wrap">
            <button type="button" className="btn" onClick={() => setShortRestOpen(true)}>
              Short Rest
            </button>
            <button type="button" className="btn" onClick={() => store.takeRest('long_rest')}>
              Long Rest
            </button>
            <button type="button" className="btn" onClick={() => setBuilderOpen(true)}>
              Build / Stats
            </button>
            <button type="button" className="btn" onClick={() => setGearOpen(true)}>
              Gear &amp; Spells ({store.resolvedSheet.attunementCount}/3)
            </button>
            <button
              type="button"
              className={`pill ${showClassicCombat ? 'active' : ''}`}
              aria-pressed={showClassicCombat}
              onClick={() => setShowClassicCombat((v) => !v)}
            >
              Combat Rail {showClassicCombat ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      )}

      {isPlayerRole && !modularMode && uiMode === 'classic' && (
        <div className="beyond-ability-bar" aria-label="Ability scores and combat vitals">
          <div className="beyond-ability-strip">
            {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((key) => {
              const ab = store.resolvedSheet.abilities[key];
              const modSign = ab.modifier >= 0 ? '+' : '';
              const saveSign = ab.save.final >= 0 ? '+' : '';
              const isSaveProf = ab.save.modifiers.some((m) => m.id.startsWith('save-prof-'));
              return (
                <div
                  key={key}
                  className="ability-tile"
                  style={{ borderColor: isSaveProf ? 'var(--accent-gold)' : 'var(--border-subtle)' }}
                >
                  <div className="ability-tile-head">
                    <strong>{key}</strong>
                    <span className="badge tabular" style={{ padding: '0 4px' }}>{ab.score.final}</span>
                  </div>
                  <button
                    type="button"
                    className="ability-tile-mod tabular"
                    style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', width: '100%' }}
                    onClick={() => {
                      const s = ab.modifier >= 0 ? '+' : '';
                      const res = evaluateDiceExpression(`1d20${s}${ab.modifier}`, store.rollMode);
                      store.appendLog(`${key.toUpperCase()} Check (${res.mode}): ${res.total}`, res.isCrit ? 'crit' : 'roll');
                    }}
                  >
                    {modSign}{ab.modifier}
                  </button>
                  <button
                    type="button"
                    className={`btn tabular ${isSaveProf ? 'btn-primary' : ''}`}
                    style={{ width: '100%', padding: '1px 4px', fontSize: 10 }}
                    onClick={() => {
                      const s = ab.save.final >= 0 ? '+' : '';
                      const res = evaluateDiceExpression(`1d20${s}${ab.save.final}`, store.rollMode);
                      store.appendLog(`${key.toUpperCase()} Save (${res.mode}): ${res.total}`, res.isCrit ? 'crit' : 'roll');
                    }}
                  >
                    {isSaveProf ? '★ ' : 'Sv '}
                    {saveSign}{ab.save.final}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="beyond-combat-strip">
            <div className="beyond-stat-box beyond-stat-shield">
              <span className="stat-tile-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <ShieldIcon size={11} /> AC
              </span>
              <span className="stat-tile-val tabular">{store.resolvedSheet.ac.final}</span>
            </div>
            <button type="button" className="beyond-stat-box clickable" onClick={store.rollCharacterInitiative}>
              <span className="stat-tile-label">INIT</span>
              <span className="stat-tile-val tabular">
                {store.resolvedSheet.initiative.final >= 0 ? `+${store.resolvedSheet.initiative.final}` : store.resolvedSheet.initiative.final}
              </span>
            </button>
            <div className="beyond-stat-box">
              <span className="stat-tile-label">SPEED</span>
              <span className="stat-tile-val tabular">{store.resolvedSheet.speed.final}ft</span>
            </div>
            <div className="beyond-stat-box">
              <span className="stat-tile-label">
                {store.resolvedSheet.spellcasting.primaryAbility ? 'SPELL DC' : 'PROF'}
              </span>
              <span className="stat-tile-val tabular">
                {store.resolvedSheet.spellcasting.primaryAbility
                  ? store.resolvedSheet.spellcasting.saveDc.final
                  : `+${store.resolvedSheet.proficiencyBonus.final}`}
              </span>
            </div>
          </div>
        </div>
      )}

      {!isPlayerRole && store.encounter.combatants.some((c) => c.kind === 'pc') && (
        <div
          className="subpanel forge-row"
          style={{
            padding: '5px 14px',
            margin: '6px 14px 0',
            flexWrap: 'wrap',
            gap: 8,
            flexShrink: 0,
          }}
          aria-label="DM Party Live Status Strip"
        >
          <span className="muted-label">PARTY VITALS</span>
          {store.encounter.combatants
            .filter((c) => c.kind === 'pc')
            .map((pc) => (
              <span key={pc.id} className="badge tabular">
                <strong>{pc.name}</strong> • HP {pc.hp.current}/{pc.hp.max} • AC {pc.ac}
                {pc.conditions.length > 0 ? ` • ${pc.conditions.join(', ')}` : ''}
              </span>
            ))}
        </div>
      )}

      {store.initiativeAlert && (
        <div
          className="subpanel forge-row-between initiative-alert-banner"
          role="alert"
          style={{
            padding: '10px 14px',
            margin: '6px 14px 0',
            flexWrap: 'wrap',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span>
            <strong style={{ color: 'var(--accent-red)', letterSpacing: '0.06em' }}>
              ⚔ ROLL INITIATIVE!
            </strong>{' '}
            {store.initiativeAlert.senderName} started{' '}
            <strong>{store.initiativeAlert.encounterName}</strong>
          </span>
          <div className="forge-row gap-2">
            <button
              type="button"
              className="btn btn-primary tabular"
              onClick={() => {
                store.rollCharacterInitiative();
                store.dismissInitiativeAlert();
              }}
            >
              Roll Initiative (
              {store.resolvedSheet.initiative.final >= 0
                ? `+${store.resolvedSheet.initiative.final}`
                : store.resolvedSheet.initiative.final}
              )
            </button>
            <button type="button" className="btn" onClick={store.dismissInitiativeAlert}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {store.pendingConcDc !== null && (
        <div
          className="subpanel forge-row-between"
          role="alert"
          style={{
            padding: '8px 14px',
            margin: '6px 14px 0',
            borderColor: 'color-mix(in oklab, var(--accent-danger) 65%, var(--border-subtle))',
            background: 'color-mix(in oklab, var(--accent-danger) 12%, var(--bg-surface))',
            flexWrap: 'wrap',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <div className="forge-row gap-3">
            <span className="badge" style={{ color: 'var(--accent-red)', borderColor: 'var(--accent-red)' }}>
              CONCENTRATION CHECK
            </span>
            <span>
              Roll Constitution saving throw vs <strong className="tabular">DC {store.pendingConcDc}</strong>
            </span>
          </div>
          <div className="forge-row gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => store.rollConcentrationSave(store.pendingConcDc ?? 10)}
            >
              Roll CON Save (DC {store.pendingConcDc})
            </button>
            <button type="button" className="btn btn-danger" onClick={() => store.dropConcentration('Dropped manually')}>
              Drop Concentration
            </button>
          </div>
        </div>
      )}

      {store.pendingRollRequest && (
        <div
          className="subpanel forge-row-between"
          role="alert"
          style={{
            padding: '10px 16px',
            margin: '8px 16px 0',
            borderColor: 'rgba(245, 158, 11, 0.55)',
            background: 'rgba(245, 158, 11, 0.08)',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div className="forge-row gap-3 wrap">
            <span className="badge" style={{ color: 'var(--accent-amber)', borderColor: 'rgba(245, 158, 11, 0.5)' }}>
              DM ROLL REQUEST
            </span>
            <strong>{store.pendingRollRequest.senderName}</strong> requests{' '}
            <strong>{store.pendingRollRequest.label}</strong>
            {store.pendingRollRequest.dc !== undefined && (
              <span className="badge tabular">DC {store.pendingRollRequest.dc}</span>
            )}
          </div>
          <div className="forge-row gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const req = store.pendingRollRequest;
                if (!req) return;
                let mod = 0;
                if (req.kind === 'save') {
                  const ab = store.resolvedSheet.abilities[req.abilityOrSkill as keyof typeof store.resolvedSheet.abilities];
                  mod = ab?.save.final ?? 0;
                } else {
                  const sk = store.resolvedSheet.skills[req.abilityOrSkill as keyof typeof store.resolvedSheet.skills];
                  mod = sk?.final ?? 0;
                }
                const sign = mod >= 0 ? '+' : '';
                store.rollInlineExpression(
                  `${req.label}${req.dc ? ` (DC ${req.dc})` : ''}`,
                  `1d20${sign}${mod}`
                );
                store.dismissRollRequest();
              }}
            >
              Roll Now
            </button>
            <button type="button" className="btn" onClick={store.dismissRollRequest}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}
