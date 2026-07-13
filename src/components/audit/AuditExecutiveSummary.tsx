import { AlertTriangle, CheckCircle2, FileSearch, Layers, ShieldAlert } from 'lucide-react';
import type { ResourceAuditDocument, ResourceAuditIssue } from '../../lib/audit/resource-types';
import { issueSignature, type ChecklistStatus } from '../../lib/audit/client-insights';
import { CategoryScoreBar, ProgressBar, RadialScoreGauge, SeverityDistribution, StatusBadge, SurfaceCard } from '../ui/visual-system';

export interface AuditCategoryScore {
  label: string;
  value: number;
  detail?: string;
  tone?: 'accent' | 'green' | 'yellow' | 'red';
}

export function AuditExecutiveSummary({
  audit,
  score,
  scoreLabel = 'Overall score',
  scoreDetail,
  categoryScores = [],
  progress,
  unavailableChecks = null,
}: {
  audit: ResourceAuditDocument;
  score: number | null;
  scoreLabel?: string;
  scoreDetail?: string;
  categoryScores?: AuditCategoryScore[];
  progress?: number;
  unavailableChecks?: number | null;
}) {
  const discovered = Math.max(audit.pagesDiscovered, audit.pagesCrawled);
  const coverage = discovered ? Math.round((audit.pagesCrawled / discovered) * 100) : 0;
  const checkProgress = audit.checksTotal ? Math.round((audit.checksCompleted / audit.checksTotal) * 100) : 0;
  const warningCount = audit.warningCount || 0;
  const limitationCount = unavailableChecks ?? warningCount;
  const limitationLabel = unavailableChecks == null ? 'Audit warnings' : 'Unavailable checks';

  return (
    <SurfaceCard className="overflow-hidden" aria-label="Audit summary">
      {progress != null && (
        <div className="border-b border-border bg-[var(--surface-inset)] px-4 py-3 sm:px-5">
          <ProgressBar label={audit.currentPhase || 'Audit progress'} value={progress} tone={audit.status === 'failed' ? 'red' : 'accent'} />
        </div>
      )}
      <div className="grid lg:grid-cols-[230px_minmax(0,1fr)_minmax(280px,0.86fr)]">
        <div className="flex items-center justify-center border-b border-border p-5 lg:border-b-0 lg:border-r lg:p-6">
          {score == null ? (
            <div className="flex h-36 w-36 flex-col items-center justify-center rounded-full border border-dashed border-border bg-muted/30 text-center"><FileSearch className="h-6 w-6 text-muted-foreground" /><div className="mt-2 font-semibold">Score pending</div><div className="mt-1 px-4 text-xs text-muted-foreground">Calculated after evidence is available</div></div>
          ) : <RadialScoreGauge value={score} label={scoreLabel} detail={scoreDetail} size="md" />}
        </div>

        <div className="border-b border-border p-5 lg:border-b-0 lg:border-r lg:p-6">
          <div className="flex items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">Fix priority</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Measured findings grouped by urgency.</p></div><StatusBadge tone={audit.criticalCount ? 'danger' : audit.highCount ? 'warning' : 'success'}>{audit.issuesFound} findings</StatusBadge></div>
          <div className="mt-5"><SeverityDistribution critical={audit.criticalCount} high={audit.highCount} medium={audit.mediumCount} low={audit.lowCount} /></div>
        </div>

        <div className="p-5 lg:p-6">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Coverage</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Only collected evidence is counted.</p></div><Layers className="h-5 w-5 text-accent" /></div>
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
            <div><dt className="text-xs text-muted-foreground">Pages analysed</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{audit.pagesCrawled}<span className="ml-1 text-xs font-normal text-muted-foreground">/ {discovered || audit.pageLimit}</span></dd></div>
            <div><dt className="text-xs text-muted-foreground">Coverage</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{coverage}%</dd></div>
            <div><dt className="text-xs text-muted-foreground">Checks completed</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{audit.checksCompleted}<span className="ml-1 text-xs font-normal text-muted-foreground">/ {audit.checksTotal || '—'}</span></dd></div>
            <div><dt className="text-xs text-muted-foreground">{limitationLabel}</dt><dd className={`mt-1 text-xl font-semibold tabular-nums ${limitationCount ? 'text-amber-600 dark:text-amber-300' : ''}`}>{limitationCount}</dd></div>
          </dl>
          <div className="mt-5 space-y-3">
            <ProgressBar label="Pages reached" value={coverage} tone={coverage >= 80 ? 'green' : 'yellow'} />
            <ProgressBar label="Checks processed" value={checkProgress} tone="accent" />
          </div>
        </div>
      </div>

      {categoryScores.length > 0 && (
        <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
          {categoryScores.map((item) => (
            <div key={item.label} className="bg-card p-3"><CategoryScoreBar {...item} /></div>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}

const SEVERITY_WEIGHT = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

function priorityReason(issue: ResourceAuditIssue) {
  const reach = issue.affectedPageCount || 1;
  if (issue.severity === 'critical') return 'Critical evidence requires review before lower-priority work.';
  if (reach > 1) return `Detected across ${reach} affected pages.`;
  if (issue.evidence) return 'Direct evidence is available for this page.';
  return 'Prioritised by the audit severity model.';
}

export function PriorityRecommendations({
  issues,
  statuses = {},
  onViewFindings,
}: {
  issues: ResourceAuditIssue[];
  statuses?: Record<string, ChecklistStatus>;
  onViewFindings?: () => void;
}) {
  const priorityIssues = [...issues]
    .sort((left, right) => {
      const severity = SEVERITY_WEIGHT[right.severity] - SEVERITY_WEIGHT[left.severity];
      if (severity) return severity;
      const reach = (right.affectedPageCount || 1) - (left.affectedPageCount || 1);
      if (reach) return reach;
      return Number(Boolean(right.evidence)) - Number(Boolean(left.evidence));
    })
    .slice(0, 4);

  return (
    <section aria-labelledby="priority-recommendations-title" className="border-y border-border py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 id="priority-recommendations-title" className="text-xl font-semibold">What to fix first</h2><p className="mt-1 text-sm text-muted-foreground">Ordered by severity, affected-page reach, and available evidence.</p></div>
        {priorityIssues.length > 0 && onViewFindings && <button type="button" onClick={onViewFindings} className="quiet-button min-h-10 px-3 py-2 text-sm">View all findings</button>}
      </div>
      {priorityIssues.length ? (
        <div className="mt-4 divide-y divide-border border-y border-border">
          {priorityIssues.map((issue, index) => {
            const workflow = (statuses[issueSignature(issue)] || 'not_started').replace(/_/g, ' ');
            return (
              <article key={issue.id} className="grid gap-3 py-4 md:grid-cols-[36px_minmax(0,1fr)_150px_130px] md:items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-sm font-semibold tabular-nums">{index + 1}</div>
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{issue.title}</h3><StatusBadge tone={issue.severity === 'critical' ? 'danger' : issue.severity === 'high' || issue.severity === 'medium' ? 'warning' : 'neutral'}>{issue.severity}</StatusBadge></div><p className="mt-1 text-sm text-muted-foreground">{priorityReason(issue)}</p></div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldAlert className="h-4 w-4" />{issue.affectedPageCount || 1} affected</div>
                <div className="flex items-center gap-2 text-sm capitalize text-muted-foreground"><CheckCircle2 className="h-4 w-4" />{workflow}</div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/8 p-4 text-sm"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-300" /><div><div className="font-semibold">No stored findings need prioritising</div><p className="mt-1 text-muted-foreground">Review coverage and unavailable checks before treating this as a complete clean bill of health.</p></div></div>
      )}
    </section>
  );
}
