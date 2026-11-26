// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ContentFixEditor } from '../ContentFixEditor';
import { ContentFixesReview, type ContentFixApi } from '../ContentFixesReview';
import { createFix, exportFixesFile } from '../../engine/content-fixes';
import type { CompendiumEntity } from '../../types/compendium';
import type { ContentFix } from '../../types/content-fix';

afterEach(cleanup);

const spell: CompendiumEntity = {
  id: 'ui-spark',
  name: 'Synthetic Spark',
  source: 'Test Book',
  ruleset: '2014',
  category: 'spell',
  spellLevel: 1,
  range: '30 feet',
  entries: ['A spark leaps out.'],
  activities: [{ id: 'ui-spark-a', name: 'Spark', type: 'save', actionEconomy: 'action', saveAbility: 'dex', saveDcFormula: '@prof + 8', damageFormula: '1d6', damageType: 'fire' }],
};

function makeFix(status: ContentFix['status'], tweak?: (c: CompendiumEntity) => void): ContentFix {
  const edited = structuredClone(spell);
  edited.activities[0]!.damageFormula = '2d6';
  tweak?.(edited);
  const r = createFix({ base: spell, edited, note: 'dice are 2d6', author: 'Player' });
  if ('error' in r) throw new Error(r.error);
  return { ...r.fix, status };
}

function api(role: 'dm' | 'player', fixes: ContentFix[], over: Partial<ContentFixApi> = {}): ContentFixApi {
  return {
    role,
    fixes,
    entities: [spell],
    getEffective: () => spell,
    propose: vi.fn(async () => ({ ok: true as const })),
    review: vi.fn(async () => ({ ok: true as const })),
    remove: vi.fn(async () => true),
    patchAgainstOriginal: () => ({}),
    exportFile: () => exportFixesFile(fixes, [spell]),
    importText: vi.fn(async () => ({ imported: 0, skipped: [] })),
    ...over,
  };
}

describe('ContentFixEditor', () => {
  it('is prefilled, counts the changed fields, and passes the edited entry and note up', async () => {
    const onSubmit = vi.fn(async () => null);
    render(<ContentFixEditor entity={spell} onSubmit={onSubmit} onCancel={() => undefined} />);
    expect((screen.getByLabelText('Damage formula') as HTMLInputElement).value).toBe('1d6');
    expect((screen.getByLabelText('Spell level') as HTMLInputElement).value).toBe('1');
    expect(screen.getByTestId('fix-change-count').textContent).toBe('No changes yet.');
    fireEvent.change(screen.getByLabelText('Damage formula'), { target: { value: '2d6' } });
    fireEvent.change(screen.getByLabelText('Save DC'), { target: { value: '12' } });
    expect(screen.getByTestId('fix-change-count').textContent).toMatch(/^2 fields changed/);
    fireEvent.change(screen.getByLabelText(/^Note/), { target: { value: 'dice are 2d6' } });
    fireEvent.click(screen.getByText('Propose fix'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [edited, note] = onSubmit.mock.calls[0] as unknown as [CompendiumEntity, string];
    expect(note).toBe('dice are 2d6');
    expect(edited.activities[0]!.damageFormula).toBe('2d6');
    expect(edited.activities[0]!.saveDcFormula).toBe('12');
    expect(edited.entries).toEqual(spell.entries); // untouched text stays exactly as it was
    expect(spell.activities[0]!.damageFormula).toBe('1d6');
  });

  it('shows the error the caller returns (for example a missing note)', async () => {
    render(<ContentFixEditor entity={spell} onSubmit={async () => 'Add a note saying what is wrong.'} onCancel={() => undefined} />);
    fireEvent.click(screen.getByText('Propose fix'));
    expect((await screen.findByRole('alert')).textContent).toBe('Add a note saying what is wrong.');
  });
});

describe('ContentFixesReview', () => {
  it('lists fixes with a before/after diff; a player sees no approve or reject buttons', () => {
    render(<ContentFixesReview api={api('player', [makeFix('proposed')])} />);
    expect(screen.getByTestId('fix-card').textContent).toContain('Damage formula (Spark)');
    expect(screen.getByTestId('fix-card').textContent).toContain('1d6');
    expect(screen.getByTestId('fix-card').textContent).toContain('2d6');
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.queryByText('Reject')).toBeNull();
    expect(screen.queryByText('Edit, then approve')).toBeNull();
  });

  it('the DM can approve, reject and revert; status filters work', async () => {
    const proposed = makeFix('proposed');
    const approved = { ...makeFix('approved', (c) => (c.range = '60 feet')), id: 'fix-approved' };
    const a = api('dm', [proposed, approved]);
    render(<ContentFixesReview api={a} />);
    expect(screen.getAllByTestId('fix-card')).toHaveLength(2);
    fireEvent.click(screen.getByText(/^Approved \(1\)/));
    expect(screen.getAllByTestId('fix-card')).toHaveLength(1);
    fireEvent.click(screen.getByText('Revert to original'));
    await waitFor(() => expect(a.remove).toHaveBeenCalledWith('fix-approved'));
    fireEvent.click(screen.getByText(/^Proposed \(1\)/));
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(a.review).toHaveBeenCalledWith(proposed.id, 'approved'));
    fireEvent.click(screen.getByText('Reject'));
    await waitFor(() => expect(a.review).toHaveBeenCalledWith(proposed.id, 'rejected'));
  });

  it('a fix whose entry changed since shows "Needs re-review" with an explanation', () => {
    const stale = { ...makeFix('approved'), baseSnapshotHash: 'old-hash' };
    render(<ContentFixesReview api={api('dm', [stale])} />);
    expect(screen.getByTestId('fix-card').textContent).toContain('Needs re-review');
    expect(screen.getByTestId('fix-card').textContent).toContain('not applied');
    expect(screen.getByText('Approve')).toBeTruthy();
  });
});
