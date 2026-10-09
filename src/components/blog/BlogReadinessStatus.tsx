import type { ReactNode } from 'react';
import type { BlogAutomationDashboard } from '../../lib/blog/client';
import { StatusBadge } from '../ui/visual-system';
import { blogReadiness } from './blog-readiness';

export default function BlogReadinessStatus({ dashboard, loading, error, actions }: { dashboard: BlogAutomationDashboard | null; loading: boolean; error?: string; actions?: ReactNode }) {
  const status = blogReadiness(dashboard);
  return <section aria-label="AI generation readiness" aria-busy={loading} className="border-b border-border pb-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">AI generation readiness</h2><StatusBadge tone={loading || !dashboard ? 'neutral' : status.generationReady ? status.warnings.length || !status.oneClickReady ? 'warning' : 'success' : 'warning'}>{loading ? 'Checking status' : status.label}</StatusBadge></div>{actions}</div>
    {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">Status could not be verified: {error} Retry the status check. Manual writing remains available.</p>}
    {!dashboard && !error && <p className="mt-3 text-sm text-muted-foreground">{loading ? 'Loading this deployment\'s generation status.' : 'Refresh status to verify generation before starting an AI job.'}</p>}
    {dashboard && <>
      <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Provider and dispatch details</summary><dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Server key</dt><dd className="mt-1 font-medium">{dashboard.provider.configured ? 'Present (not a connectivity test)' : 'Not configured'}</dd></div>
        <div><dt className="text-muted-foreground">Groq jobs</dt><dd className="mt-1 font-medium">{dashboard.provider.enabled ? 'Enabled' : 'Disabled'}</dd></div>
        <div><dt className="text-muted-foreground">Last provider check</dt><dd className="mt-1 break-words font-medium">{dashboard.provider.health || 'Not tested'}{dashboard.provider.lastErrorCode && ` (${dashboard.provider.lastErrorCode})`}</dd></div>
        {status.runtime && <>
          <div><dt className="text-muted-foreground">Dispatcher</dt><dd className="mt-1 font-medium">{status.runtime.dispatchConfigured ? 'Configured' : 'Not configured'}</dd></div>
          <div><dt className="text-muted-foreground">Scheduled automation</dt><dd className="mt-1 font-medium">{status.runtime.automationEnabled ? 'Enabled' : 'Disabled'}</dd></div>
          <div><dt className="text-muted-foreground">Cron schedule</dt><dd className="mt-1 break-words font-medium">{status.runtime.cronSchedule || 'No schedule reported'}</dd></div>
        </>}
      </dl></details>
      {[...status.blockers, ...status.warnings].length > 0 && <ul className="mt-3 space-y-2 text-xs leading-5">{[...status.blockers, ...status.warnings].map((item, index) => <li key={`${item.code}-${index}`}><span className="font-semibold">{item.message}</span> <span className="text-muted-foreground">{item.action}</span></li>)}</ul>}
      {!status.generationReady && !status.blockers.length && <p className="mt-3 text-xs text-muted-foreground">Generation is blocked by the reported readiness checks. Review Advanced AI controls and Sources and system.</p>}
      {status.generationReady && !status.oneClickReady && <p className="mt-3 text-xs text-muted-foreground">One-click publishing is unavailable. AI drafts can still be reviewed in Advanced AI controls; publication policy stays unchanged.</p>}
    </>}
  </section>;
}
