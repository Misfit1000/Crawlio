import { memo, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Clock3, FileText, WifiOff } from 'lucide-react';
import type { ResourceAuditDocument, ResourceAuditLiveData } from '../../lib/audit/resource-types';
import type { AuditLiveScoreSnapshot } from '../../lib/audit/audit-live-score';
import type { LiveAuditConnectionState } from '../../lib/audit/live-supabase-client';
import { formatAuditElapsed, isTerminalAuditStatus } from '../../lib/audit/audit-time';
import { auditScopeScoreLabel } from '../../lib/audit/audit-scope';
import { auditScopeProgressLabel, scopeEvents, scopeFindings } from '../../lib/report/scope-presentation';
import { ProgressBar, RadialScoreGauge, StatusBadge } from '../ui/visual-system';
import { AuditPageMap } from './AuditPageMap';
import { AuditActivityFeed } from './AuditActivityPanel';
import type { AuditCategoryScore } from './AuditExecutiveSummary';
import './audit-report.css';

export const AuditLiveSummary = memo(function AuditLiveSummary({ audit, score, now, heading, message, connection }: {
  audit: ResourceAuditDocument;
  score: AuditLiveScoreSnapshot;
  now?: number;
  heading?: string;
  message?: string;
  connection: LiveAuditConnectionState;
}) {
  const terminal = isTerminalAuditStatus(audit.status);
  const [localNow, setLocalNow] = useState(Date.now);
  const needsLocalClock = now == null && !terminal;
  useEffect(() => {
    if (!needsLocalClock) return;
    let interval: number | undefined;
    const sync = () => {
      if (interval != null) window.clearInterval(interval);
      interval = undefined;
      if (document.hidden) return;
      setLocalNow(Date.now());
      interval = window.setInterval(() => setLocalNow(Date.now()), 1000);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      if (interval != null) window.clearInterval(interval);
    };
  }, [needsLocalClock]);
  const disconnected = !terminal && connection.status === 'error';
  return <section className="audit-live-strip grid items-center gap-6 rounded-lg border border-border bg-card p-6 lg:grid-cols-12" aria-label="Audit progress">
    <div className="audit-live-stage min-w-0 lg:col-span-5">
      <div className="flex items-center gap-3">
        <span className={`audit-stage-dot h-3 w-3 shrink-0 rounded-full ${disconnected ? 'bg-[var(--warning)]' : 'bg-[var(--action,var(--accent))]'}`} aria-hidden="true" />
        <h2 className="text-base font-semibold" aria-live="polite">{heading || (audit.status === 'queued' ? 'Waiting for an audit engine' : 'Checking pages')}</h2>
      </div>
      {message && <p className="mt-2 text-sm leading-6 text-muted-foreground">{message}</p>}
      <div className="mt-4"><ProgressBar label={auditScopeProgressLabel(audit)} value={Math.max(0, Math.min(100, audit.progress || 0))} /></div>
      {disconnected && <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground"><WifiOff className="h-4 w-4" />Reconnecting. Showing the last received evidence.</p>}
    </div>
    <dl className="audit-live-numbers grid grid-cols-3 gap-4 lg:col-span-5">
      <div className="flex min-w-0 flex-col-reverse gap-2"><dt className="text-xs text-muted-foreground">Pages analysed</dt><dd className="text-2xl font-semibold tabular-nums">{audit.pagesCrawled.toLocaleString()}<span className="text-sm text-muted-foreground"> / {audit.pageLimit.toLocaleString()}</span></dd></div>
      <div className="flex min-w-0 flex-col-reverse gap-2"><dt className="text-xs text-muted-foreground">Findings</dt><dd className="text-2xl font-semibold tabular-nums">{audit.issuesFound.toLocaleString()}</dd></div>
      <div className="flex min-w-0 flex-col-reverse gap-2"><dt className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />Elapsed</dt><dd className="text-2xl font-semibold tabular-nums">{formatAuditElapsed(audit, now ?? localNow)}</dd></div>
    </dl>
    <div className="audit-live-score min-w-0 lg:col-span-2">
      {score.overallScore == null ? <div className="audit-score-pending flex flex-col items-center gap-3 text-center"><span aria-hidden="true">--</span><div><strong className="text-sm font-semibold">Score pending</strong><p className="mt-1 text-xs text-muted-foreground">Waiting for measured checks</p></div></div> : <RadialScoreGauge value={score.overallScore} label={audit.scope ? auditScopeScoreLabel(audit.scope) : 'Audit score'} detail={`${score.scoreState === 'final' ? 'Final' : 'Preliminary'} / ${score.pagesAnalysed.toLocaleString()} analysed pages`} size="sm" />}
    </div>
  </section>;
});

export const AuditLiveEvidence = memo(function AuditLiveEvidence({ data, categoryScores, target, onViewFindings, onViewActivity }: {
  data: ResourceAuditLiveData;
  categoryScores: AuditCategoryScore[];
  target?: string | null;
  onViewFindings: () => void;
  onViewActivity: () => void;
}) {
  const issues = useMemo(() => scopeFindings(data.audit?.scope, data.latestIssues), [data.audit?.scope, data.latestIssues]);
  const events = useMemo(() => scopeEvents(data.audit?.scope, data.latestEvents), [data.audit?.scope, data.latestEvents]);
  return <div className="audit-live-evidence space-y-8">
    <div className="audit-live-evidence-grid grid gap-6 rounded-lg border border-border bg-card p-6 xl:grid-cols-3">
      <div className="min-w-0 xl:col-span-2"><AuditPageMap pages={data.latestPages} issues={issues} audit={data.audit || undefined} /></div>
      <section className="audit-live-checks min-w-0" aria-labelledby="live-checks-title">
        <div className="audit-section-heading mb-6 flex flex-wrap items-center justify-between gap-4"><h2 id="live-checks-title">Measured checks</h2></div>
        {categoryScores.length ? <dl className="audit-check-list divide-y divide-border">{categoryScores.map(item => <div key={item.label} className="flex items-baseline justify-between gap-4 py-4"><dt className="text-sm font-medium">{item.label}</dt><dd className="shrink-0 text-lg font-semibold text-accent"><span className="tabular-nums">{Math.round(item.value)}</span><span className="text-xs text-muted-foreground"> / 100</span></dd></div>)}</dl> : <p className="py-6 text-sm leading-6 text-muted-foreground">Selected checks will appear here as measurements arrive.</p>}
        <p className="mt-4 text-xs leading-5 text-muted-foreground">Preliminary measurements can change as more pages are analysed.</p>
        {target && <div className="audit-current-page mt-6 border-t border-border pt-6"><p className="text-xs text-muted-foreground">Current page</p><div className="mt-2 flex items-start gap-2"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><p className="break-all text-sm leading-6">{target}</p></div></div>}
      </section>
    </div>
    <section aria-labelledby="live-findings-title">
      <div className="audit-section-heading mb-6 flex flex-wrap items-center justify-between gap-4"><h2 id="live-findings-title">Findings so far</h2><button type="button" onClick={onViewFindings} className="audit-text-action inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent">All findings <ArrowRight className="h-4 w-4" /></button></div>
      <div className="audit-live-finding-list divide-y divide-border border-y border-border">{issues.slice(0, 3).map(issue => <button key={issue.id} type="button" className="audit-live-finding grid w-full grid-cols-12 items-center gap-4 py-4 text-left text-sm hover:bg-muted" onClick={onViewFindings}><span className="col-span-7 min-w-0 break-words font-medium md:col-span-6">{issue.title}</span><span className="hidden text-xs text-muted-foreground md:col-span-3 md:block">{issue.category}</span><span className="col-span-4 md:col-span-2"><StatusBadge tone={issue.severity === 'critical' ? 'danger' : issue.severity === 'high' || issue.severity === 'medium' ? 'warning' : 'neutral'}>{issue.severity}</StatusBadge></span><ArrowRight className="h-4 w-4 text-accent" /></button>)}</div>
      {!issues.length && <p className="py-6 text-sm text-muted-foreground">{data.audit?.issuesFound ? 'Finding details are being prepared. Open Findings to view available evidence.' : 'No findings received yet. Checks are still in progress.'}</p>}
      {issues.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Showing {Math.min(3, issues.length)} loaded findings. Audit totals appear above.</p>}
    </section>
    <div className="audit-recent-activity"><AuditActivityFeed events={events} compact /><button type="button" onClick={onViewActivity} className="audit-text-action inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent mt-4">All activity <ArrowRight className="h-4 w-4" /></button></div>
  </div>;
});
