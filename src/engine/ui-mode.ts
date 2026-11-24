export type UiMode = 'classic' | 'unified';

export const UI_MODE_STORAGE_KEY = 'dnd-forge-ui-mode';

export function readStoredUiMode(): UiMode {
  try {
    const val = localStorage.getItem(UI_MODE_STORAGE_KEY);
    if (val === 'unified' || val === 'classic') return val;
  } catch {
    // ignore storage failures
  }
  return 'classic';
}

export function applyUiMode(mode: UiMode): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.uiMode = mode;
  }
  try {
    localStorage.setItem(UI_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore storage failures
  }
}
