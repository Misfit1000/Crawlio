import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, CheckCircle2, Clock3, Copy, FileDown, Loader2, RefreshCw, Wrench } from 'lucide-react';
import { NavLink } from '../../app/router';
import { auditWorkspacePath, type AuditWorkspaceSection } from '../../app/routes';
import { API_ROUTES } from '../../lib/api/routes';
import { getAuditAccessHeaders } from '../../lib/api/auth-headers';
import type { ChecklistStatus } from '../../lib/audit/client-insights';
import { isCompletedAuditStatus, isTerminalAuditStatus } from '../../lib/audit/audit-time';
import { customerSafeDiagnosticText } from '../../lib/audit/audit-failures';
import { getAuditLiveScore } from '../../lib/audit/audit-live-score';
import { classifyReportSection, extractReportScores } from '../../lib/audit/report-insights';
import type { AuditComparison, AuditHistoryPage, AuditMode, ResourceAuditPage } from '../../lib/audit/resource-types';
import { AuditExportDownloadNotice, useAuditExportDownload } from './AuditExportDownload';
import { safeJsonFetch } from '../../lib/http/safe-json';
import { EmptyState, MetricCard, StatusBadge, SurfaceCard } from '../ui/visual-system';
import { Notice } from '../ui/page-system';
import { AuditActivityFeed } from './AuditActivityPanel';
import { AuditExecutiveSummary } from './AuditExecutiveSummary';
import { AuditOverview } from './AuditOverview';
import { AuditWorkspaceModes, useAuditWorkspaceMode } from './AuditWorkspaceModes';
import { AuditPagesTable, PageEvidenceDrawer } from './PageEvidenceDrawer';
import { AuditWorkspaceProvider, useAuditWorkspace } from './AuditWorkspaceContext';
import FindingWorkspace from './FindingWorkspace';
import PaginatedAuditEvidence from './PaginatedAuditEvidence';
import { AuditReportReadyNote, AuditTerminalState } from './AuditTerminalState';
import { useFindingWorkflow } from './useFindingWorkflow';
import { auditFocusLabel, auditScopesComparable, scopeIncludesSection, type AuditScope } from '../../lib/audit/audit-scope';
import { findingMatchesReportSection, reportCategoryScores, scopeEvents, scopeFindings, scopeScoreMetadata } from '../../lib/report/scope-presentation';
import { AuditScopeNotIncluded } from './AuditScopeNotIncluded';

const sections: Array<{ id: AuditWorkspaceSection; label: string }> = [
  { id: 'seo', label: 'SEO' }, { id: 'technical', label: 'Technical' },
  { id: 'crawlability', label: 'Crawlability' }, { id: 'links', label: 'Links' },
  { id: 'performance', label: 'Performance' }, { id: 'accessibility', label: 'Accessibility' },
  { id: 'structured-data', label: 'Structured data' },
  { id: 'security', label: 'Passive security' },
];
const reportSectionForRoute: Partial<Record<AuditWorkspaceSection, ReturnType<typeof classifyReportSection>>> = {
  seo: 'on-page', technical: 'technical', crawlability: 'crawlability', links: 'internal-links',
  performance: 'performance', accessibility: 'accessibility', security: 'security',
  'structured-data': 'structured-data',
};
function modeLabel(mode: AuditMode) { return mode === 'deep' ? 'Deep audit' : mode === 'standard' ? 'Standard audit' : 'Quick audit'; }
function auditStatusLabel(status: string) { return status === 'queued' ? 'Waiting to start' : status === 'running' ? 'Checking your site' : status.replace(/_/g, ' '); }

