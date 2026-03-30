import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { isElectronApp } from './lib/electronCheck';
import './index.css';

function NotElectronError() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', background: '#0f172a',
      color: '#f8fafc', fontFamily: 'sans-serif', textAlign: 'center', gap: '1rem',
    }}>
      <div style={{ fontSize: '3rem' }}></div>
      <h1 style={{ margin: 0 }}>Dyad must run inside Electron</h1>
      <p style={{ color: '#94a3b8', maxWidth: '420px', margin: 0 }}>
        This page requires the Electron desktop environment. Please start the
        app with <code style={{ background: '#1e293b', padding: '2px 6px', borderRadius: 4 }}>npm start</code> instead of opening it directly in a browser.
      </p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isElectronApp() ? <ErrorBoundary><App /></ErrorBoundary> : <NotElectronError />}
  </React.StrictMode>,
);
