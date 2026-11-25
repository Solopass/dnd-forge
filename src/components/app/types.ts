import type { useSheetStore } from '../../state/useSheetStore';
import type { AppUi } from './useAppUiState';
import type { AppPanels } from './panels';

export type SheetStore = ReturnType<typeof useSheetStore>;

/** Props for pieces of the App shell that only need state. */
export type AppSectionProps = { store: SheetStore; ui: AppUi };

/** Props for layouts and other pieces that also render the shared panels. */
export type AppLayoutProps = AppSectionProps & { panels: AppPanels };
