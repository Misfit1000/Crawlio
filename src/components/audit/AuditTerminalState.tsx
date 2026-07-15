import React from 'react';
import { AlertTriangle, CheckCircle2, Clock3, History, LayoutDashboard, Loader2, RefreshCw, StopCircle } from 'lucide-react';
import { Link } from 'react-router';
import { customerSafeDiagnosticText } from '../../lib/audit/audit-failures';
import { hasUsableAuditReport } from '../../lib/audit/audit-time';
import type { ResourceAuditDocument } from '../../lib/audit/resource-types';
import { SurfaceCard } from '../ui/visual-system';

interface Props {
  audit: ResourceAuditDocument;
  reportPending?: boolean;
  reportRetrying?: boolean;
  onRetryReport?: () => void;
  onRerun?: () => void;
}

function knownFailureCategory(failureCounts?: Record<string, number>) {
  const code = Object.entries(failureCounts || {}).sort((left, right) => right[1] - left[1])[0]?.[0] || '';
  if (/^DNS_/.test(code)) return 'Domain lookup';
  if (/^(CONNECTION_|HTTP_429|HTTP_5)/.test(code)) return 'Website availability';
  if (/^(TLS_|HTTPS_)/.test(code)) return 'HTTPS connection';
  if (/^HTTP_/.test(code)) return 'Website response';
  if (/REDIRECT/.test(code)) return 'Redirect setup';
  if (/ROBOTS|NOINDEX/.test(code)) return 'Search engine access';
  if (/CONTENT|RESPONSE|HTML/.test(code)) return 'Page content';
  if (/PRIVATE_NETWORK|UNSUPPORTED_PORT|EMBEDDED_CREDENTIALS/.test(code)) return 'Website address safety';
  if (/DEADLINE/.test(code)) return 'Audit time limit';
  return null;
}

export function AuditTerminalState({ audit, reportPending, reportRetrying, onRetryReport, onRerun }: Props) {
  if (hasUsableAuditReport(audit.status) && !reportPending) return null;

  if (hasUsableAuditReport(audit.status)) {
    return (
      <SurfaceCard className="border-blue-500/25 p-5 md:p-6" role="status" aria-live="polite">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-300">
              {reportRetrying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Clock3 className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="font-semibold">Preparing final report</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                The website checks have finished. Crawlio is loading the saved report and will keep this audit visible while it becomes available.
              </p>
            </div>
          </div>
          {!reportRetrying && onRetryReport && (
            <button type="button" className="quiet-button shrink-0" onClick={onRetryReport}>
              <RefreshCw className="h-4 w-4" /> Retry report load
            </button>
          )}
        </div>
      </SurfaceCard>
    );
  }

  const failed = audit.status === 'failed' || audit.status === 'abandoned';
  const Icon = failed ? AlertTriangle : StopCircle;
  const title = audit.status === 'cancelled'
    ? 'Audit stopped'
    : audit.status === 'abandoned'
      ? 'Audit stopped after recovery attempts'
      : 'Audit could not be completed';
  const safeError = customerSafeDiagnosticText(audit.error);
  const failureCategory = knownFailureCategory(audit.failureCounts);
  const description = audit.status === 'cancelled'
    ? 'This audit was cancelled before the final report was created. You can run it again at any time.'
    : safeError || 'The audit engine stopped before it could create a complete report. Your previous audits remain available.';

  return (
    <SurfaceCard className={`p-5 md:p-6 ${failed ? 'border-red-500/25' : 'border-amber-500/25'}`} role="alert">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${failed ? 'bg-red-500/10 text-red-600 dark:text-red-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold">{title}</h2>
            {failed && failureCategory && <p className="mt-1 text-xs font-semibold text-foreground">Failure category: {failureCategory}</p>}
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {onRerun && <button type="button" className="trust-button" onClick={onRerun}><RefreshCw className="h-4 w-4" /> Run again</button>}
          <Link className="quiet-button" to="/app/audits/history"><History className="h-4 w-4" /> Audit history</Link>
          <Link className="quiet-button" to="/app"><LayoutDashboard className="h-4 w-4" /> Dashboard</Link>
        </div>
      </div>
    </SurfaceCard>
  );
}

export function AuditReportReadyNote({ warning }: { warning: boolean }) {
  if (!warning) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/8 p-4 text-sm text-muted-foreground">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" />
      <p>The report is ready. Some checks could not run, so review the coverage notes before acting on the scores.</p>
    </div>
  );
}
