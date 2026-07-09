import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, FileSpreadsheet, Search, Upload } from 'lucide-react';
import Papa from 'papaparse';
import { MetricCard, SectionHeader, StatusBadge, SurfaceCard } from './ui/visual-system';

type RankRow = {
  keyword: string;
  url: string;
  position: number | null;
  clicks: number | null;
  impressions: number | null;
  date: string;
  source: string;
};

const STORAGE_KEY = 'seo_rank_data';
const FALLBACK_GSC_KEY = 'seo_gsc_data';

function firstValue(row: Record<string, any>, names: string[]) {
  const entries = Object.entries(row);
  for (const name of names) {
    const found = entries.find(([key]) => key.trim().toLowerCase() === name);
    if (found && found[1] !== undefined && found[1] !== null && String(found[1]).trim() !== '') return String(found[1]).trim();
  }
  return '';
}

function numericValue(row: Record<string, any>, names: string[]) {
  const raw = firstValue(row, names);
  if (!raw) return null;
  const parsed = Number(String(raw).replace(/[%,$]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRows(rows: any[], source: string): RankRow[] {
  return rows
    .map((row) => {
      const keyword = firstValue(row, ['keyword', 'query', 'search term', 'search query']);
      const url = firstValue(row, ['url', 'page', 'landing page', 'target url']);
      const position = numericValue(row, ['position', 'avg position', 'average position', 'average_position', 'rank']);
      return {
        keyword,
        url,
        position,
        clicks: numericValue(row, ['clicks']),
        impressions: numericValue(row, ['impressions']),
        date: firstValue(row, ['date', 'day', 'month']) || 'Imported',
        source,
      };
    })
    .filter((row) => row.keyword || row.url || row.position !== null);
}

export default function RankTracker() {
  const [rows, setRows] = useState<RankRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const storedRanks = localStorage.getItem(STORAGE_KEY);
      if (storedRanks) {
        setRows(normalizeRows(JSON.parse(storedRanks), 'Rankings CSV'));
        return;
      }
      const storedGsc = localStorage.getItem(FALLBACK_GSC_KEY);
      if (storedGsc) {
        setRows(normalizeRows(JSON.parse(storedGsc), 'Search Console import'));
      }
    } catch {
      setRows([]);
    }
  }, []);

  const summary = useMemo(() => {
    const positioned = rows.filter((row) => row.position !== null);
    const keywords = new Set(rows.map((row) => row.keyword).filter(Boolean));
    const avgPosition = positioned.length
      ? positioned.reduce((sum, row) => sum + Number(row.position), 0) / positioned.length
      : null;
    const totalClicks = rows.reduce((sum, row) => sum + (row.clicks || 0), 0);
    const totalImpressions = rows.reduce((sum, row) => sum + (row.impressions || 0), 0);
    return { positioned: positioned.length, keywords: keywords.size, avgPosition, totalClicks, totalImpressions };
  }, [rows]);

  const chartRows = rows
    .filter((row) => row.position !== null)
    .sort((a, b) => Number(a.position) - Number(b.position))
    .slice(0, 8);

  const handleCsv = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          setError(results.errors[0].message);
          return;
        }
        const normalized = normalizeRows(results.data, 'Rankings CSV');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(results.data));
        setRows(normalized);
        setError(null);
      },
    });
  };

  return (
    <div className="space-y-8 animate-rise">
      <SectionHeader
        eyebrow="Rankings data"
        title="Actual SERP positions from your imported data"
        description="Import Google Search Console, Bing Webmaster Tools, or provider CSV exports. SEOIntel does not scrape Google results or invent ranking rows."
        action={
          <button type="button" onClick={() => fileRef.current?.click()} className="trust-button">
            <Upload className="h-4 w-4" /> Import rankings CSV
          </button>
        }
      />

      <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCsv} />

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm font-semibold text-red-600 dark:text-red-300">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Imported rows" value={rows.length} detail="Only real imported data" icon={<FileSpreadsheet className="h-6 w-6" />} tone="accent" />
        <MetricCard label="Keywords found" value={summary.keywords} detail="Unique queries/keywords" icon={<Search className="h-6 w-6" />} tone="green" />
        <MetricCard label="Average position" value={summary.avgPosition === null ? '-' : summary.avgPosition.toFixed(1)} detail={`${summary.positioned} rows with positions`} icon={<BarChart3 className="h-6 w-6" />} tone="yellow" />
        <MetricCard label="Clicks" value={summary.totalClicks || '-'} detail={`${summary.totalImpressions || 0} impressions`} icon={<CheckCircle2 className="h-6 w-6" />} tone="green" />
      </div>

      {rows.length === 0 ? (
        <SurfaceCard className="grid gap-6 p-6 lg:grid-cols-[0.7fr_1.3fr] lg:items-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-[2rem] bg-accent/10 text-accent">
            <BarChart3 className="h-12 w-12" />
          </div>
          <div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="warning">Import required</StatusBadge>
              <StatusBadge tone="accent">No fake rankings</StatusBadge>
            </div>
            <h3 className="mt-4 text-2xl font-bold">Connect real ranking data to see SERP movement.</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Export query or ranking rows from a verified source, then upload the CSV here. Supported headers include keyword/query, URL/page, position/average position, clicks, impressions, and date.
            </p>
            <button type="button" onClick={() => fileRef.current?.click()} className="mt-5 trust-button">
              <Upload className="h-4 w-4" /> Import CSV
            </button>
          </div>
        </SurfaceCard>
      ) : (
        <>
          <SurfaceCard className="p-6">
            <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-xl font-bold">Best visible positions</h3>
                <p className="text-sm text-muted-foreground">Lower bars are better because position 1 is the top result.</p>
              </div>
              <StatusBadge tone="success">Real imported rows</StatusBadge>
            </div>
            <div className="grid gap-3">
              {chartRows.map((row, index) => {
                const position = Math.max(1, Number(row.position || 100));
                const width = Math.max(8, 100 - Math.min(position, 100));
                return (
                  <div key={`${row.keyword}-${row.url}-${index}`} className="grid gap-2 md:grid-cols-[220px_1fr_72px] md:items-center">
                    <div className="truncate text-sm font-bold">{row.keyword || row.url || 'Imported row'}</div>
                    <div className="h-3 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-accent" style={{ width: `${width}%` }} />
                    </div>
                    <div className="text-sm font-black text-accent">#{position.toFixed(1)}</div>
                  </div>
                );
              })}
            </div>
          </SurfaceCard>

          <SurfaceCard className="overflow-hidden">
            <div className="border-b border-border bg-card px-5 py-4">
              <h3 className="text-xl font-bold">Imported ranking rows</h3>
              <p className="mt-1 text-sm text-muted-foreground">Rendered from your CSV data. Nothing here is estimated by SEOIntel.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="suite-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th>URL</th>
                    <th>Position</th>
                    <th>Clicks</th>
                    <th>Impressions</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((row, index) => (
                    <tr key={`${row.keyword}-${row.url}-${index}`}>
                      <td className="font-semibold">{row.keyword || '-'}</td>
                      <td className="max-w-[320px] truncate text-muted-foreground">{row.url || '-'}</td>
                      <td className="font-bold">{row.position === null ? '-' : row.position}</td>
                      <td>{row.clicks ?? '-'}</td>
                      <td>{row.impressions ?? '-'}</td>
                      <td><StatusBadge tone="accent">{row.source}</StatusBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SurfaceCard>
        </>
      )}
    </div>
  );
}
