// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LevelUpModal } from '../LevelUpModal';
import { installDialogPolyfill } from './dialogPolyfill';

installDialogPolyfill();
import { SEED_CHARACTER } from '../../state/seed';
import type { CompendiumEntity } from '../../types/compendium';
import type { RawCharacterState } from '../../types/character';

function spell(id: string, name: string, source: string, classes?: string[], level = 1): CompendiumEntity {
  return { id, name, source, ruleset: '2014', category: 'spell', spellLevel: level, classes, activities: [], entries: [name] };
}

const POOL: CompendiumEntity[] = [
  spell('srd-eb', 'Eldritch Blast', 'SRD 5.1', ['Warlock'], 0),
  spell('f5e-eb', 'Eldritch Blast Copy', 'Free5e (Solopass/free5e)', undefined, 0),
  spell('hb-art', 'Arcane Widget', 'Homebrew', ['Artificer'], 1),
];

function artificer(): RawCharacterState {
  return {
    ...SEED_CHARACTER,
    classes: [{ className: 'Artificer', level: 3, hitDie: 8, casterProgression: 'half_up' }],
  };
}

describe('LevelUpModal spell picks (audit C4)', () => {
  afterEach(cleanup);

  it('offers an Artificer only spells on the Artificer list, not Warlock or class-less ones', () => {
    render(<LevelUpModal isOpen character={artificer()} compendiumEntities={POOL} onClose={() => {}} onApplyLevelUp={() => {}} />);
    expect(screen.getByText(/Arcane Widget/)).toBeTruthy();
    expect(screen.queryByText(/Eldritch Blast/)).toBeNull();
  });
});
