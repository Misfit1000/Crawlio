import React, { useEffect, useState, useRef } from "react";
import { Upload, Database, CheckCircle2, AlertTriangle, FileSpreadsheet } from "lucide-react";
import Papa from 'papaparse';

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

  return (
    <div className="space-y-8 animate-rise">
      <div>
        <div className="suite-chip mb-3 text-accent">Data sources</div>
        <h1 className="text-3xl font-bold font-display md:text-4xl">Import real SEO data</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">Load CSV files containing real performance, keyword, ranking, or backlink data. Imported rows stay local to this browser unless you export or save them elsewhere.</p>
        <div className="mt-5 rounded-2xl border border-border bg-muted/50 p-4 text-sm leading-6">
          <strong>Free Real Data Alternatives:</strong> Instead of paying for expensive third-party APIs, SEOIntel relies on your own first-party data. Import <strong>Google Search Console (GSC)</strong> data, <strong>Bing Webmaster Tools</strong> CSVs, or public discovery sources like <strong>Common Crawl</strong>. Note: GSC/Bing data only works for verified/imported sites. No fake data is generated.
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 text-red-500 rounded-xl flex gap-2">
          <AlertTriangle className="w-5 h-5"/> {error}
        </div>
      )}

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
        </div>
      )}
    </div>
  );
}
