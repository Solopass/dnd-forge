// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MoreMenu } from '../app/MoreMenu';

function mount() {
  return render(
    <div>
      <MoreMenu items={[{ key: 'a', label: 'Item A', onSelect: () => {} }]} />
      <button type="button">Outside</button>
    </div>
  );
}

describe('More menu closing (audit N11)', () => {
  afterEach(cleanup);

  it('closes when focus moves to something outside it', () => {
    mount();
    const toggle = screen.getByRole('button', { name: /More/ });
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Item A' })).toBeTruthy();
    // Tab inside the menu keeps it open
    fireEvent.blur(toggle, { relatedTarget: screen.getByRole('button', { name: 'Item A' }) });
    expect(screen.queryByRole('button', { name: 'Item A' })).toBeTruthy();
    // Tab out of the last item closes it
    fireEvent.blur(screen.getByRole('button', { name: 'Item A' }), { relatedTarget: screen.getByRole('button', { name: 'Outside' }) });
    expect(screen.queryByRole('button', { name: 'Item A' })).toBeNull();
  });

  it('closes on pointerdown outside, not on mousedown alone', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('button', { name: 'Item A' })).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('button', { name: 'Item A' })).toBeNull();
  });
});
