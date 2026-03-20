import React from 'react';

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', background: 'var(--bg-base)',
          color: 'var(--text-primary)', fontFamily: 'sans-serif', textAlign: 'center', gap: '1rem',
          padding: '2rem',
        }}>
          <div style={{ fontSize: '3rem' }}></div>
          <h1 style={{ margin: 0 }}>Something went wrong</h1>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '480px', margin: 0 }}>
            An unexpected error occurred. You can try reloading the app.
          </p>
          {this.state.error && (
            <pre style={{
              background: 'var(--bg-surface)', padding: '12px 16px', borderRadius: 8,
              maxWidth: '600px', overflow: 'auto', fontSize: '0.85rem',
              color: 'var(--danger)', textAlign: 'left', whiteSpace: 'pre-wrap',
            }}>
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.handleReload}
            style={{
              background: 'var(--accent)', color: '#fff', border: 'none',
              padding: '8px 24px', borderRadius: 8, fontSize: '1rem',
              cursor: 'pointer', marginTop: '0.5rem',
            }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
