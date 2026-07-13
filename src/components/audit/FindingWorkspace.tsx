import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckSquare, ChevronRight, FileText, Search, X } from 'lucide-react';
import type { ResourceAuditIssue } from '../../lib/audit/resource-types';
import { buildIssueInsight, issueBucket, issueSignature, readFindingNotes, writeFindingNotes, type ChecklistStatus } from '../../lib/audit/client-insights';
import { StatusBadge } from '../ui/visual-system';

const PAGE_SIZE = 20;
const STATUSES: ChecklistStatus[] = ['not_started', 'in_progress', 'fixed', 'ignored', 'reopened'];
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function statusLabel(value: ChecklistStatus) {
  return value.replace(/_/g, ' ');
}

function severityTone(severity: ResourceAuditIssue['severity']) {
  if (severity === 'critical') return 'danger' as const;
  if (severity === 'high' || severity === 'medium') return 'warning' as const;
  return 'neutral' as const;
}

export default function FindingWorkspace({
  auditId = '',
  issues,
  statuses = {},
  onStatusChange,
}: {
  auditId?: string;
  issues: ResourceAuditIssue[];
  statuses?: Record<string, ChecklistStatus>;
  onStatusChange?: (signature: string, status: ChecklistStatus) => void;
}) {
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('all');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [errorCode, setErrorCode] = useState('all');
  const [sort, setSort] = useState('priority');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>(() => readFindingNotes(auditId));
  const [noteDraft, setNoteDraft] = useState('');
  const [noteMessage, setNoteMessage] = useState<string | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const categories = useMemo(() => Array.from(new Set(issues.map((issue) => issue.category).filter(Boolean))).sort(), [issues]);
  const failureCodes = useMemo(() => Array.from(new Set(issues.map((issue) => issue.failureCode).filter((value): value is string => Boolean(value)))).sort(), [issues]);
  const filtered = useMemo(() => {
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
  }, [category, errorCode, issues, query, severity, sort, status, statuses]);

  useEffect(() => setPage(1), [query, severity, category, status, errorCode, sort]);
  useEffect(() => setNotes(readFindingNotes(auditId)), [auditId]);
  useEffect(() => {
    if (!selectedId) return;
    window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeInspector();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedIndex = filtered.findIndex((issue) => issue.id === selectedId);
  const selected = selectedIndex >= 0 ? filtered[selectedIndex] : issues.find((issue) => issue.id === selectedId) || null;
  const selectedInsight = selected ? buildIssueInsight(selected) : null;
  const highPriority = issues.filter((issue) => issue.severity === 'critical' || issue.severity === 'high').length;

  const openInspector = (issue: ResourceAuditIssue, trigger?: HTMLElement | null) => {
    restoreFocusRef.current = trigger || document.activeElement as HTMLElement | null;
    setSelectedId(issue.id);
    setNoteDraft(notes[issueSignature(issue)] || '');
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
    setNoteDraft(notes[issueSignature(next)] || '');
    setNoteMessage(null);
  };
  const saveNote = () => {
    if (!selected || !auditId) return;
    const signature = issueSignature(selected);
    const next = { ...notes, [signature]: noteDraft.trim() };
    if (!next[signature]) delete next[signature];
    setNotes(next);
    writeFindingNotes(auditId, next);
    setNoteMessage(next[signature] ? 'Note saved on this device.' : 'Note removed.');
    window.setTimeout(() => setNoteMessage(null), 2500);
  };
  const toggleChecked = (id: string) => setCheckedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const bulkUpdate = (nextStatus: ChecklistStatus) => {
    if (!onStatusChange) return;
    issues.filter((issue) => checkedIds.has(issue.id)).forEach((issue) => onStatusChange(issueSignature(issue), nextStatus));
    setCheckedIds(new Set());
  };

  return (
    <section aria-labelledby="finding-workspace-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 id="finding-workspace-title" className="text-xl font-semibold">Findings</h2><p className="mt-1 text-sm text-muted-foreground">Search and filter the list, then open a finding for evidence, affected pages, status, and notes.</p></div><div className="flex flex-wrap gap-2"><StatusBadge tone="warning">{highPriority} high priority</StatusBadge><StatusBadge tone="neutral">{issues.length} total</StatusBadge></div></div>

      <div className="mt-4 grid gap-3 rounded-xl border border-border bg-[var(--surface-inset)] p-3 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_140px_160px_150px_180px_140px]">
        <label className="relative"><span className="sr-only">Search finding URLs and titles</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search URL or finding" className="suite-input pl-9" /></label>
        <select value={severity} onChange={(event) => setSeverity(event.target.value)} className="suite-input" aria-label="Filter by priority"><option value="all">All priorities</option>{Object.keys(SEVERITY_ORDER).map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select value={category} onChange={(event) => setCategory(event.target.value)} className="suite-input" aria-label="Filter by category"><option value="all">All categories</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="suite-input" aria-label="Filter by workflow status"><option value="all">All statuses</option>{STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select>
        <select value={errorCode} onChange={(event) => setErrorCode(event.target.value)} className="suite-input" aria-label="Filter by error type"><option value="all">All error types</option>{failureCodes.map((value) => <option key={value} value={value}>{issues.find((issue) => issue.failureCode === value)?.title || value}</option>)}</select>
        <select value={sort} onChange={(event) => setSort(event.target.value)} className="suite-input" aria-label="Sort findings"><option value="priority">Priority first</option><option value="title">Title</option><option value="url">URL</option></select>
      </div>

      {checkedIds.size > 0 && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-sm"><CheckSquare className="h-4 w-4 text-accent" /><strong>{checkedIds.size} selected</strong>{onStatusChange && <select defaultValue="" onChange={(event) => event.target.value && bulkUpdate(event.target.value as ChecklistStatus)} className="ml-auto rounded-md border border-border bg-card px-2 py-1.5"><option value="">Bulk status...</option>{STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select>}<button type="button" onClick={() => setCheckedIds(new Set())} className="quiet-button min-h-8 px-2 py-1 text-xs">Clear</button></div>}

      <div className={`mt-4 grid min-w-0 gap-4 ${selected ? 'xl:grid-cols-[minmax(0,1fr)_minmax(390px,470px)]' : ''}`}>
        <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden grid-cols-[34px_105px_125px_minmax(220px,1fr)_90px_100px_26px] gap-3 border-b border-border bg-[var(--surface-inset)] px-3 py-2.5 text-xs font-semibold text-muted-foreground md:grid"><span /><span>Priority</span><span>Category</span><span>Finding</span><span>Pages</span><span>Evidence</span><span /></div>
          {visible.length ? visible.map((issue) => {
            const signature = issueSignature(issue);
            const workflowStatus = statuses[signature] || 'not_started';
            return (
              <div key={issue.id} className={`grid min-w-0 gap-3 border-b border-border px-3 py-3.5 last:border-0 md:grid-cols-[34px_105px_125px_minmax(220px,1fr)_90px_100px_26px] md:items-center ${selectedId === issue.id ? 'bg-accent/7' : 'hover:bg-muted/30'}`}>
                <input type="checkbox" checked={checkedIds.has(issue.id)} onChange={() => toggleChecked(issue.id)} aria-label={`Select ${issue.title}`} className="h-4 w-4 accent-[var(--accent)]" />
                <StatusBadge tone={severityTone(issue.severity)}>{issue.severity}</StatusBadge>
                <span className="truncate text-xs font-semibold text-muted-foreground">{issue.category}</span>
                <button type="button" onClick={(event) => openInspector(issue, event.currentTarget)} className="min-w-0 text-left"><span className="block truncate text-sm font-semibold">{issue.title}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{issue.affectedUrl || 'No affected page stored'}</span><span className="mt-1 block text-[11px] capitalize text-muted-foreground">{statusLabel(workflowStatus)}</span></button>
                <span className="text-sm tabular-nums">{issue.affectedPageCount || 1}</span>
                <span className={`inline-flex w-fit items-center gap-1 text-xs ${issue.evidence ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}`}><FileText className="h-3.5 w-3.5" />{issue.evidence ? 'Available' : 'Limited'}</span>
                <button type="button" onClick={(event) => openInspector(issue, event.currentTarget)} aria-label={`Open details for ${issue.title}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronRight className="h-4 w-4" /></button>
              </div>
            );
          }) : <div className="p-8 text-center text-sm text-muted-foreground">No findings match the selected filters.</div>}
          {filtered.length > PAGE_SIZE && <div className="flex items-center justify-between border-t border-border p-3 text-sm"><span className="text-muted-foreground">Page {page} of {pageCount}</span><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="quiet-button min-h-8 px-3 py-1">Previous</button><button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="quiet-button min-h-8 px-3 py-1">Next</button></div></div>}
        </div>

        {selected && selectedInsight && <>
          <button type="button" onClick={closeInspector} className="fixed inset-0 z-[70] bg-slate-950/35 xl:hidden" aria-label="Close finding details" />
          <aside role="dialog" aria-modal="false" aria-labelledby="finding-inspector-title" className="fixed inset-x-0 bottom-0 top-[4.25rem] z-[75] flex min-w-0 flex-col overflow-hidden border border-border bg-card shadow-sm xl:sticky xl:inset-auto xl:top-20 xl:z-auto xl:max-h-[calc(100dvh-7rem)] xl:rounded-xl" aria-label="Finding details">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4"><div className="min-w-0"><div className="flex flex-wrap gap-2"><StatusBadge tone={severityTone(selected.severity)}>{selected.severity}</StatusBadge><StatusBadge tone="accent">{issueBucket(selected)}</StatusBadge></div><h3 id="finding-inspector-title" className="mt-3 text-lg font-semibold">{selected.title}</h3><p className="mt-1 truncate text-xs text-muted-foreground" title={selected.affectedUrl}>{selected.affectedUrl || 'No affected page stored'}</p></div><button ref={closeRef} type="button" onClick={closeInspector} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Close finding details"><X className="h-5 w-5" /></button></div>
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-[var(--surface-inset)] px-3 py-2"><button type="button" onClick={() => moveInspector(-1)} className="quiet-button min-h-9 px-3 py-1.5 text-xs"><ArrowLeft className="h-3.5 w-3.5" /> Previous</button><span className="text-xs text-muted-foreground">{selectedIndex + 1} of {filtered.length}</span><button type="button" onClick={() => moveInspector(1)} className="quiet-button min-h-9 px-3 py-1.5 text-xs">Next <ArrowRight className="h-3.5 w-3.5" /></button></div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
              {[['What happened', selectedInsight.whatHappened], ['Why it matters', selectedInsight.whyItMatters], ['Recommendation', selectedInsight.howToFix]].map(([title, copy]) => <section key={title}><h4 className="text-xs font-semibold text-muted-foreground">{title}</h4><p className="mt-1 text-sm leading-6">{copy}</p></section>)}
              <section><h4 className="text-xs font-semibold text-muted-foreground">Evidence</h4><div className="mt-2 rounded-lg border border-border bg-[var(--surface-inset)] p-3 text-sm leading-6">{selected.evidence || 'No additional evidence was stored for this finding.'}</div></section>
              <section><h4 className="text-xs font-semibold text-muted-foreground">Affected and source pages</h4><div className="mt-2 grid gap-2">{Array.from(new Set([selected.affectedUrl, ...(selected.sourceUrls || [])].filter(Boolean))).map((url, index) => <div key={url} className="rounded-lg border border-border px-3 py-2"><div className="text-[11px] font-semibold text-muted-foreground">{index === 0 ? 'Affected page' : 'Source page'}</div><div className="mt-1 break-all text-xs">{url}</div></div>)}</div></section>
              <section><h4 className="text-xs font-semibold text-muted-foreground">Technical details</h4><p className="mt-1 text-sm leading-6">{selectedInsight.technicalDetails}</p></section>
              {onStatusChange && <label className="block"><span className="text-xs font-semibold text-muted-foreground">Workflow status</span><select value={statuses[issueSignature(selected)] || 'not_started'} onChange={(event) => onStatusChange(issueSignature(selected), event.target.value as ChecklistStatus)} className="suite-input mt-2">{STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>}
              <section><label htmlFor={`finding-note-${selected.id}`} className="text-xs font-semibold text-muted-foreground">Implementation note</label><textarea id={`finding-note-${selected.id}`} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} maxLength={2000} rows={4} className="suite-input mt-2 resize-y" placeholder="Add context for the person fixing this finding" /><div className="mt-2 flex items-center justify-between gap-3"><span className="text-[11px] text-muted-foreground">Stored on this device for this audit.</span><button type="button" onClick={saveNote} disabled={!auditId} className="quiet-button min-h-9 px-3 py-1.5 text-xs">Save note</button></div>{noteMessage && <p role="status" className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">{noteMessage}</p>}</section>
            </div>
          </aside>
        </>}
      </div>
    </section>
  );
}
