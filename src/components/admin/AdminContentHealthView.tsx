import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, FileSearch, PauseCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { getAdminContentHealth, runAdminContentHealthAction } from '../../lib/admin/client';
import { Panel } from '../ui/page-system';
import AdminActionDialog from './AdminActionDialog';
import { AdminEmpty, AdminError, AdminLoading, AdminStatus } from './AdminControlPrimitives';

export default function AdminContentHealthView({ onOpenPost }: { onOpenPost: (postId?: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<any>(null);
  const [actionPending, setActionPending] = useState(false);
  const [validation, setValidation] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getAdminContentHealth());
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Content health could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => {
    const all = data?.items || [];
    return filter === 'all' ? all : all.filter((item: any) => item.kind === filter);
  }, [data, filter]);

  const applyAction = async ({ reason }: { reason: string; confirmation: string }) => {
    if (!pending) return;
    setActionPending(true);
    try {
      const result = await runAdminContentHealthAction({ action: pending.action, id: pending.id, reason });
      setPending(null);
      setValidation(pending.action === 'validate_post' ? result : null);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The content action failed.');
    } finally {
      setActionPending(false);
    }
  };

  const filters = [
    ['all', 'All'],
    ['draft_review', 'Draft review'],
    ['overdue_schedule', 'Overdue'],
    ['missing_seo', 'Missing SEO'],
    ['publication_gate', 'Publication gates'],
    ['stalled_job', 'Stalled jobs'],
    ['failed_job', 'Failed jobs'],
    ['stale_article', 'Stale articles'],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Content health</h2>
          <p className="mt-1 text-sm text-muted-foreground">Editorial, publishing, source, image, and automation issues that need attention.</p>
        </div>
        <button type="button" onClick={() => void load()} className="quiet-button self-start sm:self-auto"><RefreshCw className="h-4 w-4" />Refresh</button>
      </div>

      {error && <AdminError message={error} />}
      {validation && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${validation.passed ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300' : 'border-amber-500/25 bg-amber-500/8 text-amber-800 dark:text-amber-300'}`}>
          <div className="flex items-center gap-2 font-semibold">{validation.passed ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{validation.passed ? 'Deterministic checks passed' : `${validation.findings.length} validation finding(s)`}</div>
          {!validation.passed && <ul className="mt-2 space-y-1">{validation.findings.map((finding: string) => <li key={finding}>{finding}</li>)}</ul>}
        </div>
      )}

      {loading && !data ? <AdminLoading /> : data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-4"><div className="text-sm text-muted-foreground">Posts inspected</div><div className="mt-1 text-2xl font-semibold">{data.inspected.posts}</div></div>
            <div className="rounded-xl border border-border bg-card p-4"><div className="text-sm text-muted-foreground">Jobs inspected</div><div className="mt-1 text-2xl font-semibold">{data.inspected.jobs}</div></div>
            <div className="rounded-xl border border-border bg-card p-4"><div className="text-sm text-muted-foreground">High-priority items</div><div className="mt-1 text-2xl font-semibold">{data.items.filter((item: any) => item.severity === 'high').length}</div></div>
            <div className="rounded-xl border border-border bg-card p-4"><div className="text-sm text-muted-foreground">Total review items</div><div className="mt-1 text-2xl font-semibold">{data.items.length}</div></div>
          </div>

          <Panel>
            <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Content health filters">
              {filters.map(([value, label]) => (
                <button key={value} type="button" onClick={() => setFilter(value)} className={`min-h-9 shrink-0 rounded-lg px-3 text-sm font-semibold ${filter === value ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                  {label}{value !== 'all' && data.counts[value] ? ` (${data.counts[value]})` : ''}
                </button>
              ))}
            </div>
          </Panel>

          <Panel className="overflow-hidden p-0">
            {items.length === 0 ? <AdminEmpty title="No content issues in this view" detail="The current content-health filter has no matching review items." /> : (
              <div className="divide-y divide-border">
                {items.map((item: any) => (
                  <article key={`${item.kind}:${item.id}`} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${item.severity === 'high' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>
                        {item.entity === 'job' ? <RotateCcw className="h-4 w-4" /> : <FileSearch className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-semibold">{item.title}</h3>
                          <AdminStatus value={item.kind} />
                        </div>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.detail}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pl-12 lg:pl-0">
                      {item.entity === 'post' && <button type="button" onClick={() => onOpenPost(item.id)} className="quiet-button min-h-9 px-3"><ExternalLink className="h-4 w-4" />Open post</button>}
                      {item.action === 'hold_publication' && <button type="button" onClick={() => setPending(item)} className="quiet-button min-h-9 px-3"><PauseCircle className="h-4 w-4" />Hold</button>}
                      {item.action === 'recover_job' && <button type="button" disabled={item.recoverable === false} onClick={() => setPending(item)} className="quiet-button min-h-9 px-3"><RotateCcw className="h-4 w-4" />Recover</button>}
                      {item.action === 'validate_post' && <button type="button" onClick={() => setPending(item)} className="quiet-button min-h-9 px-3"><CheckCircle2 className="h-4 w-4" />Validate</button>}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}

      <AdminActionDialog
        open={Boolean(pending)}
        title={pending?.action === 'recover_job' ? 'Recover content job' : pending?.action === 'hold_publication' ? 'Hold publication' : 'Rerun deterministic validation'}
        description={pending?.action === 'recover_job' ? 'Return this eligible stalled or failed job to the provider-free content queue.' : pending?.action === 'hold_publication' ? 'Move this post to review and apply a noindex directive until an editor approves it.' : 'Check required SEO fields and publication gates without making ranking or indexing claims.'}
        actionLabel={pending?.action === 'recover_job' ? 'Recover job' : pending?.action === 'hold_publication' ? 'Hold publication' : 'Run validation'}
        pending={actionPending}
        error={error}
        onCancel={() => {
          if (!actionPending) setPending(null);
        }}
        onConfirm={applyAction}
      />
    </div>
  );
}
