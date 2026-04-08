/**
 * Extracted state hook for TerminalChat overlay and prompt state.
 * Reduces the number of top-level useState calls in the main component.
 */
import { useReducer, useCallback } from "react";

export type OverlayMode = "none" | "history" | "model" | "approval" | "help";

interface OverlayState {
  mode: OverlayMode;
  initialPrompt: string | undefined;
  initialImagePaths: Array<string> | undefined;
}

type OverlayAction =
  | { type: "setOverlay"; mode: OverlayMode }
  | { type: "clearPrompt" }
  | { type: "clearImagePaths" };

function overlayReducer(state: OverlayState, action: OverlayAction): OverlayState {
  switch (action.type) {
    case "setOverlay":
      return { ...state, mode: action.mode };
    case "clearPrompt":
      return { ...state, initialPrompt: undefined };
    case "clearImagePaths":
      return { ...state, initialImagePaths: undefined };
    default:
      return state;
  }
}

export function useOverlayState(
  initialPrompt: string | undefined,
  initialImagePaths: Array<string> | undefined,
) {
  const [state, dispatch] = useReducer(overlayReducer, {
    mode: "none" as OverlayMode,
    initialPrompt,
    initialImagePaths,
  });

  const setOverlayMode = useCallback(
    (mode: OverlayMode) => dispatch({ type: "setOverlay", mode }),
    [],
  );
  const clearPrompt = useCallback(() => dispatch({ type: "clearPrompt" }), []);
  const clearImagePaths = useCallback(
    () => dispatch({ type: "clearImagePaths" }),
    [],
  );

  return {
    overlayMode: state.mode,
    initialPrompt: state.initialPrompt,
    initialImagePaths: state.initialImagePaths,
    setOverlayMode,
    clearPrompt,
    clearImagePaths,
  };
}
