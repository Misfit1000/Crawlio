import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, CheckSquare, ChevronRight, FileText, Search, X } from 'lucide-react';
import type { AuditComparison, ResourceAuditIssue } from '../../lib/audit/resource-types';
import { buildIssueInsight, issueBucket, issueSignature, type ChecklistStatus } from '../../lib/audit/client-insights';
import { FINDING_WORKFLOW_STATUSES, findingWorkflowResolutionDetail, findingWorkflowStatusLabel, type FindingWorkflowRecord, type FindingWorkflowStatus } from '../../lib/audit/finding-workflow';
import { findingComparisonInsights, findingEffort, findingImpact, groupFindingFixBatches, REPORT_SECTIONS } from '../../lib/audit/report-insights';
import { StatusBadge } from '../ui/visual-system';
import { useUrlFilter } from '../../app/use-url-filter';
import type { AuditScope } from '../../lib/audit/audit-scope';
import { isOperationalFinding, scopeFindings, scopeIncludesReportSection } from '../../lib/report/scope-presentation';
import { AuditScopeNotIncluded } from './AuditScopeNotIncluded';
import './audit-report.css';

const PAGE_SIZE = 20;
const STATUSES: ChecklistStatus[] = [...FINDING_WORKFLOW_STATUSES];
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export interface EvidenceFilters {
  query: string;
  severity: string;
  category: string;
  section: string;
  onChange: (key: 'query' | 'severity' | 'category' | 'section', value: string) => void;
}

function statusLabel(value: ChecklistStatus) {
  return findingWorkflowStatusLabel(value);
}

function severityTone(severity: ResourceAuditIssue['severity']) {
  if (severity === 'critical') return 'danger' as const;
  if (severity === 'high' || severity === 'medium') return 'warning' as const;
  return 'neutral' as const;
}

