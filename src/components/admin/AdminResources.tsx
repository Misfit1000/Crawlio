import { Database, Loader2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ActionResult, AdminResources as Resources, RetentionPreview } from '../../lib/admin/types';
import { Notice } from '../ui/page-system';
import { useAdminActionReason } from './AdminActionDialog';
import { useAdminData } from './useAdminData';
import { adminGet, adminPost } from './client';
import { ActionFeedback, DataNotice, timestamp } from './operations-shared';
import { Empty, Loading, Panel } from './shared';

function bytes(value: number) { return value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024 ** 3).toFixed(2)} GB`; }
export default function AdminResources() {
  const resources = useAdminData(signal => adminGet<Resources>('resources', signal), []);
  const requestReason = useAdminActionReason();
  const [preview, setPreview] = useState<RetentionPreview | null>(null);
  const [pending, setPending] = useState<'preview' | 'apply' | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ActionResult | null>(null);
  const busy = useRef(false);
  const previewRetention = async () => {
    if (busy.current) return;
    busy.current = true; setPending('preview'); setError(''); setPreview(null); setResult(null);
    try { setPreview(await adminPost<RetentionPreview>('retention/preview', {})); }
    catch (error) { setError(error instanceof Error ? error.message : 'Retention preview failed.'); }
    finally { busy.current = false; setPending(null); }
  };
  const applyRetention = async () => {
    if (busy.current || !preview) return;
    busy.current = true;
    try {
      const snapshot = preview;
      if (Date.parse(snapshot.expiresAt) <= Date.now()) throw new Error('This retention preview expired. Generate a new preview.');
      const reason = await requestReason('permanently deleting the previewed retention batch', {
        confirmation: 'APPLY RETENTION', warning: 'Deletion is irreversible. Only the server-previewed batch is eligible; a changed or expired fingerprint is rejected.',
        changes: [{ label: 'Audits in batch', before: snapshot.audits, after: 0 }, { label: 'Associated rows', before: snapshot.associatedRows, after: 0 }],
      });
      if (!reason) return;
      if (Date.parse(snapshot.expiresAt) <= Date.now()) throw new Error('The preview expired during confirmation. Generate a new preview.');
      setPending('apply'); setError(''); setResult(null);
      const next = await adminPost<ActionResult>('retention/apply', { fingerprint: snapshot.fingerprint, reason, confirmation: 'APPLY RETENTION' });
      setResult(next); setPreview(null);
      await resources.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Retention apply failed.'); setPreview(null); }
    finally { busy.current = false; setPending(null); }
  };
  const expired = preview && Date.parse(preview.expiresAt) <= Date.now();
  return <div className="space-y-5"><Panel title="Database resources" description="Observed relation sizes and approximate row counts, not provider quotas." icon={Database}>
    <DataNotice {...resources} />
    <Notice tone="info">Storage allowance, bandwidth, and Realtime quota usage are available only in the provider dashboard. Relation sizes are not a quota estimate.</Notice>
    {resources.loading && !resources.data ? <Loading /> : resources.data?.relations.length ? <div className="mt-4 max-w-full overflow-x-auto"><table className="suite-table min-w-[660px] w-full"><caption className="sr-only">Database resource inventory observed {timestamp(resources.data.observedAt)}</caption><thead><tr>{['Relation', 'Size', 'Approx. rows', 'Oldest record', 'Retention'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{resources.data.relations.map(row => <tr key={row.name}><th scope="row" className="break-all font-mono">{row.name}</th><td>{bytes(row.bytes)}</td><td>{row.approximateRows == null ? 'Unavailable' : row.approximateRows.toLocaleString()}</td><td>{timestamp(row.oldestAt)}</td><td className="max-w-xs"><div>{row.retentionDays == null ? 'No automatic cleanup' : `${row.retentionDays} days`}</div><details className="mt-2"><summary className="min-h-11 cursor-pointer text-xs font-semibold">Policy details<span className="sr-only"> for {row.name}</span></summary><p className="whitespace-normal break-words text-xs text-muted-foreground">{row.retentionDescription || (row.retentionDays == null ? 'Retained until deletion; no automatic cleanup policy.' : 'Automatic cleanup follows the recorded retention policy.')}</p></details></td></tr>)}</tbody></table></div> : <Empty text="No resource inventory available." />}
  </Panel><Panel title="Data retention" description="Preview a bounded batch before permanent deletion." icon={Trash2}>
    {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
    {result && <div className="mb-4"><ActionFeedback result={result} /><p className="mt-2 text-sm">Audits deleted: {String(result.auditsDeleted ?? 'Not reported')}. Associated rows: {String(result.associatedRows ?? 'Not reported')}.</p></div>}
    {preview && <div className="mb-4 space-y-3"><dl className="grid gap-4 text-sm sm:grid-cols-3">{[['Batch audits', preview.audits], ['Associated rows', typeof preview.associatedRows === 'number' ? preview.associatedRows : Object.values(preview.associatedRows).reduce((total, count) => total + count, 0)], ['All eligible audits', preview.totalEligible]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}</dl><p className="text-xs text-muted-foreground">Expires: {timestamp(preview.expiresAt)}</p><p className="break-all font-mono text-xs text-muted-foreground">Fingerprint: {preview.fingerprint}</p>{expired && <Notice tone="warning">Preview expired. Generate a new preview before applying retention.</Notice>}</div>}
    <div className="flex flex-wrap gap-3"><button type="button" disabled={Boolean(pending)} onClick={previewRetention} className="quiet-button min-h-11">{pending === 'preview' && <Loader2 className="h-4 w-4 animate-spin" />}{preview ? 'Regenerate preview' : 'Preview retention'}</button><button type="button" disabled={Boolean(pending) || !preview || Boolean(expired) || !preview.audits} onClick={applyRetention} className="quiet-button min-h-11 text-red-700 dark:text-red-300">{pending === 'apply' && <Loader2 className="h-4 w-4 animate-spin" />}Apply previewed batch</button></div>
  </Panel></div>;
}