function ComparisonPanel() {
  const { auditId, data } = useAuditWorkspace();
  const [history, setHistory] = useState<AuditHistoryPage | null>(null);
  const [baselineId, setBaselineId] = useState('');
  const [comparison, setComparison] = useState<AuditComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hostname = data.audit?.hostname;

  useEffect(() => {
    let active = true;
    setHistory(null); setComparison(null); setBaselineId('');
    if (!hostname) return;
    getAuditAccessHeaders()
      .then((headers) => safeJsonFetch<any>(`${API_ROUTES.auditHistory}?hostname=${encodeURIComponent(hostname)}&limit=50`, { headers }))
      .then((response) => {
        if (!active || !response.success) return;
        const next = (response.data.data || response.data) as AuditHistoryPage;
        const completedItems = next.items.filter((item) => isCompletedAuditStatus(item.audit.status) && data.audit && auditScopesComparable(data.audit, item.audit));
        setHistory({ ...next, items: completedItems });
        setBaselineId(completedItems.find((item) => item.audit.id !== auditId)?.audit.id || '');
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [auditId, hostname, data.audit?.scope, data.audit?.effectiveMode]);

  const compare = async () => {
    if (!baselineId || !data.audit || !history?.items.some(item => item.audit.id === baselineId && auditScopesComparable(data.audit!, item.audit))) return;
    setLoading(true);
    setComparison(null);
    setError(null);
    try {
      const response = await safeJsonFetch<any>(API_ROUTES.auditCompare(auditId, baselineId), { headers: await getAuditAccessHeaders() });
      if (!response.success) throw new Error((response as any).error || 'Comparison failed.');
      setComparison((response.data.data || response.data) as AuditComparison);
    } catch (comparisonError) {
      setError(comparisonError instanceof Error ? comparisonError.message : 'The audit comparison could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  if (!history?.items.some((item) => item.audit.id !== auditId)) return null;
  return (
    <SurfaceCard id="audit-comparison" className="p-5 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-xl font-semibold">Compare with an earlier audit</h2><p className="mt-1 text-sm text-muted-foreground">Review new, resolved, and persistent findings from stored audit history.</p></div><div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto"><select className="suite-input min-w-64" value={baselineId} onChange={(event) => setBaselineId(event.target.value)} aria-label="Earlier audit"><option value="">Choose an earlier audit</option>{history.items.filter((item) => item.audit.id !== auditId).map((item) => <option key={item.audit.id} value={item.audit.id}>{new Date(item.audit.createdAt).toLocaleString()} · {modeLabel(item.audit.effectiveMode)}</option>)}</select><button type="button" className="trust-button" onClick={compare} disabled={!baselineId || loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />} Compare</button></div></div>
      {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
      {comparison && <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard label="Score change" value={comparison.scoreDelta == null ? '—' : `${comparison.scoreDelta > 0 ? '+' : ''}${comparison.scoreDelta}`} detail="Compared with selected audit" icon={comparison.scoreDelta != null && comparison.scoreDelta >= 0 ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />} tone={comparison.scoreDelta != null && comparison.scoreDelta >= 0 ? 'green' : 'red'} />
          <MetricCard label="Resolved" value={comparison.issueCounts?.resolved ?? comparison.resolvedIssues.length} detail="No longer detected" icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard label="New findings" value={comparison.issueCounts?.new ?? comparison.newIssues.length} detail="Appeared in this audit" icon={<AlertTriangle className="h-5 w-5" />} tone={(comparison.issueCounts?.new ?? comparison.newIssues.length) ? 'yellow' : 'green'} />
          <MetricCard label="Still present" value={comparison.issueCounts?.persistent ?? comparison.persistentIssues.length} detail="Detected in both audits" icon={<Wrench className="h-5 w-5" />} />
        </div>
      </div>}
    </SurfaceCard>
  );
}


function AuditWorkspaceContent({ section, onRerun }: { section: AuditWorkspaceSection; onRerun?: (url: string, mode: AuditMode, scope?: AuditScope | null) => void | Promise<void> }) {
  const { auditId, data, loading, error, connection, reportPending, reportRetrying, refresh, retryFinalReport } = useAuditWorkspace();
  const audit = data.audit;
  const exportDownload = useAuditExportDownload(auditId);
  const modes = useAuditWorkspaceMode(section === 'overview' ? 'overview' : section === 'pages' ? 'pages' : 'findings');
  const workflow = useFindingWorkflow(auditId, data.latestIssues);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState<ResourceAuditPage | null>(null);
  const closePage = useCallback(() => setSelectedPage(null), []);
  const viewFindings = useCallback(() => modes.setMode('findings'), [modes.setMode]);
  const liveScore = useMemo(() => audit ? getAuditLiveScore({ audit, events: data.latestEvents, finalReport: data.finalReport }) : null, [audit, data.latestEvents, data.finalReport]);
  const scoreRecord = useMemo(() => scopeScoreMetadata(audit?.scope, data.finalReport?.scores || (liveScore ? { ...liveScore.categoryScores, overall: liveScore.overallScore, seo: liveScore.categoryScores.onPage } : undefined)), [audit?.scope, data.finalReport, liveScore]);
  const scores = useMemo(() => extractReportScores(scoreRecord), [scoreRecord]);
  const categoryScores = useMemo(() => reportCategoryScores(audit?.scope, scoreRecord), [audit?.scope, scoreRecord]);
  const issues = useMemo(() => {
    const target = reportSectionForRoute[section];
    const selected = scopeFindings(audit?.scope, data.latestIssues);
    return target ? selected.filter(issue => findingMatchesReportSection(audit?.scope, issue, target)) : selected;
  }, [data.latestIssues, section, audit?.scope]);
  const updateChecklist = useCallback((signature: string, status: ChecklistStatus) => { void workflow.update(signature, { status }).catch(() => undefined); }, [workflow.update]);

  const copyReportLink = async () => {
    try {
      const response = await safeJsonFetch<any>(API_ROUTES.auditShare(auditId), { method: 'POST', headers: await getAuditAccessHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresInDays: 7 }) });
      if (!response.success) throw new Error((response as any).error || 'The report link could not be created.');
      await navigator.clipboard.writeText((response.data.data || response.data).shareUrl);
      setActionMessage('Read-only report link copied. It expires in 7 days.');
    } catch (reason) { setActionMessage(reason instanceof Error ? reason.message : 'The report link could not be created.'); }
  };
  const exportReport = async (format: 'pdf' | 'json') => {
    await exportDownload.start(format);
  };
  useEffect(() => {
    if (!actionMessage) return;
    const timer = window.setTimeout(() => setActionMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [actionMessage]);

  if (loading && !audit) return <SurfaceCard className="flex items-center gap-3 p-5"><Loader2 className="h-5 w-5 animate-spin text-accent" />Loading stored audit evidence...</SurfaceCard>;
  if (error && !audit) return <SurfaceCard className="p-5"><Notice tone="danger" title="Audit unavailable">{customerSafeDiagnosticText(error) || 'The stored audit could not be loaded.'}</Notice><div className="mt-4 flex flex-wrap gap-2"><button type="button" className="trust-button" onClick={() => void refresh().catch(() => undefined)}><RefreshCw className="h-4 w-4" />Try again</button><NavLink className="quiet-button" to="/app/audits/history">Audit history</NavLink></div></SurfaceCard>;
  if (!audit) return <EmptyState icon={FileDown} title="Audit not found" description="This audit is unavailable or your account does not have access." />;
  const workflowProps = { scope: audit.scope, statuses: workflow.statuses, onStatusChange: updateChecklist, workflowRecords: workflow.records, workflowStorage: workflow.storage, workflowError: workflow.error, savingKeys: workflow.savingKeys, onWorkflowSave: workflow.update };
  const unavailableChecks = Array.isArray(scoreRecord?.unavailableChecks) ? scoreRecord.unavailableChecks.length : liveScore?.unavailableCount;
  const included = scopeIncludesSection(audit.scope, section);
  const statusTone = isCompletedAuditStatus(audit.status) ? audit.status === 'completed_with_warnings' ? 'warning' : 'success' : audit.status === 'failed' ? 'danger' : 'accent';
  return <div className="audit-customer-workspace w-full space-y-4">
    <header className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone={statusTone}>{auditStatusLabel(audit.status)}</StatusBadge><span className="text-xs text-muted-foreground">{audit.scope ? `${auditFocusLabel(audit.scope)} · ${audit.scope.coverage} coverage · ` : ''}{modeLabel(audit.effectiveMode)}</span></div><h1 className="mt-2 break-words text-2xl font-semibold">{audit.hostname}</h1><p className="mt-1 break-all text-xs text-muted-foreground">{audit.normalizedUrl}</p></div>
      <div className="flex flex-wrap gap-2">
        {onRerun && isTerminalAuditStatus(audit.status) && <button type="button" onClick={() => onRerun(audit.normalizedUrl, audit.effectiveMode, audit.scope)} className="quiet-button min-h-9 px-3 py-1 text-xs"><RefreshCw className="h-4 w-4" />Rerun</button>}
        <button type="button" onClick={copyReportLink} className="quiet-button min-h-9 px-3 py-1 text-xs"><Copy className="h-4 w-4" />Share report</button>
        <button type="button" onClick={() => void exportReport('pdf')} disabled={!data.finalReport || exportDownload.busy} className="quiet-button min-h-9 px-3 py-1 text-xs"><FileDown className="h-4 w-4" />PDF</button>
        <button type="button" onClick={() => void exportReport('json')} disabled={!data.finalReport || exportDownload.busy} className="quiet-button min-h-9 px-3 py-1 text-xs"><FileDown className="h-4 w-4" />JSON</button>
      </div>
    </header>
    <AuditTerminalState audit={audit} reportPending={reportPending} reportRetrying={reportRetrying} onRetryReport={retryFinalReport} />
    <AuditReportReadyNote warning={audit.status === 'completed_with_warnings' && Boolean(data.finalReport)} />
    {error && <Notice tone="danger" title="Some audit data could not refresh">{customerSafeDiagnosticText(error)}</Notice>}
    {actionMessage && <Notice tone={/copied|downloaded/.test(actionMessage) ? 'success' : 'danger'}>{actionMessage}</Notice>}
    <AuditExportDownloadNotice download={exportDownload} />
    <AuditWorkspaceModes mode={modes.mode} pathFor={modes.pathFor} />
    {!included && <AuditScopeNotIncluded />}
    {included && modes.mode === 'overview' && <>
      <AuditExecutiveSummary audit={audit} score={scores.overall} scoreState={liveScore?.scoreState} scoreDetail={liveScore?.scoreState === 'provisional' ? 'Preliminary, from analysed pages so far' : 'Stored deterministic score'} categoryScores={categoryScores} progress={audit.progress} unavailableChecks={unavailableChecks} />
      {data.finalReport?.scores?.scoringVersion && <p className="text-xs text-muted-foreground">Scoring model {String(data.finalReport.scores.scoringVersion)}. Historical scores are preserved.</p>}
      <AuditOverview data={data} onViewFindings={viewFindings} />
      <ComparisonPanel />
    </>}
    {included && modes.mode === 'findings' && <>
      <nav className="no-scrollbar flex flex-wrap gap-1 border-b border-border pb-2" aria-label="Detailed report categories"><NavLink to={`${auditWorkspacePath(auditId)}?view=findings`} className="quiet-button min-h-9 px-3 py-1 text-xs">All findings</NavLink>{sections.filter(item => scopeIncludesSection(audit.scope, item.id)).map(item => <NavLink key={item.id} to={auditWorkspacePath(auditId, item.id)} className={({ isActive }) => `min-h-9 rounded-md px-3 py-2 text-xs font-semibold ${isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{item.label}</NavLink>)}</nav>
      {section === 'security' && <StatusBadge tone="accent">Passive observations only</StatusBadge>}
      {section === 'accessibility' && <StatusBadge tone="warning">Automated signals, not certification</StatusBadge>}
      {audit.processingVersion === 2 ? <PaginatedAuditEvidence auditId={auditId} kind="issues" section={reportSectionForRoute[section]} {...workflowProps} /> : <FindingWorkspace auditId={auditId} issues={issues} {...workflowProps} />}
    </>}
    {included && modes.mode === 'pages' && (audit.processingVersion === 2 ? <PaginatedAuditEvidence scope={audit.scope} auditId={auditId} kind="pages" pageIssues={data.latestIssues} /> : <section><h2 className="mb-3 text-lg font-semibold">Pages analysed</h2><AuditPagesTable scope={audit.scope} pages={data.latestPages} onSelect={setSelectedPage} /><PageEvidenceDrawer scope={audit.scope} page={selectedPage} issues={data.latestIssues} onClose={closePage} /></section>)}
    {included && modes.mode === 'activity' && <><p className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />{connection.message}</p><AuditActivityFeed events={scopeEvents(audit.scope, data.latestEvents)} /></>}
  </div>;
}

export default function AuditWorkspace({ auditId, section, onRerun }: { auditId: string; section: AuditWorkspaceSection; onRerun?: (url: string, mode: AuditMode, scope?: AuditScope | null) => void | Promise<void> }) {
  return <AuditWorkspaceProvider auditId={auditId}><AuditWorkspaceContent section={section} onRerun={onRerun} /></AuditWorkspaceProvider>;
}
