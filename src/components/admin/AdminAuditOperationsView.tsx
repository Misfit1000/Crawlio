import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, Download, Flag, RefreshCw, RotateCcw, Search, Square, SquareCheckBig, XCircle } from 'lucide-react';
import {
  downloadAdminExport,
  getAdminControlAudits,
  runAdminAuditBulkAction,
  type AdminAuditSummary,
} from '../../lib/admin/client';
import { Panel } from '../ui/page-system';
import AdminActionDialog from './AdminActionDialog';
import { AdminEmpty, AdminError, AdminLoading, AdminStatus, formatAdminDate } from './AdminControlPrimitives';

type AuditFilters = { query: string; status: string; plan: string; mode: string };
type SavedAuditFilter = { id: string; name: string; filters: AuditFilters };

const SAVED_FILTERS_KEY = 'crawlio_admin_audit_filters_v2';
const EMPTY_FILTERS: AuditFilters = { query: '', status: '', plan: '', mode: '' };

function readSavedFilters() {
  try {
    const value = JSON.parse(localStorage.getItem(SAVED_FILTERS_KEY) || '[]');
    return Array.isArray(value) ? value.slice(0, 10) as SavedAuditFilter[] : [];
  } catch {
    return [];
  }
}

export default function AdminAuditOperationsView() {
  const [queryInput, setQueryInput] = useState('');
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [audits, setAudits] = useState<AdminAuditSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [bulkLimit, setBulkLimit] = useState(25);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savedFilters, setSavedFilters] = useState<SavedAuditFilter[]>(readSavedFilters);
  const [viewName, setViewName] = useState('');
  const [pendingAction, setPendingAction] = useState<'cancel' | 'retry' | 'recover_stale' | 'priority' | null>(null);
  const [priority, setPriority] = useState(100);
  const [actionPending, setActionPending] = useState(false);

  const load = useCallback(async (append = false, cursor: string | null = null) => {
    setLoading(true);
    try {
      const page = await getAdminControlAudits({ ...filters, cursor, limit: 25 });
      setAudits((current) => append ? [...current, ...page.items] : page.items);
      setTotal(page.total);
      setNextCursor(page.nextCursor);
      setBulkLimit(page.bulkLimit);
      if (!append) setSelected([]);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Audit operations could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load(false, null);
  }, [load]);

  const eligibleVisible = useMemo(() => audits.slice(0, bulkLimit).map((audit) => audit.id), [audits, bulkLimit]);
  const allVisibleSelected = eligibleVisible.length > 0 && eligibleVisible.every((id) => selected.includes(id));

  const toggleAudit = (id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < bulkLimit ? [...current, id] : current);
  };

  const saveFilter = () => {
    const name = viewName.trim();
    if (name.length < 2) return;
    const next = [{ id: crypto.randomUUID(), name: name.slice(0, 50), filters }, ...savedFilters].slice(0, 10);
    localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(next));
    setSavedFilters(next);
    setViewName('');
  };

  const runBulkAction = async ({ reason }: { reason: string; confirmation: string }) => {
    if (!pendingAction || selected.length === 0) return;
    setActionPending(true);
    setError('');
    try {
      await runAdminAuditBulkAction({
        action: pendingAction,
        auditIds: selected,
        reason,
        ...(pendingAction === 'priority' ? { queuePriority: priority } : {}),
      });
      setPendingAction(null);
      await load(false, null);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The bulk audit action failed.');
    } finally {
      setActionPending(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Audit operations</h2>
          <p className="mt-1 text-sm text-muted-foreground">Filter, export, recover, and prioritize audit jobs in bounded batches.</p>
        </div>
        <button type="button" onClick={() => void downloadAdminExport('audits')} className="quiet-button self-start lg:self-auto"><Download className="h-4 w-4" />Export CSV</button>
      </div>

      <Panel>
        <form className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_165px_140px_140px_auto]" onSubmit={(event) => {
          event.preventDefault();
          setFilters((current) => ({ ...current, query: queryInput.trim() }));
        }}>
          <label className="relative">
            <span className="sr-only">Search audited URL</span>
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} className="suite-input pl-9" placeholder="Search audited URL" />
          </label>
          <select aria-label="Audit status filter" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className="suite-input">
            <option value="">All statuses</option><option value="queued">Waiting</option><option value="running">Checking</option><option value="completed">Completed</option><option value="completed_with_warnings">Completed with warnings</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option><option value="abandoned">Abandoned</option>
          </select>
          <select aria-label="Audit plan filter" value={filters.plan} onChange={(event) => setFilters((current) => ({ ...current, plan: event.target.value }))} className="suite-input">
            <option value="">All plans</option><option value="free">Free</option><option value="paid">Paid</option><option value="agency">Agency</option><option value="admin">Admin</option>
          </select>
          <select aria-label="Audit mode filter" value={filters.mode} onChange={(event) => setFilters((current) => ({ ...current, mode: event.target.value }))} className="suite-input">
            <option value="">All modes</option><option value="quick">Quick</option><option value="standard">Full</option><option value="deep">Deep</option>
          </select>
          <button type="submit" className="primary-button justify-center"><Search className="h-4 w-4" />Apply</button>
        </form>

        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 md:flex-row md:items-center">
          <select aria-label="Saved audit filters" className="suite-input md:max-w-56" defaultValue="" onChange={(event) => {
            const saved = savedFilters.find((item) => item.id === event.target.value);
            if (saved) {
              setFilters(saved.filters);
              setQueryInput(saved.filters.query);
            }
          }}>
            <option value="">Saved filters</option>
            {savedFilters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <input value={viewName} onChange={(event) => setViewName(event.target.value)} className="suite-input md:max-w-56" placeholder="Name this filter" maxLength={50} />
          <button type="button" onClick={saveFilter} disabled={viewName.trim().length < 2} className="quiet-button justify-center"><Bookmark className="h-4 w-4" />Save filter</button>
          <button type="button" onClick={() => {
            setFilters(EMPTY_FILTERS);
            setQueryInput('');
          }} className="quiet-button justify-center">Clear</button>
        </div>
      </Panel>

      {error && <AdminError message={error} />}

      <Panel className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-sm text-muted-foreground"><span className="font-semibold text-foreground">{total}</span> audits match / <span className="font-semibold text-foreground">{selected.length}</span> selected</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!selected.length} onClick={() => setPendingAction('cancel')} className="quiet-button min-h-9 px-3"><XCircle className="h-4 w-4" />Cancel</button>
            <button type="button" disabled={!selected.length} onClick={() => setPendingAction('retry')} className="quiet-button min-h-9 px-3"><RotateCcw className="h-4 w-4" />Retry</button>
            <button type="button" disabled={!selected.length} onClick={() => setPendingAction('recover_stale')} className="quiet-button min-h-9 px-3"><RefreshCw className="h-4 w-4" />Recover stale</button>
            <select aria-label="Queue priority" value={priority} onChange={(event) => setPriority(Number(event.target.value))} className="suite-input min-h-9 w-28 py-1.5 text-xs"><option value="10">Normal</option><option value="50">Paid</option><option value="100">High</option><option value="999">Admin</option></select>
            <button type="button" disabled={!selected.length} onClick={() => setPendingAction('priority')} className="quiet-button min-h-9 px-3"><Flag className="h-4 w-4" />Priority</button>
          </div>
        </div>
        {loading && audits.length === 0 ? <AdminLoading /> : audits.length === 0 ? (
          <AdminEmpty title="No matching audits" detail="Adjust the URL, status, plan, or audit-type filters." />
        ) : (
          <>
            <div className="max-w-full overflow-x-auto">
              <table className="suite-table min-w-[1120px]">
                <thead>
                  <tr>
                    <th>
                      <button type="button" onClick={() => setSelected(allVisibleSelected ? [] : eligibleVisible)} className="icon-button h-8 w-8" aria-label={allVisibleSelected ? 'Clear visible selection' : `Select up to ${bulkLimit} visible audits`}>
                        {allVisibleSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                      </button>
                    </th>
                    <th>Website</th><th>Status</th><th>Coverage</th><th>Plan</th><th>Priority</th><th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {audits.map((audit) => (
                    <tr key={audit.id}>
                      <td><button type="button" onClick={() => toggleAudit(audit.id)} className="icon-button h-8 w-8" aria-label={`${selected.includes(audit.id) ? 'Deselect' : 'Select'} audit ${audit.id}`}>{selected.includes(audit.id) ? <SquareCheckBig className="h-4 w-4 text-accent" /> : <Square className="h-4 w-4" />}</button></td>
                      <td><div className="max-w-[360px] truncate font-semibold">{audit.normalizedUrl}</div><div className="mt-1 font-mono text-xs text-muted-foreground">{audit.id}</div></td>
                      <td><AdminStatus value={audit.status} /><div className="mt-1 max-w-52 truncate text-xs text-muted-foreground">{audit.currentPhase}</div></td>
                      <td><div className="tabular-nums">{audit.pagesCrawled} / {Math.max(audit.pagesDiscovered, audit.pagesCrawled)} pages</div><div className="mt-1 text-xs tabular-nums text-muted-foreground">{audit.checksCompleted} / {audit.checksTotal} checks</div></td>
                      <td><div className="capitalize">{audit.plan}</div><div className="mt-1 text-xs capitalize text-muted-foreground">{audit.effectiveMode}</div></td>
                      <td className="tabular-nums">{audit.queuePriority}</td>
                      <td className="text-sm text-muted-foreground">{formatAdminDate(audit.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {nextCursor && <div className="flex justify-center border-t border-border p-3"><button type="button" disabled={loading} onClick={() => void load(true, nextCursor)} className="quiet-button">Load more</button></div>}
          </>
        )}
      </Panel>

      <AdminActionDialog
        open={Boolean(pendingAction)}
        title={pendingAction === 'cancel' ? 'Cancel selected audits' : pendingAction === 'retry' ? 'Retry selected audits' : pendingAction === 'recover_stale' ? 'Recover stale audits' : 'Change queue priority'}
        description={`This action applies only to the ${selected.length} explicitly selected audit${selected.length === 1 ? '' : 's'}. Invalid lifecycle states will reject the whole batch.`}
        actionLabel={pendingAction === 'cancel' ? 'Cancel audits' : pendingAction === 'retry' ? 'Retry audits' : pendingAction === 'recover_stale' ? 'Recover audits' : 'Update priority'}
        tone={pendingAction === 'cancel' ? 'danger' : 'primary'}
        pending={actionPending}
        error={error}
        impact={[`At most ${bulkLimit} audit IDs are accepted per request.`, 'The action and before/after summary are stored in administrator activity history.']}
        onCancel={() => {
          if (!actionPending) setPendingAction(null);
        }}
        onConfirm={runBulkAction}
      />
    </div>
  );
}
