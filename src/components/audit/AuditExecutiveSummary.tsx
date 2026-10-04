import { memo, useMemo } from 'react';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import type { ResourceAuditDocument, ResourceAuditIssue } from '../../lib/audit/resource-types';
import type { AuditScoreState } from '../../lib/audit/audit-live-score';
import { isTerminalAuditStatus } from '../../lib/audit/audit-time';
import { issueSignature, type ChecklistStatus } from '../../lib/audit/client-insights';
import { findingImpact } from '../../lib/audit/report-insights';
import { auditCoverage } from '../../lib/audit/audit-evidence-quality';
import { auditScopeScoreLabel } from '../../lib/audit/audit-scope';
import { auditScopeProgressLabel } from '../../lib/report/scope-presentation';
import { AuditGrade, CategoryScoreBar, ProgressBar, SeverityDistribution, StatusBadge } from '../ui/visual-system';

export interface AuditCategoryScore {
  label: string;
  value: number;
  detail?: string;
  tone?: 'accent' | 'green' | 'yellow' | 'red';
}

export const AuditExecutiveSummary = memo(function AuditExecutiveSummary({
  audit, score, scoreState = 'unavailable', scoreLabel, scoreDetail,
  categoryScores = [], progress, unavailableChecks = null,
}: {
  audit: ResourceAuditDocument;
  score: number | null;
  scoreState?: AuditScoreState;
  scoreLabel?: string;
  scoreDetail?: string;
  categoryScores?: AuditCategoryScore[];
  progress?: number;
  unavailableChecks?: number | null;
}) {
  const coverage = auditCoverage(audit);
  const terminal = isTerminalAuditStatus(audit.status);
  const limitationCount = unavailableChecks ?? audit.warningCount ?? 0;
  return <section className="audit-compact-summary" aria-label="Audit summary">
    <div className="min-w-0 py-4">
      <div className="mb-3"><StatusBadge tone={scoreState === 'final' ? 'success' : scoreState === 'provisional' ? 'accent' : 'neutral'}>{scoreState === 'final' ? 'Final score' : scoreState === 'provisional' ? 'Preliminary' : terminal ? 'Unavailable' : 'Score pending'}</StatusBadge></div>
      <AuditGrade score={score} label={audit.scope ? auditScopeScoreLabel(audit.scope) : scoreLabel || 'Overall score'} detail={scoreDetail} compact />
      {progress != null && !terminal && <div className="mt-4"><ProgressBar label={auditScopeProgressLabel(audit)} value={progress} /></div>}
    </div>
    <div className="min-w-0 py-4">
      <h2 className="mb-3 text-sm font-semibold">Finding priority <span className="ml-1 text-xs font-normal text-muted-foreground">{audit.issuesFound.toLocaleString()} total</span></h2>
      <SeverityDistribution critical={audit.criticalCount} high={audit.highCount} medium={audit.mediumCount} low={audit.lowCount} />
    </div>
    <div className="min-w-0 py-4">
      <h2 className="mb-3 text-sm font-semibold">Coverage</h2>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-3">
        {[[coverage.analysed.toLocaleString(), 'Pages analysed'], [coverage.discovered.toLocaleString(), 'URLs discovered'], [audit.checksCompleted.toLocaleString(), 'Check groups'], [limitationCount.toLocaleString(), unavailableChecks == null ? 'Warnings' : 'Unavailable checks']].map(([value, label]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd></div>)}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">{audit.scope?.coverage === 'page' ? `Single-page coverage. ${(audit.planPageLimit ?? coverage.allowance).toLocaleString()} pages in your plan allowance.` : `${(audit.planPageLimit ?? coverage.allowance).toLocaleString()} page allowance. Discovered URLs are not total site size.`}</p>
      {coverage.discoveredPercent != null && <div className="mt-3"><ProgressBar label="Discovered pages analysed" value={coverage.discoveredPercent} tone="green" /></div>}
    </div>
    {categoryScores.length > 0 && <div className="min-w-0 py-4"><h2 className="mb-3 text-sm font-semibold">Measured score factors</h2><div className="grid gap-2.5">{categoryScores.map(item => <CategoryScoreBar key={item.label} label={item.label} value={item.value} framed={false} />)}</div></div>}
  </section>;
});

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
  const priorityIssues = useMemo(() => [...issues]
    .sort((left, right) => {
      const severity = SEVERITY_WEIGHT[right.severity] - SEVERITY_WEIGHT[left.severity];
      if (severity) return severity;
      const reach = (right.affectedPageCount || 1) - (left.affectedPageCount || 1);
      if (reach) return reach;
      return Number(Boolean(right.evidence)) - Number(Boolean(left.evidence));
    })
    .slice(0, 4), [issues]);

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
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{issue.title}</h3><StatusBadge tone={issue.severity === 'critical' ? 'danger' : issue.severity === 'high' || issue.severity === 'medium' ? 'warning' : 'neutral'}>{issue.severity}</StatusBadge><StatusBadge tone="accent">{findingImpact(issue).label}</StatusBadge></div><p className="mt-1 text-sm text-muted-foreground">{priorityReason(issue)}</p></div>
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
