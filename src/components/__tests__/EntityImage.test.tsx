// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EntityImage } from '../EntityImage';

describe('EntityImage', () => {
  it('renders a lazy image without referrer and shows the credit in the inspector size', () => {
    const { container } = render(<EntityImage src="https://a.com/x.png" name="Aboleth" size="inspector" artCredit="Art by Z" />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(screen.getByText('Art by Z')).toBeTruthy();
  });

  it('falls back to initials and the category glyph when the picture fails to load', () => {
    const { container } = render(<EntityImage src="https://a.com/broken.png" name="Blue Dragon" category="monster" />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Blue Dragon' }).textContent).toContain('BD');
  });

  it('renders nothing for a missing src when hideWhenEmpty is set', () => {
    const { container } = render(<EntityImage src={undefined} name="X" hideWhenEmpty />);
    expect(container.firstChild).toBeNull();
  });
});
