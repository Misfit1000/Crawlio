import React, { useCallback, useEffect, useState, useRef } from "react";
import { Database, CheckCircle2, FileSpreadsheet, Link2, Loader2, MousePointerClick, Search, Upload } from "lucide-react";
import Papa from 'papaparse';
import { Notice, PageHeader } from './ui/page-system';
import { useAuth } from '../contexts/AuthContext';
import { API_ROUTES } from '../lib/api/routes';
import { getAuthHeaders } from '../lib/api/auth-headers';
import { safeJsonFetch } from '../lib/http/safe-json';
import { inflightRead } from '../lib/http/inflight-read';
import type { ProjectOverviewResponse } from '../lib/projects/types';
import type { ImportSourceKind, ProjectDataImportSummary } from '../lib/imports/types';

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

export function parseImportCsv(file: File, signal: AbortSignal): Promise<Record<string, any>[]> {
  if (signal.aborted) return Promise.reject(new DOMException('The import was cancelled.', 'AbortError'));
  if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error('This CSV is over 10 MB. Export a smaller date range or split the file before importing.'));
  return new Promise((resolve, reject) => {
    const rows: Record<string, any>[] = [];
    let parser: Papa.Parser | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (error) { parser?.abort(); reject(error); }
      else resolve(rows);
    };
    const cancel = () => finish(new DOMException('The import was cancelled.', 'AbortError'));
    signal.addEventListener('abort', cancel, { once: true });
    // Papa's blob worker is blocked by the deployed CSP; yield between bounded file chunks.
    try {
      Papa.parse<Record<string, any>>(file, {
        header: true, skipEmptyLines: true, preview: 20_001, worker: false, chunkSize: 64 * 1024,
        chunk: (results, handle) => {
          parser = handle;
          if (settled || signal.aborted) { handle.abort(); return; }
          if (results.errors.length) { finish(new Error(results.errors[0].message)); return; }
          if (rows.length + results.data.length > 20_000) { finish(new Error('This CSV has more than 20,000 rows. Import a smaller date range to keep the workspace responsive.')); return; }
          rows.push(...results.data);
          handle.pause();
          timer = setTimeout(() => { if (!settled && !signal.aborted) handle.resume(); }, 0);
        },
        complete: () => { if (!signal.aborted) finish(); },
        error: error => finish(error),
      });
    } catch (error) { finish(error instanceof Error ? error : new Error('This CSV could not be parsed.')); }
  });
}

export default function Imports() {
  const { user } = useAuth();
  const accountId = user?.id || 'guest';
  return <AccountImports key={accountId} accountId={accountId} signedIn={Boolean(user)} />;
}

