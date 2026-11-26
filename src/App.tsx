import './styles/tokens.css';
import './styles/layout.css';
import './styles/utilities.css';
import { useSheetStore } from './state/useSheetStore';
import { SEED_CHARACTER, SEED_ENCOUNTER } from './state/seed';
import { useAppUiState } from './components/app/useAppUiState';
import { buildAppPanels } from './components/app/panels';
import { TopBar } from './components/app/TopBar';
import { AppBanners } from './components/app/AppBanners';
import { AppModals } from './components/app/AppModals';
import { PrintPacket } from './components/app/PrintPacket';
import { DmLayout } from './components/app/layouts/DmLayout';
import { ModularLayout } from './components/app/layouts/ModularLayout';
import { ClassicLayout } from './components/app/layouts/ClassicLayout';
import { UnifiedLayout } from './components/app/layouts/UnifiedLayout';

export function App() {
  const store = useSheetStore(SEED_CHARACTER, SEED_ENCOUNTER);
  const ui = useAppUiState(store);
  const panels = buildAppPanels(store, ui);
  const { shellClass, isPlayerRole, modularMode, uiMode } = ui;

  return (
    <div className={shellClass}>
      <TopBar store={store} ui={ui} />

      <AppBanners store={store} ui={ui} />

      {!isPlayerRole ? (
        <DmLayout store={store} ui={ui} panels={panels} />
      ) : modularMode ? (
        <ModularLayout store={store} ui={ui} panels={panels} />
      ) : uiMode === 'classic' ? (
        <ClassicLayout store={store} ui={ui} panels={panels} />
      ) : (
        <UnifiedLayout store={store} ui={ui} panels={panels} />
      )}

      <AppModals store={store} ui={ui} panels={panels} />

      <PrintPacket store={store} ui={ui} />
    </div>
  );
}
