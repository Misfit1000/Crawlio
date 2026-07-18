import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { BrowserRouter } from 'react-router';
import AppErrorBoundary from './components/AppErrorBoundary';
import { initializeBrowserMonitoring } from './lib/monitoring/sentry-browser';

initializeBrowserMonitoring();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <BrowserRouter>
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </BrowserRouter>
      </ThemeProvider>
    </AuthProvider>
  </StrictMode>,
);
