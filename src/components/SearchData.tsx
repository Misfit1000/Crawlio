import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart3, Eye, MousePointerClick, Search, TrendingUp } from 'lucide-react';
import { MetricCard, StatusBadge, SurfaceCard } from './ui/visual-system';
import { PageHeader } from './ui/page-system';

type SearchRow = Record<string, any>;

const STORAGE_KEY = 'seo_gsc_data';

function pick(row: SearchRow, names: string[]) {
  const entries = Object.entries(row);
  for (const name of names) {
    const found = entries.find(([key]) => key.trim().toLowerCase() === name);
    if (found && found[1] !== undefined && found[1] !== null && String(found[1]).trim() !== '') return String(found[1]).trim();
  }
  return '';
}

function numberPick(row: SearchRow, names: string[]) {
  const raw = pick(row, names);
  if (!raw) return 0;
  const parsed = Number(raw.replace(/[%,$]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function SearchData() {
  const [rows, setRows] = useState<SearchRow[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      setRows(stored ? JSON.parse(stored) : []);
    } catch {
      setRows([]);
    }
  }, []);

  const summary = useMemo(() => {
    const clicks = rows.reduce((sum, row) => sum + numberPick(row, ['clicks']), 0);
    const impressions = rows.reduce((sum, row) => sum + numberPick(row, ['impressions']), 0);
    const positioned = rows
      .map((row) => numberPick(row, ['position', 'avg position', 'average position']))
      .filter((value) => value > 0);
    const avgPosition = positioned.length ? positioned.reduce((sum, value) => sum + value, 0) / positioned.length : 0;
    const queries = new Set(rows.map((row) => pick(row, ['query', 'keyword', 'search term'])).filter(Boolean));
    return { clicks, impressions, avgPosition, queries: queries.size };
  }, [rows]);
  const ctrOpportunities = useMemo(() => {
    return rows
      .map((row) => {
        const clicks = numberPick(row, ['clicks']);
        const impressions = numberPick(row, ['impressions']);
        const ctrRaw = pick(row, ['ctr', 'click through rate']);
        const ctr = ctrRaw ? Number(ctrRaw.replace('%', '')) : (impressions ? (clicks / impressions) * 100 : 0);
        return {
          query: pick(row, ['query', 'keyword', 'search term']) || '-',
          page: pick(row, ['page', 'url', 'landing page']) || '-',
          clicks,
          impressions,
          ctr,
          position: pick(row, ['position', 'avg position', 'average position']) || '-',
        };
      })
      .filter((row) => row.impressions >= 100 && row.ctr < 2.5)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 8);
  }, [rows]);

  return (
    <div className="space-y-8 animate-rise">
      <PageHeader
        eyebrow="Search data"
        icon={BarChart3}
        title="Search Console and Bing performance"
        description="View real query, page, clicks, impressions, CTR, and position data after importing CSV exports. No search volume or traffic is estimated."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Imported rows" value={rows.length} detail="From local CSV imports" icon={<BarChart3 className="h-6 w-6" />} tone="accent" />
        <MetricCard label="Queries" value={summary.queries || '-'} detail="Unique imported queries" icon={<Search className="h-6 w-6" />} tone="green" />
        <MetricCard label="Clicks" value={summary.clicks || '-'} detail={`${summary.impressions || 0} impressions`} icon={<MousePointerClick className="h-6 w-6" />} tone="green" />
        <MetricCard label="Average position" value={summary.avgPosition ? summary.avgPosition.toFixed(1) : '-'} detail="Only when provided in CSV" icon={<TrendingUp className="h-6 w-6" />} tone="yellow" />
      </div>

      {rows.length === 0 ? (
        <SurfaceCard className="grid gap-6 p-8 text-center lg:grid-cols-[0.7fr_1.3fr] lg:text-left">
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-[2rem] bg-accent/10 text-accent lg:mx-0">
            <Eye className="h-12 w-12" />
          </div>
          <div>
            <div className="flex flex-wrap justify-center gap-2 lg:justify-start">
              <StatusBadge tone="warning">CSV required</StatusBadge>
              <StatusBadge tone="accent">Verified data only</StatusBadge>
            </div>
            <h3 className="mt-4 text-2xl font-bold">No imported search data yet.</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Go to Data Sources and import a Google Search Console or Bing Webmaster Tools CSV. SEOIntel will show real rows from that file and will not estimate traffic, search volume, or rankings.
            </p>
          </div>
        </SurfaceCard>
      ) : (
        <>
          <SurfaceCard className="p-6">
            <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-xl font-bold">High-impression, low-click opportunities</h3>
                <p className="mt-1 text-sm text-muted-foreground">Rows with impressions but weak CTR. Use these for title, description, and search preview fixes.</p>
              </div>
              <StatusBadge tone="success">Real imported data</StatusBadge>
            </div>
            {ctrOpportunities.length === 0 ? (
              <div className="rounded-lg border border-border bg-muted/30 p-5 text-sm text-muted-foreground">
                No imported rows match the current opportunity rule. Import rows with clicks, impressions, CTR, and position for deeper analysis.
              </div>
            ) : (
              <div className="grid gap-3">
                {ctrOpportunities.map((row, index) => (
                  <div key={`${row.query}-${index}`} className="rounded-lg border border-border bg-background/70 p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h4 className="font-bold">{row.query}</h4>
                        <p className="mt-1 max-w-3xl truncate text-sm text-muted-foreground">{row.page}</p>
                      </div>
                      <StatusBadge tone="warning">{row.ctr.toFixed(1)}% CTR</StatusBadge>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
                      <div className="rounded-xl bg-muted/40 p-3"><span className="text-muted-foreground">Impressions</span><div className="font-bold">{row.impressions}</div></div>
                      <div className="rounded-xl bg-muted/40 p-3"><span className="text-muted-foreground">Clicks</span><div className="font-bold">{row.clicks}</div></div>
                      <div className="rounded-xl bg-muted/40 p-3"><span className="text-muted-foreground">Position</span><div className="font-bold">{row.position}</div></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SurfaceCard>

          <SurfaceCard className="overflow-hidden">
            <div className="border-b border-border bg-card px-5 py-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-xl font-bold">Imported performance rows</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Showing the first 100 rows from your local import.</p>
                </div>
                <StatusBadge tone="success">Real imported data</StatusBadge>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="suite-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>Query</th>
                    <th>Page</th>
                    <th>Clicks</th>
                    <th>Impressions</th>
                    <th>CTR</th>
                    <th>Position</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((row, index) => (
                    <tr key={index}>
                      <td className="font-semibold">{pick(row, ['query', 'keyword', 'search term']) || '-'}</td>
                      <td className="max-w-[320px] truncate text-muted-foreground">{pick(row, ['page', 'url', 'landing page']) || '-'}</td>
                      <td>{pick(row, ['clicks']) || '-'}</td>
                      <td>{pick(row, ['impressions']) || '-'}</td>
                      <td>{pick(row, ['ctr', 'click through rate']) || '-'}</td>
                      <td className="font-bold">{pick(row, ['position', 'avg position', 'average position']) || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SurfaceCard>
        </>
      )}

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-800 dark:text-amber-200">
        <AlertCircle className="mr-2 inline h-4 w-4" />
        Search data requires files exported from accounts you control. SEOIntel does not bypass search engines or scrape private data.
      </div>
    </div>
  );
}
