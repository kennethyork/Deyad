import { Box, Text } from "ink";
import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Ink-compatible error boundary that catches render crashes
 * and displays a styled error message instead of crashing the TUI.
 */
export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("[deyad] TUI crash caught by ErrorBoundary:");
    // eslint-disable-next-line no-console
    console.error(error);
    if (info.componentStack) {
      // eslint-disable-next-line no-console
      console.error(info.componentStack);
    }
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      const message = this.state.error?.message ?? "Unknown error";
      return (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="redBright"
          paddingX={1}
          gap={1}
        >
          <Text color="redBright" bold>
            ✖ deyad encountered an unexpected error
          </Text>
          <Text dimColor>{message}</Text>
          <Text color="yellow">
            Press Ctrl+C to exit, then restart deyad to continue.
          </Text>
        </Box>
      );
    }
    return this.props.children;
  }
}
