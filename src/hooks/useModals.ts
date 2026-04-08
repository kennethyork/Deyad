import { useState, useCallback } from 'react';

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

export function useModals() {
  const [showNewAppModal, setShowNewAppModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showTaskQueue, setShowTaskQueue] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [exportConfirm, setExportConfirm] = useState<{ open: boolean; appId: string }>({ open: false, appId: '' });
  const [exportResult, setExportResult] = useState<string | null>(null);

  const openModal = useCallback((modal: keyof Pick<ModalState,
    'showNewAppModal' | 'showSettings' | 'showImportModal' | 'showDeployModal' |
    'showTaskQueue' | 'showVersionHistory' | 'showCommandPalette' | 'showWizard'
  >) => {
    const setters: Record<string, (v: boolean) => void> = {
      showNewAppModal: setShowNewAppModal,
      showSettings: setShowSettings,
      showImportModal: setShowImportModal,
      showDeployModal: setShowDeployModal,
      showTaskQueue: setShowTaskQueue,
      showVersionHistory: setShowVersionHistory,
      showCommandPalette: setShowCommandPalette,
      showWizard: setShowWizard,
    };
    setters[modal]?.(true);
  }, []);

  const closeModal = useCallback((modal: keyof Pick<ModalState,
    'showNewAppModal' | 'showSettings' | 'showImportModal' | 'showDeployModal' |
    'showTaskQueue' | 'showVersionHistory' | 'showCommandPalette' | 'showWizard'
  >) => {
    const setters: Record<string, (v: boolean) => void> = {
      showNewAppModal: setShowNewAppModal,
      showSettings: setShowSettings,
      showImportModal: setShowImportModal,
      showDeployModal: setShowDeployModal,
      showTaskQueue: setShowTaskQueue,
      showVersionHistory: setShowVersionHistory,
      showCommandPalette: setShowCommandPalette,
      showWizard: setShowWizard,
    };
    setters[modal]?.(false);
  }, []);

  return {
    showNewAppModal, setShowNewAppModal,
    showSettings, setShowSettings,
    showImportModal, setShowImportModal,
    showDeployModal, setShowDeployModal,
    showTaskQueue, setShowTaskQueue,
    showVersionHistory, setShowVersionHistory,
    showCommandPalette, setShowCommandPalette,
    showWizard, setShowWizard,
    exportConfirm, setExportConfirm,
    exportResult, setExportResult,
    openModal, closeModal,
  };
}
