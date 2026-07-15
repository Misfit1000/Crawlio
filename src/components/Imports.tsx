import React, { useEffect, useState, useRef } from "react";
import { Database, CheckCircle2, AlertTriangle, FileSpreadsheet, Link2, MousePointerClick, Search } from "lucide-react";
import Papa from 'papaparse';
import { Notice, PageHeader } from './ui/page-system';

function pick(row: Record<string, any>, names: string[]) {
  const entries = Object.entries(row || {});
  for (const name of names) {
    const found = entries.find(([key]) => key.trim().toLowerCase() === name);
    if (found && found[1] !== undefined && found[1] !== null && String(found[1]).trim() !== '') return String(found[1]).trim();
  }
  return '';
}

function sumRows(rows: any[], names: string[]) {
  return rows.reduce((sum, row) => {
    const value = Number(pick(row, names).replace(/[%,$]/g, ''));
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

export default function Imports() {
  const [keywordData, setKeywordData] = useState<any[]>([]);
  const [backlinkData, setBacklinkData] = useState<any[]>([]);
  const [gscData, setGscData] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const kwFileRef = useRef<HTMLInputElement>(null);
  const blFileRef = useRef<HTMLInputElement>(null);
  const gscFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadStored = (key: string, setter: (rows: any[]) => void) => {
      try {
        const stored = localStorage.getItem(key);
        if (stored) setter(JSON.parse(stored));
      } catch {
        setter([]);
      }
    };
    loadStored('seo_gsc_data', setGscData);
    loadStored('seo_keyword_data', setKeywordData);
    loadStored('seo_backlink_data', setBacklinkData);
  }, []);

  const handleCsv = (e: React.ChangeEvent<HTMLInputElement>, setter: any, storageKey: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          setError(results.errors[0].message);
        } else {
          setter(results.data);
          localStorage.setItem(storageKey, JSON.stringify(results.data));
          setError(null);
        }
      }
    });
  };

  const gscClicks = sumRows(gscData, ['clicks']);
  const gscImpressions = sumRows(gscData, ['impressions']);
  const backlinkDomains = new Set(backlinkData.map((row) => {
    try {
      const url = pick(row, ['source url', 'source', 'referring page', 'from', 'url']);
      return url ? new URL(url).hostname : '';
    } catch {
      return pick(row, ['domain', 'referring domain']);
    }
  }).filter(Boolean)).size;
  const backlinkTargets = new Set(backlinkData.map((row) => pick(row, ['target url', 'target', 'to', 'landing page'])).filter(Boolean)).size;

  return (
    <div className="space-y-9 animate-rise">
      <PageHeader eyebrow="Data sources" icon={Database} title="Import real SEO data" description="Load your own search-performance, keyword-position, or backlink CSV exports. Imported rows stay in this browser unless you deliberately export them." />
      <Notice tone="info" title="First-party and user-provided data only">Google Search Console and Bing data works only for sites you can verify or export. Crawlio does not invent search volume, rankings, traffic, backlinks, or authority metrics.</Notice>

      {error && <Notice tone="danger" title="Import failed">{error}</Notice>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">

        {/* GSC Import */}
        <div className="trust-card p-6 text-center space-y-4">
          <FileSpreadsheet className="w-8 h-8 mx-auto text-accent" />
          <h3 className="font-bold text-lg font-display">GSC / Bing Import</h3>
          <p className="text-sm text-muted-foreground">Import Query or Page performance CSVs from Search Console.</p>
          <input type="file" accept=".csv" className="hidden" ref={gscFileRef} onChange={e => handleCsv(e, setGscData, 'seo_gsc_data')} />
          {gscData.length > 0 ? (
            <div className="text-green-500 flex flex-col items-center gap-2">
              <CheckCircle2 className="w-6 h-6" />
              <p className="text-sm font-medium">{gscData.length} rows imported</p>
            </div>
          ) : (
            <button onClick={() => gscFileRef.current?.click()} className="quiet-button w-full">
              Select CSV File
            </button>
          )}
        </div>

        {/* Keywords Import */}
        <div className="trust-card p-6 text-center space-y-4">
          <Database className="w-8 h-8 mx-auto text-accent" />
          <h3 className="font-bold text-lg font-display">Keyword Metrics CSV</h3>
          <p className="text-sm text-muted-foreground">Import Google Keyword Planner or Rank snapshot CSVs.</p>
          <input type="file" accept=".csv" className="hidden" ref={kwFileRef} onChange={e => handleCsv(e, setKeywordData, 'seo_keyword_data')} />
          {keywordData.length > 0 ? (
            <div className="text-green-500 flex flex-col items-center gap-2">
              <CheckCircle2 className="w-6 h-6" />
              <p className="text-sm font-medium">{keywordData.length} rows imported</p>
            </div>
          ) : (
            <button onClick={() => kwFileRef.current?.click()} className="quiet-button w-full">
              Select CSV File
            </button>
          )}
        </div>

        {/* Backlinks Import */}
        <div className="trust-card p-6 text-center space-y-4">
          <Database className="w-8 h-8 mx-auto text-accent" />
          <h3 className="font-bold text-lg font-display">Backlinks CSV</h3>
          <p className="text-sm text-muted-foreground">Import links from Common Crawl or Generic SEO CSV.</p>
          <input type="file" accept=".csv" className="hidden" ref={blFileRef} onChange={e => handleCsv(e, setBacklinkData, 'seo_backlink_data')} />
          {backlinkData.length > 0 ? (
            <div className="text-green-500 flex flex-col items-center gap-2">
              <CheckCircle2 className="w-6 h-6" />
              <p className="text-sm font-medium">{backlinkData.length} rows imported</p>
            </div>
          ) : (
            <button onClick={() => blFileRef.current?.click()} className="quiet-button w-full">
              Select CSV File
            </button>
          )}
        </div>
      </div>

      {(keywordData.length > 0 || backlinkData.length > 0 || gscData.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="trust-card p-5">
            <MousePointerClick className="mb-3 h-6 w-6 text-accent" />
            <div className="text-sm text-muted-foreground">Imported clicks</div>
            <div className="text-3xl font-bold">{gscClicks || '-'}</div>
            <div className="mt-1 text-xs text-muted-foreground">{gscImpressions || 0} impressions</div>
          </div>
          <div className="trust-card p-5">
            <Search className="mb-3 h-6 w-6 text-accent" />
            <div className="text-sm text-muted-foreground">Keyword rows</div>
            <div className="text-3xl font-bold">{keywordData.length || '-'}</div>
            <div className="mt-1 text-xs text-muted-foreground">Planner, rank, or custom CSV</div>
          </div>
          <div className="trust-card p-5">
            <Link2 className="mb-3 h-6 w-6 text-accent" />
            <div className="text-sm text-muted-foreground">Backlink rows</div>
            <div className="text-3xl font-bold">{backlinkData.length || '-'}</div>
            <div className="mt-1 text-xs text-muted-foreground">{backlinkDomains || 0} source domains</div>
          </div>
          <div className="trust-card p-5">
            <Database className="mb-3 h-6 w-6 text-accent" />
            <div className="text-sm text-muted-foreground">Linked pages</div>
            <div className="text-3xl font-bold">{backlinkTargets || '-'}</div>
            <div className="mt-1 text-xs text-muted-foreground">From imported backlink CSV</div>
          </div>
        </div>
      )}

      {(keywordData.length > 0 || backlinkData.length > 0 || gscData.length > 0) && (
        <div className="trust-card mt-6 overflow-x-auto p-6">
          <h3 className="font-bold mb-4 font-display">Data Preview</h3>

          {gscData.length > 0 && (
            <div className="mb-8">
              <h4 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Search Console Data</h4>
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    {Object.keys(gscData[0] || {}).slice(0, 5).map(k => <th key={k} className="p-3 font-medium">{k}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {gscData.slice(0, 5).map((row, i) => (
                    <tr key={i} className="hover:bg-muted/20">
                      {Object.keys(gscData[0] || {}).slice(0, 5).map(k => <td key={k} className="p-3 truncate max-w-[200px]">{row[k] || '-'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {keywordData.length > 0 && (
            <div className="mb-8">
              <h4 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Imported Keywords Data</h4>
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="p-3 font-medium">Keyword</th>
                    <th className="p-3 font-medium">Volume</th>
                    <th className="p-3 font-medium">CPC</th>
                    <th className="p-3 font-medium">Difficulty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {keywordData.slice(0, 5).map((row, i) => (
                    <tr key={i} className="hover:bg-muted/20">
                      <td className="p-3 font-medium">{row.keyword || '-'}</td>
                      <td className="p-3">{row.volume || '-'}</td>
                      <td className="p-3">{row.cpc || '-'}</td>
                      <td className="p-3">
                        {row.difficulty ? <span className="px-2 py-1 bg-muted rounded-md text-xs">{row.difficulty}</span> : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {backlinkData.length > 0 && (
            <div className="mb-2">
              <h4 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Imported Backlink Data</h4>
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="p-3 font-medium">Source</th>
                    <th className="p-3 font-medium">Target</th>
                    <th className="p-3 font-medium">Anchor</th>
                    <th className="p-3 font-medium">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {backlinkData.slice(0, 8).map((row, i) => (
                    <tr key={i} className="hover:bg-muted/20">
                      <td className="p-3 max-w-[260px] truncate">{pick(row, ['source url', 'source', 'referring page', 'from', 'url', 'domain', 'referring domain']) || '-'}</td>
                      <td className="p-3 max-w-[260px] truncate">{pick(row, ['target url', 'target', 'to', 'landing page']) || '-'}</td>
                      <td className="p-3 max-w-[180px] truncate">{pick(row, ['anchor', 'anchor text', 'link text']) || '-'}</td>
                      <td className="p-3">{pick(row, ['type', 'rel', 'follow']) || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
