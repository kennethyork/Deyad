import { useReducer, useCallback, useRef } from 'react';
import type { AppProject } from '../App';

export type RightTab = 'editor' | 'preview' | 'terminal' | 'database' | 'envvars' | 'packages' | 'git' | 'search';

/** Per-app state that persists across app switches. */
export interface PerAppState {
  appFiles: Record<string, string>;
  selectedFile: string | null;
  dbStatus: 'none' | 'running' | 'stopped';
  rightTab: RightTab;
  canRevert: boolean;
  pendingDiffFiles: Record<string, string> | null;
  preAgentFiles: Record<string, string> | null;
}

export const defaultPerAppState: PerAppState = {
  appFiles: {},
  selectedFile: null,
  dbStatus: 'none',
  rightTab: 'editor',
  canRevert: false,
  pendingDiffFiles: null,
  preAgentFiles: null,
};

export interface AppCoreState {
  apps: AppProject[];
  selectedApp: AppProject | null;
  perApp: Record<string, PerAppState>;
  openedApps: string[];
  activeTasks: number;
  previewRefreshKey: number;
  pendingPrompt: string | null;
}

export type AppAction =
  | { type: 'SET_APPS'; apps: AppProject[] }
  | { type: 'SELECT_APP'; app: AppProject | null }
  | { type: 'RENAME_APP'; appId: string; newName: string }
  | { type: 'UPDATE_PER_APP'; appId: string; updates: Partial<PerAppState> }
  | { type: 'SET_PER_APP_FULL'; appId: string; state: PerAppState }
  | { type: 'OPEN_APP'; appId: string }
  | { type: 'DELETE_APP_STATE'; appId: string }
  | { type: 'SET_ACTIVE_TASKS'; count: number }
  | { type: 'REFRESH_PREVIEW' }
  | { type: 'SET_PENDING_PROMPT'; prompt: string | null };

const initialState: AppCoreState = {
  apps: [],
  selectedApp: null,
  perApp: {},
  openedApps: [],
  activeTasks: 0,
  previewRefreshKey: 0,
  pendingPrompt: null,
};

function appReducer(state: AppCoreState, action: AppAction): AppCoreState {
  switch (action.type) {
    case 'SET_APPS':
      return { ...state, apps: action.apps };

    case 'SELECT_APP':
      return { ...state, selectedApp: action.app };

    case 'RENAME_APP': {
      const apps = state.apps.map((a) =>
        a.id === action.appId ? { ...a, name: action.newName } : a,
      );
      const selectedApp =
        state.selectedApp?.id === action.appId
          ? { ...state.selectedApp, name: action.newName }
          : state.selectedApp;
      return { ...state, apps, selectedApp };
    }

    case 'UPDATE_PER_APP': {
      const existing = state.perApp[action.appId] ?? defaultPerAppState;
      return {
        ...state,
        perApp: {
          ...state.perApp,
          [action.appId]: { ...existing, ...action.updates },
        },
      };
    }

    case 'SET_PER_APP_FULL':
      return {
        ...state,
        perApp: { ...state.perApp, [action.appId]: action.state },
      };

    case 'OPEN_APP':
      return {
        ...state,
        openedApps: state.openedApps.includes(action.appId)
          ? state.openedApps
          : [...state.openedApps, action.appId],
      };

    case 'DELETE_APP_STATE': {
      const perApp = { ...state.perApp };
      delete perApp[action.appId];
      return {
        ...state,
        perApp,
        openedApps: state.openedApps.filter((id) => id !== action.appId),
        selectedApp: state.selectedApp?.id === action.appId ? null : state.selectedApp,
      };
    }

    case 'SET_ACTIVE_TASKS':
      return { ...state, activeTasks: action.count };

    case 'REFRESH_PREVIEW':
      return { ...state, previewRefreshKey: state.previewRefreshKey + 1 };

    case 'SET_PENDING_PROMPT':
      return { ...state, pendingPrompt: action.prompt };

    default:
      return state;
  }
}

export function useAppReducer() {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Keep a ref to perApp for use in callbacks (avoids stale closures)
  const perAppRef = useRef(state.perApp);
  perAppRef.current = state.perApp;

  const updatePerApp = useCallback(
    (appId: string, updates: Partial<PerAppState>) => {
      dispatch({ type: 'UPDATE_PER_APP', appId, updates });
    },
    [],
  );

  // Derived state for the currently selected app
  const cur = state.selectedApp
    ? (state.perApp[state.selectedApp.id] ?? defaultPerAppState)
    : defaultPerAppState;

  return { state, dispatch, perAppRef, updatePerApp, cur };
}
