import { memo, useMemo, type CSSProperties } from 'react';
import './audit-report.css';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import type { ResourceAuditDocument, ResourceAuditIssue } from '../../lib/audit/resource-types';
import type { AuditScoreState } from '../../lib/audit/audit-live-score';
import { isTerminalAuditStatus } from '../../lib/audit/audit-time';
import { issueSignature, type ChecklistStatus } from '../../lib/audit/client-insights';
import { findingImpact } from '../../lib/audit/report-insights';
import { auditCoverage } from '../../lib/audit/audit-evidence-quality';
import { AUDIT_CHECK_GROUPS, AUDIT_GROUP_DETAILS, auditScopeScoreLabel } from '../../lib/audit/audit-scope';
import { categoryColor } from '../ui/category-presentation';
import { auditScopeProgressLabel } from '../../lib/report/scope-presentation';
import { AuditGrade, CategoryScoreBar, ProgressBar, RadialScoreGauge, StatusBadge } from '../ui/visual-system';

export interface AuditCategoryScore {
  label: string;
  value: number;
  detail?: string;
  tone?: 'accent' | 'green' | 'yellow' | 'red';
}

export function AuditScoreFactors({ categoryScores }: { categoryScores: AuditCategoryScore[] }) {
  if (!categoryScores.length) return null;
  return <section className="audit-factor-section py-6" aria-label="Measured score factors"><div className="audit-section-heading mb-6 flex flex-wrap items-center justify-between gap-4"><h2>Score factors</h2><span className="text-xs text-muted-foreground">Measured categories only</span></div><div className="audit-score-factors grid gap-8 sm:grid-cols-2 xl:grid-cols-4">{categoryScores.map(item => {
    const group = AUDIT_CHECK_GROUPS.find(group => AUDIT_GROUP_DETAILS[group].label === item.label);
    return <div key={item.label} style={{ '--factor-color': categoryColor(group || (item.label === 'On-page SEO' ? 'seo' : item.label === 'Technical delivery' ? 'technical' : 'security')) } as CSSProperties}><CategoryScoreBar label={item.label} value={item.value} framed={false} /></div>;
  })}</div></section>;
}

export const AuditExecutiveSummary = memo(function AuditExecutiveSummary({
  audit, score, scoreState = 'unavailable', scoreLabel, scoreDetail,
  categoryScores = [], progress, unavailableChecks = null, onViewFindings, showFactors = true,
}: {
  audit: ResourceAuditDocument;
  score: number | null;
  scoreState?: AuditScoreState;
  scoreLabel?: string;
  scoreDetail?: string;
  categoryScores?: AuditCategoryScore[];
  progress?: number;
  unavailableChecks?: number | null;
  onViewFindings?: () => void;
  showFactors?: boolean;
}) {
  const coverage = auditCoverage(audit);
  const terminal = isTerminalAuditStatus(audit.status);
  const limitationCount = unavailableChecks ?? audit.warningCount ?? 0;
  const priorities = [
    { label: 'Critical', value: audit.criticalCount, color: 'var(--danger)' },
    { label: 'High', value: audit.highCount, color: 'var(--warning)' },
    { label: 'Medium', value: audit.mediumCount, color: 'var(--category-cyan,var(--accent))' },
    { label: 'Low', value: audit.lowCount, color: 'var(--action,var(--accent))' },
  ];
  return <section className="audit-executive" aria-label="Audit summary">
    <div className="audit-executive-grid grid items-center gap-8 py-8 sm:grid-cols-2 xl:grid-cols-4">
    <div className="audit-executive-score flex flex-col items-center text-center">
      {score != null && Number.isFinite(score)
        ? <RadialScoreGauge value={score} label={audit.scope ? auditScopeScoreLabel(audit.scope) : scoreLabel || 'Audit score'} size="lg" />
        : <AuditGrade score={null} label={audit.scope ? auditScopeScoreLabel(audit.scope) : scoreLabel || 'Overall score'} detail={scoreDetail} compact />}
      <div className="mt-3"><StatusBadge tone={scoreState === 'final' ? 'success' : scoreState === 'provisional' ? 'accent' : 'neutral'}>{scoreState === 'final' ? 'Final score' : scoreState === 'provisional' ? 'Preliminary' : terminal ? 'Unavailable' : 'Score pending'}</StatusBadge></div>
    </div>
    <div className="audit-executive-coverage min-w-0">
      <h2 className="text-base font-semibold">Measured results</h2>
      <p className="mt-2 text-sm text-muted-foreground">{audit.scope?.coverage === 'page' ? 'Single-page coverage' : 'Website coverage'}</p>
      <p className="audit-large-number mt-5 text-4xl font-bold tabular-nums">{coverage.analysed.toLocaleString()}</p>
      <p className="text-sm text-muted-foreground">pages analysed</p>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">{coverage.discovered.toLocaleString()} URLs discovered / {coverage.allowance.toLocaleString()} page audit limit</p>
      {coverage.discoveredPercent != null && <div className="mt-4"><ProgressBar label="Discovered pages analysed" value={coverage.discoveredPercent} tone="green" /></div>}
    </div>
    <div className="audit-executive-priorities min-w-0">
      <h2 className="text-base font-semibold">Finding priority</h2>
      <dl className="audit-priority-counts mt-7 grid grid-cols-2 gap-4">{priorities.map(item => <div key={item.label}><dt className="text-xs text-muted-foreground"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />{item.label}</dt><dd className="mt-3 text-2xl font-semibold tabular-nums">{item.value.toLocaleString()}</dd></div>)}</dl>
      <p className="mt-5 text-xs text-muted-foreground">{limitationCount.toLocaleString()} {unavailableChecks == null ? 'warnings' : 'unavailable checks'}{audit.scope ? ` / ${categoryScores.length} groups measured` : ` / ${audit.checksCompleted.toLocaleString()} checks completed`}</p>
    </div>
    <div className="audit-executive-total min-w-0">
      <p className="audit-large-number mt-5 text-4xl font-bold tabular-nums">{audit.issuesFound.toLocaleString()}</p><p className="mt-1 text-sm text-muted-foreground">total findings</p>
      {onViewFindings && <button type="button" onClick={onViewFindings} className="trust-button mt-5">View fixes</button>}
    </div>
    </div>
    <div className="audit-summary-footnote flex flex-wrap justify-between gap-x-6 gap-y-2 border-t border-border pt-4 text-xs leading-6 text-muted-foreground"><span>{scoreDetail || 'Based on collected audit evidence.'}</span><span>{(audit.planPageLimit ?? coverage.allowance).toLocaleString()} pages in plan allowance. Discovered URLs are not total site size.</span></div>
    {progress != null && !terminal && <div className="mt-4"><ProgressBar label={auditScopeProgressLabel(audit)} value={progress} /></div>}
    {showFactors && <AuditScoreFactors categoryScores={categoryScores} />}
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
