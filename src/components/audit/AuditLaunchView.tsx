import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, Globe, Loader2, AlertCircle } from 'lucide-react';
import { getAuditModeLabel, type AuditMode } from '../../lib/audit/audit-config';

export interface AuditLaunchState {
  phase: 'submitting' | 'error';
  url: string;
  mode: AuditMode;
  error?: string;
}

export function AuditLaunchView({ state, onRetry, onEdit }: {
  state: AuditLaunchState;
  onRetry: () => void;
  onEdit: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    performance.mark('crawlio:audit-launch-visible');
  }, [state.phase]);
  const failed = state.phase === 'error';
  return <main className="min-h-dvh bg-background text-foreground">
    <div className="mx-auto max-w-6xl px-6 py-8">
      <a href="/" className="text-sm font-semibold text-foreground">Crawlio</a>
      <section className="mx-auto mt-16 max-w-2xl text-center md:mt-24">
        <div className={`mx-auto mb-7 grid h-18 w-18 place-items-center rounded-lg border border-border bg-[var(--surface-inset)] ${failed ? 'text-[var(--danger)]' : 'text-accent'}`} aria-hidden="true">
          {failed ? <AlertCircle className="h-8 w-8" /> : <Globe className="h-8 w-8" />}
        </div>
        <p className="text-sm font-medium text-muted-foreground">{getAuditModeLabel(state.mode)}</p>
        <h1 ref={heading} tabIndex={-1} className="mt-3 text-3xl font-semibold outline-none sm:text-4xl">{failed ? 'Startup needs your attention' : 'Starting your audit'}</h1>
        <p className="mt-4 break-all text-base text-muted-foreground">{state.url}</p>
        {failed ? <>
          <p role="alert" className="mt-6 text-sm leading-6 text-[var(--danger)]">{state.error}</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3"><button type="button" className="trust-button" onClick={onRetry}>Try again <ArrowRight className="h-4 w-4" /></button><button type="button" className="quiet-button" onClick={onEdit}><ArrowLeft className="h-4 w-4" />Edit audit</button></div>
        </> : <div role="status" className="mt-8 flex items-center justify-center gap-3 text-sm"><Loader2 className="h-4 w-4 animate-spin text-accent" /><span>Submitting to the audit queue</span></div>}
        <ol aria-label="Audit stages" className="mt-12 grid grid-cols-4 gap-2 text-xs text-muted-foreground">{['Submit', 'Queue', 'Check pages', 'Report'].map((stage, index) => <li key={stage} aria-current={!failed && index === 0 ? 'step' : undefined} className={`border-t-2 pt-3 ${!failed && index === 0 ? 'border-accent text-accent' : 'border-border'}`}>{stage}</li>)}</ol>
      </section>
    </div>
  </main>;
}
