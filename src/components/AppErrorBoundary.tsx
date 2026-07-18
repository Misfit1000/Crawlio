import React from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { BrandMark } from './ui/visual-system';
import { captureReactRenderError } from '../lib/monitoring/sentry-browser';

interface State {
  failed: boolean;
}

export interface AppErrorBoundaryProps {
  children: React.ReactNode;
  onCapture?: (error: unknown, componentStack: string) => void;
}

export default class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (this.props.onCapture) {
      this.props.onCapture(error, errorInfo.componentStack || '');
    } else {
      captureReactRenderError(error, errorInfo.componentStack || '');
    }
    console.error('Crawlio render recovery boundary');
  }

  private retry = () => {
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="min-h-screen bg-background text-foreground">
        <header className="flex h-16 items-center border-b border-border bg-card px-4 md:px-6"><BrandMark /></header>
        <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-2xl items-center p-4 sm:p-6">
          <section className="w-full rounded-lg border border-red-500/25 bg-card p-5 sm:p-7" role="alert">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-300"><AlertTriangle className="h-5 w-5" /></div>
            <h1 className="mt-5 text-2xl font-semibold">This view could not be displayed</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Your audit has not been deleted. Try rendering this view again, or return to the dashboard and reopen it from audit history.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" className="trust-button" onClick={this.retry}><RefreshCw className="h-4 w-4" /> Try again</button>
              <a className="quiet-button" href="/app"><Home className="h-4 w-4" /> Dashboard</a>
            </div>
          </section>
        </main>
      </div>
    );
  }
}
