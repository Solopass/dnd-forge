// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { CharacterManagerModal } from '../CharacterManagerModal';
import { SEED_CHARACTER } from '../../state/seed';
import { installDialogPolyfill } from './dialogPolyfill';

installDialogPolyfill();

function mount() {
  const onImportCharacterJson = vi.fn(async () => {});
  const onImportRejected = vi.fn();
  const view = render(
    <CharacterManagerModal
      isOpen
      onClose={() => {}}
      characters={[SEED_CHARACTER]}
      activeCharacterId={SEED_CHARACTER.id}
      onSelectCharacter={() => {}}
      onOpenNewCharacter={() => {}}
      onOpenBuilderForActive={() => {}}
      onDuplicateCharacter={async () => {}}
      onDeleteCharacter={async () => {}}
      onImportDdbPdf={async () => {}}
      onImportCharacterJson={onImportCharacterJson}
      onImportRejected={onImportRejected}
    />
  );
  const input = view.container.querySelector<HTMLInputElement>('input[accept="application/json,.json"]')!;
  return { input, onImportCharacterJson, onImportRejected };
}

function pick(input: HTMLInputElement, name: string, text: string) {
  const file = new File([text], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => text });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('Character JSON import (audit C5)', () => {
  afterEach(cleanup);

  it('reports malformed JSON instead of ignoring it', async () => {
    const { input, onImportCharacterJson, onImportRejected } = mount();
    pick(input, 'bad.json', '{oops');
    await waitFor(() => expect(onImportRejected).toHaveBeenCalled());
    expect(onImportRejected.mock.calls[0]![0]).toMatch(/bad\.json.*not valid JSON/);
    expect(onImportCharacterJson).not.toHaveBeenCalled();
  });

  it('reports a file without name/classes', async () => {
    const { input, onImportRejected } = mount();
    pick(input, 'other.json', '{"foo":1}');
    await waitFor(() => expect(onImportRejected).toHaveBeenCalled());
    expect(onImportRejected.mock.calls[0]![0]).toMatch(/missing name and classes/);
  });

  it('imports a valid character without reporting', async () => {
    const { input, onImportCharacterJson, onImportRejected } = mount();
    pick(input, 'ok.json', JSON.stringify({ name: 'Ayla', classes: [{ className: 'Fighter', level: 1, hitDie: 10 }], baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, hp: { current: 10, max: 10 } }));
    await waitFor(() => expect(onImportCharacterJson).toHaveBeenCalled());
    expect(onImportRejected).not.toHaveBeenCalled();
  });
});
