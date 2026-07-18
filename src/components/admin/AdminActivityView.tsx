import { useCallback, useEffect, useState } from 'react';
import { Download, History, RefreshCw, Search } from 'lucide-react';
import { downloadAdminExport, getAdminActivity } from '../../lib/admin/client';
import { Panel } from '../ui/page-system';
import { AdminEmpty, AdminError, AdminLoading, AdminStatus, formatAdminDate } from './AdminControlPrimitives';

function compactSummary(value: unknown) {
  if (value == null) return 'None';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

export default function AdminActivityView() {
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (append = false, cursor: string | null = null) => {
    setLoading(true);
    try {
      const page = await getAdminActivity({ query, cursor, limit: 30 });
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setTotal(page.total);
      setNextCursor(page.nextCursor);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Administrator activity could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load(false, null);
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Administrator activity</h2>
          <p className="mt-1 text-sm text-muted-foreground">Searchable privileged-action history with bounded before and after summaries.</p>
        </div>
        <button type="button" onClick={() => void downloadAdminExport('actions')} className="quiet-button self-start sm:self-auto"><Download className="h-4 w-4" />Export CSV</button>
      </div>

      <Panel>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => {
          event.preventDefault();
          setQuery(queryInput.trim());
        }}>
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search administrator actions</span>
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} className="suite-input pl-9" placeholder="Action, target type, or target ID" />
          </label>
          <button type="submit" className="primary-button justify-center"><Search className="h-4 w-4" />Search</button>
          <button type="button" onClick={() => void load(false, null)} className="quiet-button justify-center"><RefreshCw className="h-4 w-4" />Refresh</button>
        </form>
      </Panel>

      {error && <AdminError message={error} />}
      <Panel className="overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm text-muted-foreground"><History className="h-4 w-4" /><span><strong className="text-foreground">{total}</strong> logged actions</span></div>
        {loading && items.length === 0 ? <AdminLoading /> : items.length === 0 ? (
          <AdminEmpty title="No matching administrator actions" detail="Adjust the search text or wait for a privileged action to be recorded." />
        ) : (
          <>
            <div className="divide-y divide-border">
              {items.map((item) => (
                <article key={item.id} className="grid gap-3 p-4 xl:grid-cols-[220px_1fr_1fr]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{item.action.replace(/_/g, ' ')}</span><AdminStatus value={item.targetType || 'system'} /></div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">{item.targetId || 'No target ID'}</div>
                    <div className="mt-2 text-xs text-muted-foreground">{formatAdminDate(item.createdAt)}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/25 p-3">
                    <div className="text-xs font-semibold text-muted-foreground">Before</div>
                    <div className="mt-1 break-words font-mono text-xs leading-5">{compactSummary(item.summary.before)}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/25 p-3">
                    <div className="text-xs font-semibold text-muted-foreground">After</div>
                    <div className="mt-1 break-words font-mono text-xs leading-5">{compactSummary(item.summary.after)}</div>
                    {item.summary.reason && <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">Reason: {item.summary.reason}</div>}
                  </div>
                </article>
              ))}
            </div>
            {nextCursor && <div className="flex justify-center border-t border-border p-3"><button type="button" disabled={loading} onClick={() => void load(true, nextCursor)} className="quiet-button">Load more</button></div>}
          </>
        )}
      </Panel>
    </div>
  );
}
