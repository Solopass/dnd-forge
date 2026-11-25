import type { AppSectionProps } from './types';

export function PrintPacket({ store, ui }: AppSectionProps) {
  const {
    charLevel,
    classSummary,
  } = ui;
  return (
    <section className="print-session-packet" aria-hidden="true">
      <h1>{store.campaign.name} — Session Prep Packet</h1>
      <p>
        Setting: {store.campaign.setting} • Day {store.campaign.clock.day},{' '}
        {String(store.campaign.clock.hour).padStart(2, '0')}:
        {String(store.campaign.clock.minute).padStart(2, '0')} ({store.campaign.clock.weather})
      </p>
      <h2>Active Character: {store.rawChar.name}</h2>
      <p>
        {store.rawChar.species} • {classSummary} • Lvl {charLevel} • AC {store.resolvedSheet.ac.final} • HP {store.resolvedSheet.hp.current}/{store.resolvedSheet.hp.max} • Walk {store.resolvedSheet.speeds.walk}ft
        {store.resolvedSheet.speeds.fly > 0 ? `, Fly ${store.resolvedSheet.speeds.fly}ft` : ''}
        {store.resolvedSheet.speeds.swim > 0 ? `, Swim ${store.resolvedSheet.speeds.swim}ft` : ''}
        {store.resolvedSheet.senses.darkvision > 0 ? ` • Darkvision ${store.resolvedSheet.senses.darkvision}ft` : ''}
      </p>
      {store.rawChar.structuredProficiencies && (
        <p style={{ fontSize: 12 }}>
          <strong>Proficiencies:</strong>{' '}
          {[
            store.rawChar.structuredProficiencies.armor.length ? `Armor (${store.rawChar.structuredProficiencies.armor.join(', ')})` : '',
            store.rawChar.structuredProficiencies.weapons.length ? `Weapons (${store.rawChar.structuredProficiencies.weapons.join(', ')})` : '',
            store.rawChar.structuredProficiencies.tools.length ? `Tools (${store.rawChar.structuredProficiencies.tools.join(', ')})` : '',
            store.rawChar.structuredProficiencies.languages.length ? `Languages (${store.rawChar.structuredProficiencies.languages.join(', ')})` : '',
          ]
            .filter(Boolean)
            .join(' • ')}
        </p>
      )}
      {store.rawChar.details && (
        <p style={{ fontSize: 12 }}>
          {[
            store.rawChar.details.alignment,
            store.rawChar.details.traits ? `Traits: ${store.rawChar.details.traits}` : '',
            store.rawChar.details.ideals ? `Ideals: ${store.rawChar.details.ideals}` : '',
            store.rawChar.details.bonds ? `Bonds: ${store.rawChar.details.bonds}` : '',
            store.rawChar.details.flaws ? `Flaws: ${store.rawChar.details.flaws}` : '',
          ]
            .filter(Boolean)
            .join(' • ')}
        </p>
      )}
      <h2>Campaign Binder ({store.campaign.entries.length} Entries)</h2>
      {store.campaign.entries.map((entry) => (
        <div key={entry.id} style={{ marginBottom: 10, borderBottom: '1px solid #ccc', paddingBottom: 6 }}>
          <strong>
            [{entry.category.toUpperCase()}] {entry.title}
          </strong>{' '}
          — {entry.summary}
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{entry.body}</div>
        </div>
      ))}
      <h2>Active Encounter: {store.encounter.name} (Round {store.encounter.round})</h2>
      <ul>
        {store.encounter.combatants.map((c) => (
          <li key={c.id}>
            {c.name} — Init {c.initiative}, AC {c.ac}, HP {c.hp.current}/{c.hp.max}
          </li>
        ))}
      </ul>
    </section>
  );
}
