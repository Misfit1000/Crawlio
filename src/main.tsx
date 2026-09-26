import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { BrowserRouter } from './app/router';
import AppErrorBoundary from './components/AppErrorBoundary';
import { initializeBrowserMonitoring } from './lib/monitoring/sentry-browser';
import { AccessibilityProvider } from './contexts/AccessibilityContext';
import AccessibilityLayer from './components/accessibility/AccessibilityLayer';

initializeBrowserMonitoring();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <AccessibilityProvider>
          <BrowserRouter>
            <AppErrorBoundary>
              <AccessibilityLayer />
              <App />
            </AppErrorBoundary>
          </BrowserRouter>
        </AccessibilityProvider>
      </ThemeProvider>
    </AuthProvider>
  </StrictMode>,
);