export default memo(function FindingWorkspace({
  auditId = '',
  issues: allIssues,
  scope,
  statuses = {},
  onStatusChange,
  workflowRecords = {},
  workflowStorage = 'device',
  workflowError = null,
  savingKeys = new Set<string>(),
  onWorkflowSave,
  evidenceFilters,
  comparison,
}: {
  auditId?: string;
  issues: ResourceAuditIssue[];
  scope?: AuditScope | null;
  statuses?: Record<string, ChecklistStatus>;
  onStatusChange?: (signature: string, status: ChecklistStatus) => void;
  workflowRecords?: Record<string, FindingWorkflowRecord>;
  workflowStorage?: 'loading' | 'supabase' | 'device';
  workflowError?: string | null;
  savingKeys?: Set<string>;
  onWorkflowSave?: (signature: string, patch: { status?: FindingWorkflowStatus; notes?: string; dueAt?: string | null; assignedToSelf?: boolean }) => Promise<FindingWorkflowRecord>;
  evidenceFilters?: EvidenceFilters;
  comparison?: AuditComparison | null;
}) {
  const [query, setQuery] = useUrlFilter('finding');
  const [severity, setSeverity] = useUrlFilter('priority', 'all');
  const [category, setCategory] = useUrlFilter('category', 'all');
  const [status, setStatus] = useUrlFilter('workflow', 'all');
  const [errorCode, setErrorCode] = useUrlFilter('error', 'all');
  const [sort, setSort] = useUrlFilter('sort', 'priority');
  const [grouping, setGrouping] = useUrlFilter('group', 'batches');
  const [page, setPage] = useState(1);
  const [batchPage, setBatchPage] = useState(1);
  const [sourcePage, setSourcePage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [noteDraft, setNoteDraft] = useState('');
  const [dueDraft, setDueDraft] = useState('');
  const [noteMessage, setNoteMessage] = useState<string | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const issues = useMemo(() => scopeFindings(scope, allIssues), [scope, allIssues]);
  const comparisonInsight = useMemo(() => findingComparisonInsights(comparison, auditId), [comparison, auditId]);

  const categories = useMemo(() => Array.from(new Set(issues.map((issue) => issue.category).filter(Boolean))).sort(), [issues]);
  const failureCodes = useMemo(() => Array.from(new Set(issues.map((issue) => issue.failureCode).filter((value): value is string => Boolean(value)))).sort(), [issues]);
  const filtered = useMemo(() => {
    if (evidenceFilters) return issues;
    const normalizedQuery = query.trim().toLowerCase();
    return issues.filter((issue) => {
      const workflowStatus = statuses[issueSignature(issue)] || 'not_started';
      return (!normalizedQuery || `${issue.title} ${issue.affectedUrl} ${issue.description}`.toLowerCase().includes(normalizedQuery))
        && (severity === 'all' || issue.severity === severity)
        && (category === 'all' || issue.category === category)
        && (status === 'all' || workflowStatus === status)
        && (errorCode === 'all' || issue.failureCode === errorCode);
    }).sort((left, right) => {
      if (sort === 'title') return left.title.localeCompare(right.title);
      if (sort === 'url') return left.affectedUrl.localeCompare(right.affectedUrl);
      const priority = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
      return priority || (right.affectedPageCount || 1) - (left.affectedPageCount || 1);
    });
  }, [category, errorCode, issues, query, severity, sort, status, statuses, evidenceFilters]);

  const batches = useMemo(() => groupFindingFixBatches(filtered), [filtered]);
  const rows = useMemo(() => {
    if (grouping === 'individual') return filtered.map(issue => ({
      id: issue.id, representative: issue, issues: [issue], severity: issue.severity,
      affectedCount: issue.affectedUrl ? 1 : 0, affectedUrls: issue.affectedUrl ? [issue.affectedUrl] : [],
    }));
    if (sort === 'title') return [...batches].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'url') return [...batches].sort((a, b) => a.representative.affectedUrl.localeCompare(b.representative.affectedUrl));
    return batches;
  }, [batches, filtered, grouping, sort]);
  useEffect(() => setPage(1), [query, severity, category, status, errorCode, sort, grouping]);
  useEffect(() => {
    const available = new Set(issues.map(issue => issue.id));
    setCheckedIds(current => new Set([...current].filter(id => available.has(id))));
    setSelectedId(current => current && available.has(current) ? current : null);
  }, [auditId, issues]);
  useEffect(() => {
    if (!selectedId) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeInspector();
      }
      if (event.key === 'Tab' && inspectorRef.current) {
        const controls = [...inspectorRef.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')].filter(element => !element.hasAttribute('disabled') && element.getClientRects().length);
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', onKeyDown); };
  }, [selectedId]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = useMemo(() => evidenceFilters ? rows : rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), [evidenceFilters, rows, currentPage]);
  const selectedIndex = useMemo(() => filtered.findIndex(issue => issue.id === selectedId), [filtered, selectedId]);
  const selected = selectedIndex >= 0 ? filtered[selectedIndex] : issues.find((issue) => issue.id === selectedId) || null;
  const selectedInsight = useMemo(() => selected ? buildIssueInsight(selected) : null, [selected]);
  const highPriority = useMemo(() => issues.filter(issue => issue.severity === 'critical' || issue.severity === 'high').length, [issues]);
  const selectedKey = selected ? issueSignature(selected) : '';
  const selectedWorkflow = selectedKey ? workflowRecords[selectedKey] : undefined;
  const selectedStatus = statuses[selectedKey] || 'not_started';
  const selectedBatch = useMemo(() => batches.find(batch => batch.issues.some(issue => issue.id === selectedId)), [batches, selectedId]);
  const batchPageCount = Math.max(1, Math.ceil((selectedBatch?.issues.length || 0) / PAGE_SIZE));
  const currentBatchPage = Math.min(batchPage, batchPageCount);
  useEffect(() => setBatchPage(1), [selectedBatch?.id]);
  const selectedUrls = useMemo(() => selected ? Array.from(new Set([selected.affectedUrl, ...(selected.sourceUrls || [])].filter(Boolean))) : [], [selected]);
  const sourcePageCount = Math.max(1, Math.ceil(selectedUrls.length / PAGE_SIZE));
  const currentSourcePage = Math.min(sourcePage, sourcePageCount);
  useEffect(() => setSourcePage(1), [selectedId]);

  const openInspector = (issue: ResourceAuditIssue, trigger?: HTMLElement | null) => {
    if (!selectedId) restoreFocusRef.current = trigger || document.activeElement as HTMLElement | null;
    setSelectedId(issue.id);
    const record = workflowRecords[issueSignature(issue)];
    setNoteDraft(record?.notes || '');
    setDueDraft(record?.dueAt ? record.dueAt.slice(0, 10) : '');
    setNoteMessage(null);
  };
  const closeInspector = () => {
    setSelectedId(null);
    window.requestAnimationFrame(() => restoreFocusRef.current?.focus());
  };
  const moveInspector = (direction: -1 | 1) => {
    if (selectedIndex < 0 || !filtered.length) return;
    const next = filtered[(selectedIndex + direction + filtered.length) % filtered.length];
    setSelectedId(next.id);
    const record = workflowRecords[issueSignature(next)];
    setNoteDraft(record?.notes || '');
    setDueDraft(record?.dueAt ? record.dueAt.slice(0, 10) : '');
    setNoteMessage(null);
  };
  const saveNote = async () => {
    if (!selected || !auditId || !onWorkflowSave) return;
    const signature = issueSignature(selected);
    setNoteMessage(null);
    try {
      await onWorkflowSave(signature, { notes: noteDraft.trim(), dueAt: workflowStorage === 'supabase' && dueDraft ? new Date(`${dueDraft}T12:00:00Z`).toISOString() : null });
      setNoteMessage(workflowStorage === 'supabase' ? 'Workflow details saved to your account.' : 'Workflow details saved on this device.');
      window.setTimeout(() => setNoteMessage(null), 2500);
    } catch {
      setNoteMessage('Workflow details were not saved. Reload and try again.');
    }
  };
  const toggleChecked = (ids: string[]) => setCheckedIds((current) => {
    const next = new Set(current);
    const allChecked = ids.every(id => next.has(id));
    ids.forEach(id => { if (allChecked) next.delete(id); else next.add(id); });
    return next;
  });
  const bulkUpdate = (nextStatus: ChecklistStatus) => {
    if (!onStatusChange) return;
    new Set(issues.filter((issue) => checkedIds.has(issue.id)).map(issueSignature)).forEach(signature => onStatusChange(signature, nextStatus));
    setCheckedIds(new Set());
  };

  if (evidenceFilters && evidenceFilters.section !== 'all' && !scopeIncludesReportSection(scope, evidenceFilters.section)) return <AuditScopeNotIncluded />;
  return (
    <section className="audit-customer-workspace" aria-labelledby="finding-workspace-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 id="finding-workspace-title" className="text-lg font-semibold">Findings</h2></div><div className="flex flex-wrap gap-2"><StatusBadge tone="warning">{highPriority} high priority{evidenceFilters ? ' loaded' : ''}</StatusBadge><StatusBadge tone="neutral">{issues.length} {evidenceFilters ? 'loaded' : 'total'}</StatusBadge></div></div>
      <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${workflowError ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200' : 'border-border bg-[var(--surface-inset)] text-muted-foreground'}`} role={workflowError ? 'alert' : 'status'}>{workflowError || (workflowStorage === 'supabase' ? 'Finding status and notes sync to your account.' : workflowStorage === 'loading' ? 'Loading saved finding workflow...' : 'Guest workflow is stored only on this device. Sign in before starting an audit to sync future work.')}</div>
      {comparisonInsight && <section className="mt-4 border-y border-border py-3" aria-label="Repeat audit findings"><h3 className="text-sm font-semibold">Compared with the selected audit</h3><div className="mt-2 flex flex-wrap gap-2"><StatusBadge tone="warning">{comparisonInsight.counts.new == null ? 'New count unavailable' : `${comparisonInsight.counts.new} new`}</StatusBadge><StatusBadge tone="neutral">{comparisonInsight.counts.remaining == null ? 'Remaining count unavailable' : `${comparisonInsight.counts.remaining} remaining`}</StatusBadge><StatusBadge tone="success">{comparisonInsight.counts.resolved == null ? 'Resolved count unavailable' : `${comparisonInsight.counts.resolved} no longer detected`}</StatusBadge></div><p className="mt-2 text-xs leading-5 text-muted-foreground">Whole-comparison totals, not the current filters. No longer detected does not prove every affected page was retested or a fix was verified.{comparisonInsight.aggregateOnly && ' Only aggregate counts are available; individual findings cannot be labeled from this response.'}</p></section>}
      <p className="sr-only" aria-live="polite">{filtered.length} findings match the current filters.</p>

      {evidenceFilters ? <div className="mt-4 grid gap-2 border-y border-border py-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_140px_180px_180px]" role="search" aria-label="Search all audit findings">
        <label className="relative"><span className="sr-only">Search all audit findings</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><input type="search" maxLength={160} value={evidenceFilters.query} onChange={event => evidenceFilters.onChange('query', event.target.value)} placeholder="Search findings or URL" className="suite-input pl-9" /></label>
        <select value={evidenceFilters.severity} onChange={event => evidenceFilters.onChange('severity', event.target.value)} className="suite-input" aria-label="Filter all findings by severity"><option value="all">All severities</option>{Object.keys(SEVERITY_ORDER).map(value => <option key={value}>{value}</option>)}</select>
        <select value={evidenceFilters.section} onChange={event => evidenceFilters.onChange('section', event.target.value)} className="suite-input" aria-label="Filter all findings by report section"><option value="all">All report sections</option>{REPORT_SECTIONS.filter(section => scopeIncludesReportSection(scope, section.id)).map(section => <option key={section.id} value={section.id}>{section.label}</option>)}</select>
        <label><span className="sr-only">Filter all findings by exact category</span><input maxLength={100} value={evidenceFilters.category === 'all' ? '' : evidenceFilters.category} onChange={event => evidenceFilters.onChange('category', event.target.value || 'all')} className="suite-input" placeholder="Exact category" /></label>
      </div> : <div className="mt-4 grid gap-3 border-y border-border py-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className="relative"><span className="sr-only">Search finding URLs and titles</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search URL or finding" className="suite-input pl-9" /></label>
        <select value={severity} onChange={(event) => setSeverity(event.target.value)} className="suite-input" aria-label="Filter by priority"><option value="all">All priorities</option>{Object.keys(SEVERITY_ORDER).map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select value={category} onChange={(event) => setCategory(event.target.value)} className="suite-input" aria-label="Filter by category"><option value="all">All categories</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="suite-input" aria-label="Filter by workflow status"><option value="all">All statuses</option>{STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select>
        <select value={errorCode} onChange={(event) => setErrorCode(event.target.value)} className="suite-input" aria-label="Filter by error type"><option value="all">All error types</option>{failureCodes.map((value) => <option key={value} value={value}>{issues.find((issue) => issue.failureCode === value)?.title || value}</option>)}</select>
        <select value={sort} onChange={(event) => setSort(event.target.value)} className="suite-input" aria-label="Sort findings"><option value="priority">Priority first</option><option value="title">Title</option><option value="url">URL</option></select>
      </div>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="inline-flex flex-wrap gap-1" role="group" aria-label="Finding view"><button type="button" aria-pressed={grouping !== 'individual'} onClick={() => setGrouping('batches')} className={`quiet-button min-h-9 px-3 py-1.5 text-xs ${grouping !== 'individual' ? 'bg-muted text-foreground' : ''}`}>Fix batches ({batches.length})</button><button type="button" aria-pressed={grouping === 'individual'} onClick={() => setGrouping('individual')} className={`quiet-button min-h-9 px-3 py-1.5 text-xs ${grouping === 'individual' ? 'bg-muted text-foreground' : ''}`}>Individual findings ({filtered.length})</button></div><span className="text-xs text-muted-foreground">{evidenceFilters ? 'Batches cover this loaded evidence page only.' : 'Batches cover findings matching these filters.'}</span></div>

      {checkedIds.size > 0 && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-sm"><CheckSquare className="h-4 w-4 text-accent" /><strong>{checkedIds.size} selected</strong>{onStatusChange && <select defaultValue="" onChange={(event) => event.target.value && bulkUpdate(event.target.value as ChecklistStatus)} className="ml-auto rounded-md border border-border bg-card px-2 py-1.5"><option value="">Bulk status...</option>{STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select>}<button type="button" onClick={() => setCheckedIds(new Set())} className="quiet-button min-h-8 px-2 py-1 text-xs">Clear</button></div>}

      <div className="mt-4 min-w-0">
        <div className="min-w-0 overflow-hidden border-y border-border">
          {visible.length ? visible.map((batch) => {
            const issue = batch.representative;
            const signature = issueSignature(issue);
            const workflowStatus = statuses[signature] || 'not_started';
            const workflowCounts = new Map<ChecklistStatus, number>();
            const workflowKeys = new Set(batch.issues.map(issueSignature));
            workflowKeys.forEach(key => {
              const value = statuses[key] || 'not_started';
              workflowCounts.set(value, (workflowCounts.get(value) || 0) + 1);
            });
            const batchIds = batch.issues.map(member => member.id);
            const checkedCount = batchIds.filter(id => checkedIds.has(id)).length;
            const changes = new Map<string, number>();
            workflowKeys.forEach(key => {
              const change = comparisonInsight?.changes.get(key);
              if (change && change !== 'resolved') changes.set(change, (changes.get(change) || 0) + 1);
            });
            return (
              <article key={batch.id} className={`audit-finding-work-row grid min-w-0 grid-cols-[24px_minmax(0,1fr)] gap-4 border-b border-border py-6 last:border-0 ${batchIds.includes(selectedId || '') ? 'bg-muted' : ''}`}>
                <input type="checkbox" checked={checkedCount === batchIds.length} ref={element => { if (element) element.indeterminate = checkedCount > 0 && checkedCount < batchIds.length; }} onChange={() => toggleChecked(batchIds)} aria-label={`Select ${batch.issues.length > 1 ? `${batch.issues.length} loaded findings in fix batch: ` : ''}${issue.title}`} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
                <div className="min-w-0">
                  <div className="audit-finding-title-row flex items-start justify-between gap-4"><button type="button" onClick={(event) => openInspector(issue, event.currentTarget)} className="min-w-0 text-left"><span className="block break-words text-base font-semibold">{issue.title}</span></button><StatusBadge tone={severityTone(batch.severity)}>{batch.severity}</StatusBadge></div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground"><span>{scope && isOperationalFinding(issue) ? 'Retrieval failure' : issue.category}</span><span className="tabular-nums">{batch.affectedCount ? `${batch.affectedCount} affected URL${batch.affectedCount === 1 ? '' : 's'}${evidenceFilters ? ' loaded' : ''}` : 'Affected URL not stored'}</span>{batch.issues.length > 1 && <span>{batch.issues.length} findings in this batch</span>}<span className="capitalize">{workflowCounts.size > 1 ? [...workflowCounts].map(([value, count]) => `${count} ${statusLabel(value)}`).join(' / ') : statusLabel(workflowStatus)}</span>{[...changes].map(([change, count]) => <StatusBadge key={change} tone={change === 'new' ? 'warning' : 'neutral'}>{count} {change} in comparison</StatusBadge>)}</div>
                  <p className="mt-2 break-all text-xs text-muted-foreground">{issue.affectedUrl || 'No affected page stored'}</p>
                  {batch.issues.length > 1 && issue.evidence && <p className="mt-2 break-words text-xs leading-5 text-muted-foreground"><span className="font-semibold">Representative evidence: </span>{issue.evidence.length > 320 ? `${issue.evidence.slice(0, 320)}...` : issue.evidence}</p>}
                  {workflowKeys.size > 0 && [...workflowKeys].some(key => statuses[key] === 'fixed') && <p className="mt-2 text-xs text-muted-foreground">Marked fixed is a manual workflow status, not audit-verified resolution.</p>}
                  {issue.recommendation && <p className="mt-4 text-sm leading-7"><span className="font-semibold text-accent">Next step: </span>{issue.recommendation}</p>}
                  <button type="button" onClick={(event) => openInspector(issue, event.currentTarget)} aria-label={`Open details for ${issue.title}`} className="audit-text-action inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent mt-3"><FileText className="h-4 w-4" />{batch.issues.length > 1 ? 'Review fix batch and workflow' : issue.evidence ? 'View evidence and workflow' : 'Review finding and workflow'}<ChevronRight className="h-4 w-4" /></button>
                </div>
              </article>
            );
          }) : <div className="p-8 text-center text-sm text-muted-foreground">No findings match the selected filters.</div>}
          {!evidenceFilters && rows.length > PAGE_SIZE && <div className="flex items-center justify-between border-t border-border p-3 text-sm"><span className="text-muted-foreground">Page {currentPage} of {pageCount}</span><div className="flex gap-2"><button type="button" disabled={currentPage <= 1} onClick={() => setPage(Math.max(1, currentPage - 1))} className="quiet-button min-h-8 px-3 py-1">Previous</button><button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(Math.min(pageCount, currentPage + 1))} className="quiet-button min-h-8 px-3 py-1">Next</button></div></div>}
        </div>

        {selected && selectedInsight && createPortal(<div className="audit-customer-workspace fixed inset-0 z-[90] flex justify-end bg-black/65" onMouseDown={event => { if (event.target === event.currentTarget) closeInspector(); }}>
          <aside ref={inspectorRef} role="dialog" aria-modal="true" aria-labelledby="finding-inspector-title" className="flex h-full w-full max-w-xl min-w-0 flex-col overflow-hidden border-l border-border bg-card shadow-xl" aria-label="Finding details">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border p-6"><div className="min-w-0"><div className="flex flex-wrap gap-2"><StatusBadge tone={severityTone(selected.severity)}>{selected.severity}</StatusBadge><StatusBadge tone="accent">{issueBucket(selected)}</StatusBadge></div><h3 id="finding-inspector-title" className="mt-4 text-xl font-semibold">{selected.title}</h3><p className="mt-3 break-all text-xs text-muted-foreground">{selected.affectedUrl || 'No affected page stored'}</p></div><button ref={closeRef} type="button" onClick={closeInspector} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Close finding details"><X className="h-5 w-5" /></button></div>
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-[var(--surface-inset)] px-3 py-2"><button type="button" onClick={() => moveInspector(-1)} className="quiet-button min-h-9 px-3 py-1.5 text-xs"><ArrowLeft className="h-3.5 w-3.5" /> Previous</button><span className="text-xs text-muted-foreground">{selectedIndex + 1} of {filtered.length}</span><button type="button" onClick={() => moveInspector(1)} className="quiet-button min-h-9 px-3 py-1.5 text-xs">Next <ArrowRight className="h-3.5 w-3.5" /></button></div>
            <div className="min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-contain p-6">
              {selectedBatch && selectedBatch.issues.length > 1 && <section aria-label="Fix batch members"><h4 className="text-sm font-semibold">Fix batch: {selectedBatch.affectedCount} affected URLs{evidenceFilters ? ' loaded' : ''}</h4><p className="mt-1 text-xs text-muted-foreground">{selectedBatch.issues.length} recorded findings with the same check and recommended fix. Workflow details remain per finding.</p><ul className="mt-3 divide-y divide-border border-y border-border">{selectedBatch.issues.slice((currentBatchPage - 1) * PAGE_SIZE, currentBatchPage * PAGE_SIZE).map(member => <li key={member.id}><button type="button" aria-current={member.id === selected.id ? 'true' : undefined} onClick={() => openInspector(member)} className={`w-full min-w-0 py-3 text-left ${member.id === selected.id ? 'text-accent' : ''}`}><span className="block break-all text-xs">{member.affectedUrl || 'Affected URL not stored'}</span><span className="mt-1 block text-xs capitalize text-muted-foreground">{statusLabel(statuses[issueSignature(member)] || 'not_started')}</span></button></li>)}</ul>{batchPageCount > 1 && <nav className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs" aria-label="Fix batch member pagination"><span>Members page {currentBatchPage} of {batchPageCount}</span><button type="button" disabled={currentBatchPage <= 1} onClick={() => setBatchPage(currentBatchPage - 1)} className="quiet-button min-h-9 px-2">Previous members</button><button type="button" disabled={currentBatchPage >= batchPageCount} onClick={() => setBatchPage(currentBatchPage + 1)} className="quiet-button min-h-9 px-2">Next members</button></nav>}</section>}
              <section className="grid gap-3 border-b border-border pb-4 sm:grid-cols-2"><div><h4 className="text-xs font-semibold text-accent">{findingImpact(selected).label}</h4><p className="mt-1 text-sm leading-6 text-muted-foreground">{findingImpact(selected).detail} This is a prioritization guide, not a promised score increase.</p></div><div><h4 className="text-xs font-semibold text-accent">{findingEffort(selected).label}</h4><p className="mt-1 text-sm leading-6 text-muted-foreground">{findingEffort(selected).detail}</p></div></section>
              {[['What happened', selectedInsight.whatHappened], ['Why it matters', selectedInsight.whyItMatters], ['Recommendation', selectedInsight.howToFix]].map(([title, copy]) => <section key={title}><h4 className="text-xs font-semibold text-muted-foreground">{title}</h4><p className="mt-1 text-sm leading-6">{copy}</p></section>)}
              <section><h4 className="text-xs font-semibold text-muted-foreground">Evidence</h4><div className="mt-2 rounded-lg border border-border bg-[var(--surface-inset)] p-3 text-sm leading-6">{selected.evidence || 'No additional evidence was stored for this finding.'}</div></section>
              <section><h4 className="text-xs font-semibold text-muted-foreground">Affected and source pages</h4><div className="mt-2 grid gap-2">{selectedUrls.slice((currentSourcePage - 1) * PAGE_SIZE, currentSourcePage * PAGE_SIZE).map(url => <div key={url} className="rounded-lg border border-border px-3 py-2"><div className="text-[11px] font-semibold text-muted-foreground">{url === selected.affectedUrl ? 'Affected page' : 'Source page'}</div><div className="mt-1 break-all text-xs">{url}</div></div>)}</div>{sourcePageCount > 1 && <nav className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs" aria-label="Source page pagination"><span>URL page {currentSourcePage} of {sourcePageCount}</span><button type="button" disabled={currentSourcePage <= 1} onClick={() => setSourcePage(currentSourcePage - 1)} className="quiet-button min-h-9 px-2">Previous URLs</button><button type="button" disabled={currentSourcePage >= sourcePageCount} onClick={() => setSourcePage(currentSourcePage + 1)} className="quiet-button min-h-9 px-2">Next URLs</button></nav>}</section>
              <section><h4 className="text-xs font-semibold text-muted-foreground">Technical details</h4><p className="mt-1 text-sm leading-6">{selectedInsight.technicalDetails}</p></section>
              {onStatusChange && <label className="block"><span className="text-xs font-semibold text-muted-foreground">Workflow status</span><select value={selectedStatus} disabled={savingKeys.has(selectedKey)} onChange={(event) => onStatusChange(selectedKey, event.target.value as ChecklistStatus)} className="suite-input mt-2">{STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>}
              {findingWorkflowResolutionDetail(selectedStatus) && <p className="text-sm leading-6 text-muted-foreground" role="status">{findingWorkflowResolutionDetail(selectedStatus)}</p>}
              <section><label htmlFor={`finding-note-${selected.id}`} className="text-xs font-semibold text-muted-foreground">Implementation note</label><textarea id={`finding-note-${selected.id}`} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} maxLength={2000} rows={4} className="suite-input mt-2 resize-y" placeholder="Add context for the person fixing this finding" /><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="block"><span className="text-xs font-semibold text-muted-foreground">Due date</span><input type="date" value={dueDraft} onChange={(event) => setDueDraft(event.target.value)} disabled={workflowStorage !== 'supabase'} className="suite-input mt-2" /></label><label className="flex min-h-11 items-center gap-2 self-end rounded-lg border border-border px-3 text-sm font-semibold"><input type="checkbox" checked={Boolean(selectedWorkflow?.assignedTo)} disabled={workflowStorage !== 'supabase' || !onWorkflowSave} onChange={(event) => onWorkflowSave && void onWorkflowSave(selectedKey, { assignedToSelf: event.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />Assign to account owner</label></div><div className="mt-2 flex items-center justify-between gap-3"><span className="text-[11px] text-muted-foreground">{workflowStorage === 'supabase' ? `Account synced${selectedWorkflow?.updatedAt ? ` · updated ${new Date(selectedWorkflow.updatedAt).toLocaleString()}` : ''}` : 'Stored on this device for this audit.'}</span><button type="button" onClick={() => void saveNote()} disabled={!auditId || !onWorkflowSave || savingKeys.has(selectedKey)} className="quiet-button min-h-9 px-3 py-1.5 text-xs">{savingKeys.has(selectedKey) ? 'Saving...' : 'Save details'}</button></div>{noteMessage && <p role="status" className={`mt-2 text-xs font-semibold ${noteMessage.includes('not saved') ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{noteMessage}</p>}</section>
            </div>
          </aside>
        </div>, document.body)}
      </div>
    </section>
  );
});