function AccountImports({ accountId, signedIn: user }: { accountId: string; signedIn: boolean }) {
  const [keywordData, setKeywordData] = useState<any[]>([]);
  const [backlinkData, setBacklinkData] = useState<any[]>([]);
  const [gscData, setGscData] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [remoteImports, setRemoteImports] = useState<ProjectDataImportSummary[]>([]);
  const [projects, setProjects] = useState<ProjectOverviewResponse['projects']>([]);
  const [projectId, setProjectId] = useState('');
  const [syncing, setSyncing] = useState<ImportSourceKind | 'loading' | null>(null);
  const [remoteError, setRemoteError] = useState('');
  const [parsing, setParsing] = useState<ImportSourceKind[]>([]);
  const reads = useRef(new Map<string, AbortController>());
  const selectedProject = useRef(projectId);
  selectedProject.current = projectId;
  const selectionInitialized = useRef(false);
  const remoteLoaded = useRef(false);
  const kwFileRef = useRef<HTMLInputElement>(null);
  const blFileRef = useRef<HTMLInputElement>(null);
  const gscFileRef = useRef<HTMLInputElement>(null);

  const begin = useCallback((key: string) => {
    reads.current.get(key)?.abort();
    const controller = new AbortController();
    reads.current.set(key, controller);
    return controller;
  }, []);
  const isCurrent = useCallback((key: string, controller: AbortController) => reads.current.get(key) === controller && !controller.signal.aborted, []);
  const finish = useCallback((key: string, controller: AbortController) => { if (reads.current.get(key) === controller) reads.current.delete(key); }, []);
  useEffect(() => () => { reads.current.forEach(controller => controller.abort()); reads.current.clear(); }, []);

  useEffect(() => {
    try {
      const owner = localStorage.getItem('crawlio_import_owner') || 'guest';
      if (owner !== accountId) ['seo_gsc_data', 'seo_keyword_data', 'seo_backlink_data'].forEach(key => localStorage.removeItem(key));
      localStorage.setItem('crawlio_import_owner', accountId);
    } catch { return; }
    const loadStored = (key: string, setter: (rows: any[]) => void) => {
      try {
        const stored = localStorage.getItem(key);
        const rows = stored ? JSON.parse(stored) : [];
        setter(Array.isArray(rows) ? rows.slice(0, 20_000) : []);
      } catch {
        setter([]);
      }
    };
    loadStored('seo_gsc_data', setGscData);
    loadStored('seo_keyword_data', setKeywordData);
    loadStored('seo_backlink_data', setBacklinkData);
  }, [accountId]);

  const refreshRemote = useCallback(async () => {
    if (!user) return;
    const controller = begin('remote');
    setSyncing('loading');
    try {
      const headers = await getAuthHeaders();
      if (!isCurrent('remote', controller)) return;
      const read = (url: string) => inflightRead(url, headers, signal => safeJsonFetch<any>(url, { headers, credentials: 'same-origin', signal }), controller.signal);
      const [importsResponse, projectsResponse] = await Promise.all([read(API_ROUTES.imports), read(API_ROUTES.projectsOverview)]);
      if (!isCurrent('remote', controller)) return;
      const errors: string[] = [];
      if (importsResponse.success === true) setRemoteImports(importsResponse.data.data?.imports || importsResponse.data.imports || []);
      else errors.push(importsResponse.error);
      if (projectsResponse.success === true) {
        const next = (projectsResponse.data.data || projectsResponse.data) as ProjectOverviewResponse;
        const tracked = next.projects.filter(project => project.id);
        setProjects(tracked);
        const initialized = selectionInitialized.current;
        selectionInitialized.current = true;
        setProjectId(current => initialized ? tracked.some(project => project.id === current) ? current : '' : tracked[0]?.id || '');
      } else errors.push(projectsResponse.error);
      setRemoteError(errors.length ? `${remoteLoaded.current ? 'Refresh failed; previous account data may be stale. ' : ''}${errors.join(' ')}` : '');
      remoteLoaded.current = remoteLoaded.current || importsResponse.success || projectsResponse.success;
    } catch (nextError) {
      if (isCurrent('remote', controller) && !(nextError instanceof Error && nextError.name === 'AbortError')) setRemoteError(`Account data could not load; previous data may be stale. ${nextError instanceof Error ? nextError.message : ''}`);
    } finally {
      if (isCurrent('remote', controller)) { finish('remote', controller); setSyncing(current => current === 'loading' ? null : current); }
    }
  }, [user, begin, isCurrent, finish]);

  useEffect(() => { void refreshRemote(); }, [refreshRemote]);

  const syncImport = async (sourceKind: ImportSourceKind, fileName: string, rows: any[], controller: AbortController, targetProject: string) => {
    if (!user) {
      setSyncMessage('Saved on this device. Sign in before importing to sync data across devices.');
      return;
    }
    if (rows.length > 5_000) {
      setSyncMessage('The full import is available on this device. Account sync stores up to 5,000 rows; use a smaller export to sync it.');
      return;
    }
    setSyncing(sourceKind);
    const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
    if (!isCurrent(`source:${sourceKind}`, controller) || selectedProject.current !== targetProject) return;
    const response = await safeJsonFetch<any>(API_ROUTES.imports, {
      method: 'POST',
      headers, signal: controller.signal,
      credentials: 'same-origin',
      body: JSON.stringify({ sourceKind, fileName, projectId: targetProject || null, rows }),
    });
    if (!isCurrent(`source:${sourceKind}`, controller) || selectedProject.current !== targetProject) return;
    if (response.success === false) setSyncMessage(`Saved on this device, but account sync failed: ${response.error}`);
    else {
      setSyncMessage(`Saved ${rows.length.toLocaleString()} rows to your account${targetProject ? ' and selected project' : ''}.`);
      await refreshRemote();
    }
  };

  const handleCsv = (e: React.ChangeEvent<HTMLInputElement>, setter: (rows: any[]) => void, storageKey: string, sourceKind: ImportSourceKind) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const key = `source:${sourceKind}`;
    const controller = begin(key);
    const targetProject = selectedProject.current;
    setParsing(current => [...current.filter(kind => kind !== sourceKind), sourceKind]);
    setSyncMessage(null);
    void (async () => {
      try {
        const rows = await parseImportCsv(file, controller.signal);
        if (!isCurrent(key, controller) || selectedProject.current !== targetProject) return;
        try { localStorage.setItem(storageKey, JSON.stringify(rows)); }
        catch { throw new Error('The browser could not store this CSV. Clear older imports or use a smaller export. Your previous data was kept.'); }
        setter(rows); setError(null);
        setParsing(current => current.filter(kind => kind !== sourceKind));
        await syncImport(sourceKind, file.name, rows, controller, targetProject);
      } catch (nextError) {
        if (isCurrent(key, controller) && !(nextError instanceof Error && nextError.name === 'AbortError')) setError(nextError instanceof Error ? nextError.message : 'This CSV could not be parsed. Your previous data was kept.');
      } finally {
        if (isCurrent(key, controller)) { finish(key, controller); setParsing(current => current.filter(kind => kind !== sourceKind)); setSyncing(current => current === sourceKind ? null : current); }
      }
    })();
  };

  const latestRemote = (sourceKind: ImportSourceKind) => remoteImports.find((item) => (
    item.sourceKind === sourceKind
    && (projectId ? item.projectId === projectId : item.projectId === null)
  ));
  const loadSynced = async (sourceKind: ImportSourceKind, setter: (rows: any[]) => void, storageKey: string) => {
    const batch = latestRemote(sourceKind);
    if (!batch) return;
    const key = `source:${sourceKind}`;
    const controller = begin(key);
    const targetProject = selectedProject.current;
    setParsing(current => current.filter(kind => kind !== sourceKind));
    setSyncing(sourceKind);
    try {
      const headers = await getAuthHeaders();
      if (!isCurrent(key, controller)) return;
      const url = API_ROUTES.importRows(batch.id);
      const response = await inflightRead(url, headers, signal => safeJsonFetch<any>(url, { headers, credentials: 'same-origin', signal }), controller.signal);
      if (!isCurrent(key, controller) || selectedProject.current !== targetProject) return;
      if (response.success === false) throw new Error(response.error);
      const rows = response.data.data?.rows || response.data.rows || [];
      localStorage.setItem(storageKey, JSON.stringify(rows));
      setter(rows); setError(null);
      setSyncMessage(`Loaded ${rows.length.toLocaleString()} synced rows from ${batch.fileName}.`);
    } catch (nextError) {
      if (isCurrent(key, controller) && !(nextError instanceof Error && nextError.name === 'AbortError')) setError(`Synced import could not be loaded; previous device data was kept. ${nextError instanceof Error ? nextError.message : ''}`);
    } finally {
      if (isCurrent(key, controller)) { finish(key, controller); setSyncing(current => current === sourceKind ? null : current); }
    }
  };

  const changeProject = (value: string) => {
    selectedProject.current = value;
    selectionInitialized.current = true;
    reads.current.forEach((controller, key) => { if (key.startsWith('source:')) { controller.abort(); reads.current.delete(key); } });
    setProjectId(value); setParsing([]); setSyncing(current => current === 'loading' ? current : null); setSyncMessage(null); setError(null);
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
      <PageHeader eyebrow="Data sources" icon={Database} title="Import real SEO data" description="Load search-performance, keyword-position, or backlink CSV exports. Imports stay on this device for guests and can sync to the selected project when you are signed in." />
      <Notice tone="info" title="First-party and user-provided data only">Google Search Console and Bing data works only for sites you can verify or export. Crawlio does not invent search volume, rankings, traffic, backlinks, or authority metrics.</Notice>

      {error && <Notice tone="danger" title="Import failed">{error}</Notice>}
      {remoteError && <Notice tone="danger" title="Account data unavailable">{remoteError}</Notice>}
      {parsing.length > 0 && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Parsing CSV...</p>}
      {syncMessage && <Notice tone={syncMessage.includes('failed') ? 'warning' : 'success'} title="Import storage">{syncMessage}</Notice>}
      {user && <div className="trust-card flex flex-col gap-3 p-5 sm:flex-row sm:items-end sm:justify-between"><div><label htmlFor="import-project" className="text-sm font-semibold">Save imports to a project</label><p className="mt-1 text-xs text-muted-foreground">Synced imports are private to your account and expire after one year.</p></div><select id="import-project" className="suite-input max-w-sm" value={projectId} onChange={(event) => changeProject(event.target.value)}><option value="">Account library only</option>{projects.map((project) => <option key={project.id} value={project.id || ''}>{project.name}</option>)}</select></div>}

      <section aria-label="CSV import sources" className="grid grid-cols-1 gap-4 lg:grid-cols-3">

        {/* GSC Import */}
        <div className="trust-card flex min-w-0 flex-col p-6">
          <FileSpreadsheet className="h-7 w-7 text-accent" aria-hidden="true" />
          <h2 className="mt-5 text-lg font-semibold">Search performance</h2>
          <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">Queries and pages from your Google Search Console or Bing export.</p>
          <input type="file" accept=".csv" className="hidden" ref={gscFileRef} onChange={e => handleCsv(e, setGscData, 'seo_gsc_data', 'search_performance')} />
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <span className="text-sm font-medium text-muted-foreground">{gscData.length ? <><CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-600" />{gscData.length.toLocaleString()} rows</> : 'No import yet'}</span>
            <button type="button" onClick={() => gscFileRef.current?.click()} className="quiet-button"><Upload className="h-4 w-4" />{gscData.length ? 'Replace CSV' : 'Import CSV'}</button>
          </div>
          {latestRemote('search_performance') && <button type="button" className="mt-3 text-left text-xs font-semibold text-accent hover:underline" onClick={() => void loadSynced('search_performance', setGscData, 'seo_gsc_data')} disabled={syncing === 'search_performance'}>{syncing === 'search_performance' ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}Load latest synced import</button>}
        </div>

        {/* Keywords Import */}
        <div className="trust-card flex min-w-0 flex-col p-6">
          <Search className="h-7 w-7 text-accent" aria-hidden="true" />
          <h2 className="mt-5 text-lg font-semibold">Keyword positions</h2>
          <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">Your keyword planner or ranking snapshot. Positions are shown only when present in the file.</p>
          <input type="file" accept=".csv" className="hidden" ref={kwFileRef} onChange={e => handleCsv(e, setKeywordData, 'seo_keyword_data', 'keyword_positions')} />
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <span className="text-sm font-medium text-muted-foreground">{keywordData.length ? <><CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-600" />{keywordData.length.toLocaleString()} rows</> : 'No import yet'}</span>
            <button type="button" onClick={() => kwFileRef.current?.click()} className="quiet-button"><Upload className="h-4 w-4" />{keywordData.length ? 'Replace CSV' : 'Import CSV'}</button>
          </div>
          {latestRemote('keyword_positions') && <button type="button" className="mt-3 text-left text-xs font-semibold text-accent hover:underline" onClick={() => void loadSynced('keyword_positions', setKeywordData, 'seo_keyword_data')} disabled={syncing === 'keyword_positions'}>{syncing === 'keyword_positions' ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}Load latest synced import</button>}
        </div>

        {/* Backlinks Import */}
        <div className="trust-card flex min-w-0 flex-col p-6">
          <Link2 className="h-7 w-7 text-accent" aria-hidden="true" />
          <h2 className="mt-5 text-lg font-semibold">Backlink evidence</h2>
          <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">Source pages, targets, and anchors from a backlink export you provide.</p>
          <input type="file" accept=".csv" className="hidden" ref={blFileRef} onChange={e => handleCsv(e, setBacklinkData, 'seo_backlink_data', 'backlink_evidence')} />
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <span className="text-sm font-medium text-muted-foreground">{backlinkData.length ? <><CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-600" />{backlinkData.length.toLocaleString()} rows</> : 'No import yet'}</span>
            <button type="button" onClick={() => blFileRef.current?.click()} className="quiet-button"><Upload className="h-4 w-4" />{backlinkData.length ? 'Replace CSV' : 'Import CSV'}</button>
          </div>
          {latestRemote('backlink_evidence') && <button type="button" className="mt-3 text-left text-xs font-semibold text-accent hover:underline" onClick={() => void loadSynced('backlink_evidence', setBacklinkData, 'seo_backlink_data')} disabled={syncing === 'backlink_evidence'}>{syncing === 'backlink_evidence' ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}Load latest synced import</button>}
        </div>
      </section>

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
