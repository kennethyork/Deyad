import { useReducer, useCallback } from 'react';

export interface ModalState {
  showNewAppModal: boolean;
  showSettings: boolean;
  showImportModal: boolean;
  showDeployModal: boolean;
  showTaskQueue: boolean;
  showVersionHistory: boolean;
  showCommandPalette: boolean;
  showWizard: boolean;
  exportConfirm: { open: boolean; appId: string };
  exportResult: string | null;
}

type ModalAction =
  | { type: 'SET'; key: keyof ModalState; value: boolean }
  | { type: 'TOGGLE'; key: keyof ModalState }
  | { type: 'SET_EXPORT_CONFIRM'; value: { open: boolean; appId: string } }
  | { type: 'SET_EXPORT_RESULT'; value: string | null };

const initialState: ModalState = {
  showNewAppModal: false,
  showSettings: false,
  showImportModal: false,
  showDeployModal: false,
  showTaskQueue: false,
  showVersionHistory: false,
  showCommandPalette: false,
  showWizard: false,
  exportConfirm: { open: false, appId: '' },
  exportResult: null,
};

function modalReducer(state: ModalState, action: ModalAction): ModalState {
  switch (action.type) {
    case 'SET':
      return { ...state, [action.key]: action.value };
    case 'TOGGLE':
      return { ...state, [action.key]: !state[action.key] };
    case 'SET_EXPORT_CONFIRM':
      return { ...state, exportConfirm: action.value };
    case 'SET_EXPORT_RESULT':
      return { ...state, exportResult: action.value };
    default:
      return state;
  }
}

type BooleanModalKey =
  'showNewAppModal' | 'showSettings' | 'showImportModal' | 'showDeployModal' |
  'showTaskQueue' | 'showVersionHistory' | 'showCommandPalette' | 'showWizard';

export function useModals() {
  const [state, dispatch] = useReducer(modalReducer, initialState);

  const setter = (key: BooleanModalKey) =>
    (v: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof v === 'function' ? v(state[key] as boolean) : v;
      dispatch({ type: 'SET', key, value: next });
    };

  const openModal = useCallback((modal: BooleanModalKey) => {
    dispatch({ type: 'SET', key: modal, value: true });
  }, []);

  const closeModal = useCallback((modal: BooleanModalKey) => {
    dispatch({ type: 'SET', key: modal, value: false });
  }, []);

  return {
    showNewAppModal: state.showNewAppModal,
    setShowNewAppModal: setter('showNewAppModal'),
    showSettings: state.showSettings,
    setShowSettings: setter('showSettings'),
    showImportModal: state.showImportModal,
    setShowImportModal: setter('showImportModal'),
    showDeployModal: state.showDeployModal,
    setShowDeployModal: setter('showDeployModal'),
    showTaskQueue: state.showTaskQueue,
    setShowTaskQueue: setter('showTaskQueue'),
    showVersionHistory: state.showVersionHistory,
    setShowVersionHistory: setter('showVersionHistory'),
    showCommandPalette: state.showCommandPalette,
    setShowCommandPalette: setter('showCommandPalette'),
    showWizard: state.showWizard,
    setShowWizard: setter('showWizard'),
    exportConfirm: state.exportConfirm,
    setExportConfirm: (v: { open: boolean; appId: string }) =>
      dispatch({ type: 'SET_EXPORT_CONFIRM', value: v }),
    exportResult: state.exportResult,
    setExportResult: (v: string | null) =>
      dispatch({ type: 'SET_EXPORT_RESULT', value: v }),
    openModal,
    closeModal,
  };
}
