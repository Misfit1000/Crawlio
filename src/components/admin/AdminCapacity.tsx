import { Clock3, Gauge, Image, Network } from 'lucide-react';
import type { CapacitySnapshot, TimingDistribution } from '../../lib/operations/capacity-types';
import { Metric, Panel } from './shared';
import { Notice } from '../ui/page-system';
import { timestamp } from './operations-shared';

const duration = (value: number | null) => value == null ? 'No samples' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`;
export default function AdminCapacity({ data }: { data: CapacitySnapshot }) {
  const { previews, openPageRank: provider, timings } = data;
  const stages: Array<[string, TimingDistribution]> = [
    ['Admission transaction', timings.admission], ['Server response preparation', timings.serverPreparation],
    ['Queued to first claim', timings.queue], ['First claim to first analysed page', timings.firstPage], ['Accepted to successful completion', timings.completion],
  ];
  return <>
    <Panel title="Free-tier capacity" icon={Gauge}>
      <div className="admin-metrics">
        <Metric icon={Clock3} label="Preview time remaining" value={`${(previews.remainingMs / 60_000).toFixed(1)} min`} detail={`of ${previews.dailyBudgetMs / 60_000} min application budget`} tone={previews.remainingMs < 60_000 ? 'warning' : 'success'} />
        <Metric icon={Image} label="Capture queue" value={previews.queued} detail={`${previews.running} running; one browser at a time`} />
        <Metric icon={Gauge} label="Preview storage" value={`${(previews.storageBytes / 1024 ** 2).toFixed(1)} MB`} detail={`${previews.storageLimitBytes / 1024 ** 2} MB application ceiling`} />
        <Metric icon={Network} label="Domain lookups reserved" value={provider.monthlyReserved.toLocaleString()} detail={`of ${provider.applicationMonthlyLimit.toLocaleString()} application monthly budget`} tone={provider.monthlyReserved >= provider.applicationMonthlyLimit * 0.9 ? 'warning' : 'success'} />
      </div>
      <dl className="mt-6 grid gap-4 border-t border-border pt-6 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Preview reset</dt><dd className="mt-1">{timestamp(previews.resetAt)} / {previews.reuseHours}h reuse / {previews.retentionDays}d retention</dd></div>
        <div><dt className="text-muted-foreground">Lookup reset</dt><dd className="mt-1">{timestamp(provider.resetAt)} / {provider.minuteReserved} of {provider.applicationMinuteLimit} reserved this minute</dd></div>
        <div><dt className="text-muted-foreground">Background maintenance</dt><dd className="mt-1">{data.maintenance ? timestamp(data.maintenance.lastRunAt) : 'Not yet recorded'}</dd></div>
        <div><dt className="text-muted-foreground">Secondary wake configuration</dt><dd className="mt-1">{data.configured.secondaryWake ? 'Configured; compatibility checked before wake' : 'Not configured'}</dd></div>
      </dl>
      {(!data.configured.previews || !data.configured.openPageRank) && <Notice tone="warning" className="mt-5">{!data.configured.previews && 'Site previews are disabled. '}{!data.configured.openPageRank && 'Open PageRank is not configured.'}</Notice>}
      <p className="mt-5 text-xs leading-5 text-muted-foreground">Reservations start with this release and are not provider billing totals. Earlier lookups and other applications using the same account are not included, so the provider may reach its limit sooner. Cached evidence uses no new lookup; audit processing continues when optional services reach their budgets.</p>
    </Panel>
    <Panel title="Observed audit speed" icon={Clock3}>
      <div className="max-w-full overflow-x-auto"><table className="suite-table w-full min-w-[520px]">
        <caption className="sr-only">Server and database observations, latest {timings.maxSamples} audits within {timings.windowDays} days</caption>
        <thead><tr><th scope="col">Stage</th><th scope="col">Median</th><th scope="col">95th percentile</th><th scope="col">Samples</th></tr></thead>
        <tbody>{stages.map(([label, values]) => <tr key={label}><th scope="row" className="font-medium">{label}</th><td>{duration(values.p50Ms)}</td><td>{duration(values.p95Ms)}</td><td>{values.samples.toLocaleString()}</td></tr>)}</tbody>
      </table></div>
      <p className="mt-5 text-xs leading-5 text-muted-foreground">Latest {timings.auditSampleCount.toLocaleString()} audits within {timings.windowDays} days, capped at {timings.maxSamples.toLocaleString()}. First-page timing starts with this release. These server observations exclude browser paint and network transit; they are not Core Web Vitals.</p>
    </Panel>
  </>;
}
