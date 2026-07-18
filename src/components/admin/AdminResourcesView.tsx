import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Database, ExternalLink, HardDrive, Link2, RefreshCw, Server, ShieldAlert, Trash2, XCircle } from 'lucide-react';
import {
  applyAdminRetention,
  getAdminResources,
  previewAdminRetention,
  updateAdminResourceLinks,
} from '../../lib/admin/client';
import { Panel } from '../ui/page-system';
import AdminActionDialog from './AdminActionDialog';
import { AdminError, AdminLoading, AdminStatus, formatAdminDate, formatBytes } from './AdminControlPrimitives';

const RESOURCE_NAMES = ['supabase', 'vercel', 'render', 'sentry', 'github'] as const;

export default function AdminResourcesView() {
  const [data, setData] = useState<any>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'links' | 'preview' | 'apply' | null>(null);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [lastResult, setLastResult] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getAdminResources();
      setData(next);
      setLinks(next.links || {});
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Resource inventory could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConfirm = async ({ reason, confirmation }: { reason: string; confirmation: string }) => {
    setPending(true);
    setError('');
    try {
      if (dialog === 'links') {
        await updateAdminResourceLinks({ links, reason });
        await load();
      } else if (dialog === 'preview') {
        setPreview(await previewAdminRetention(reason));
        setLastResult(null);
      } else if (dialog === 'apply' && preview) {
        const result = await applyAdminRetention({
          previewId: preview.id,
          fingerprint: preview.fingerprint,
          confirmation,
          reason,
        });
        setLastResult(result);
        setPreview(null);
        await load();
      }
      setDialog(null);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The resource action failed.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Data and resources</h2>
          <p className="mt-1 text-sm text-muted-foreground">Storage inventory, service readiness, deployment versions, runbooks, and guarded retention.</p>
        </div>
        <button type="button" onClick={() => void load()} className="quiet-button self-start sm:self-auto"><RefreshCw className="h-4 w-4" />Refresh</button>
      </div>

      {error && <AdminError message={error} />}
      {lastResult && <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300"><div className="font-semibold">Retention cleanup applied</div><div className="mt-1">The recorded preview was applied once and stored in administrator history.</div></div>}

      {loading && !data ? <AdminLoading /> : data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {Object.entries(data.serviceReadiness || {}).map(([service, readiness]: [string, any]) => (
              <div key={service} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="capitalize font-semibold">{service.replace(/([A-Z])/g, ' $1')}</span>
                  {readiness.healthy === true ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : readiness.healthy === false ? <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" /> : <Server className="h-4 w-4 text-muted-foreground" />}
                </div>
                <div className="mt-3"><AdminStatus value={readiness.configured ? readiness.healthy === false ? 'degraded' : 'configured' : 'not configured'} /></div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
            <Panel className="overflow-hidden p-0">
              <div className="border-b border-border px-4 py-3">
                <div className="flex items-center gap-2"><HardDrive className="h-4 w-4 text-accent" /><h3 className="font-semibold">Resource inventory</h3></div>
                <p className="mt-1 text-sm text-muted-foreground">Allowlisted tables only. Row counts are database estimates.</p>
              </div>
              <div className="max-w-full overflow-x-auto">
                <table className="suite-table min-w-[780px]">
                  <thead><tr><th>Resource</th><th>Approx. rows</th><th>Size</th><th>Oldest record</th><th>Retention</th><th>Eligible</th></tr></thead>
                  <tbody>
                    {(data.inventory || []).map((item: any) => (
                      <tr key={item.resourceName}>
                        <td className="font-mono text-xs">{item.resourceName}</td>
                        <td className="tabular-nums">{item.approximateRows.toLocaleString()}</td>
                        <td className="tabular-nums">{formatBytes(item.totalBytes)}</td>
                        <td className="text-xs text-muted-foreground">{formatAdminDate(item.oldestRecordAt)}</td>
                        <td className="text-sm text-muted-foreground">{item.retentionPolicy}</td>
                        <td className="tabular-nums">{item.cleanupEligible.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">Supabase storage and billing quotas are available only in the provider dashboard.</div>
            </Panel>

            <Panel>
              <div className="flex items-center gap-2"><Database className="h-4 w-4 text-accent" /><h3 className="font-semibold">Deployment versions</h3></div>
              <div className="mt-4 space-y-3">
                <VersionRow label="Application" value={data.versions.currentCommit} matches />
                <VersionRow label="Database migration" value={data.versions.databaseCommit} matches={data.versions.matching.database} />
                <VersionRow label="Audit engine" value={data.versions.workerCommit} matches={data.versions.matching.worker} />
                <div className="border-t border-border pt-3 text-sm text-muted-foreground">Audit API schema <span className="font-semibold text-foreground">{data.versions.databaseApiSchema ?? 'Not reported'}</span> / expected <span className="font-semibold text-foreground">{data.versions.expectedApiSchema}</span></div>
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <Panel>
              <div className="flex items-center gap-2"><Link2 className="h-4 w-4 text-accent" /><h3 className="font-semibold">Administrator resources</h3></div>
              <p className="mt-1 text-sm text-muted-foreground">Optional HTTPS links are restricted to approved provider hosts.</p>
              <div className="mt-4 space-y-3">
                {RESOURCE_NAMES.map((name) => (
                  <label key={name} className="block">
                    <span className="text-xs font-semibold capitalize">{name}</span>
                    <div className="mt-1 flex gap-2">
                      <input value={links[name] || ''} onChange={(event) => setLinks((current) => ({ ...current, [name]: event.target.value }))} className="suite-input min-w-0 flex-1" placeholder={`https://${name}.com/...`} />
                      {links[name] && <a href={links[name]} target="_blank" rel="noreferrer" className="icon-button h-10 w-10" aria-label={`Open ${name}`}><ExternalLink className="h-4 w-4" /></a>}
                    </div>
                  </label>
                ))}
              </div>
              <button type="button" onClick={() => setDialog('links')} className="primary-button mt-4">Save resource links</button>
            </Panel>

            <Panel>
              <div className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" /><h3 className="font-semibold">Data retention</h3></div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Preview eligible records first. Applying cleanup requires the same fingerprint within ten minutes and a typed confirmation.</p>
              {preview ? (
                <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/6 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">Preview ready</span><AdminStatus value="review" /></div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {Object.entries(preview.preview || {}).filter(([key]) => key !== 'applied').map(([key, value]) => (
                      <div key={key} className="rounded-lg border border-border bg-background px-3 py-2"><div className="text-xs capitalize text-muted-foreground">{key.replace(/([A-Z])/g, ' $1')}</div><div className="mt-1 font-semibold tabular-nums">{Number(value).toLocaleString()}</div></div>
                    ))}
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">Expires {formatAdminDate(preview.expires_at)} / Fingerprint <span className="font-mono">{preview.fingerprint.slice(0, 12)}...</span></div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setDialog('apply')} className="danger-button"><Trash2 className="h-4 w-4" />Apply retention</button>
                    <button type="button" onClick={() => setPreview(null)} className="quiet-button">Discard preview</button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-border bg-muted/35 p-4">
                  <div className="text-sm font-semibold">No active preview</div>
                  <p className="mt-1 text-sm text-muted-foreground">Creating a preview does not delete or modify data.</p>
                  <button type="button" onClick={() => setDialog('preview')} className="quiet-button mt-4"><RefreshCw className="h-4 w-4" />Preview cleanup</button>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}

      <AdminActionDialog
        open={Boolean(dialog)}
        title={dialog === 'links' ? 'Update administrator resource links' : dialog === 'preview' ? 'Preview retention cleanup' : 'Apply retention cleanup'}
        description={dialog === 'links' ? 'Save only allowlisted provider-dashboard and runbook links.' : dialog === 'preview' ? 'Calculate eligible record counts without deleting data.' : 'Delete only records represented by the matching, unexpired preview.'}
        actionLabel={dialog === 'links' ? 'Save links' : dialog === 'preview' ? 'Create preview' : 'Apply cleanup'}
        tone={dialog === 'apply' ? 'danger' : 'primary'}
        confirmationPhrase={dialog === 'apply' ? 'APPLY RETENTION' : undefined}
        impact={dialog === 'apply' ? ['Expired audit events and diagnostics are deleted.', 'Old failed guest audits and expired rate-limit records are deleted.', 'Administrator actions and user-owned audit reports are not part of this cleanup.'] : []}
        pending={pending}
        error={error}
        onCancel={() => {
          if (!pending) setDialog(null);
        }}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

function VersionRow({ label, value, matches }: { label: string; value: string | null; matches: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <div className="min-w-0"><div className="text-sm font-semibold">{label}</div><div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{value || 'Not reported'}</div></div>
      <AdminStatus value={matches ? 'matching' : 'mismatch'} />
    </div>
  );
}
