import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Waypoints } from 'lucide-react';
import type { ResourceAuditPage, ResourceAuditIssue, ResourceAuditDocument } from '../../lib/audit/resource-types';
import { isTerminalAuditStatus } from '../../lib/audit/audit-time';

export function AuditPageMap({ pages, issues, audit }: { pages: ResourceAuditPage[]; issues: ResourceAuditIssue[]; audit?: ResourceAuditDocument }) {
  const container = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let intersecting = false;
    const update = () => setVisible(intersecting && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; update(); });
    if (container.current) observer.observe(container.current);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  const active = Boolean(audit && audit.status === 'running' && visible && !paused);
  const analysed = audit?.pagesCrawled ?? pages.filter((page) => page.fetchStatus === 'success' || page.statusCode >= 200 && page.statusCode < 300).length;
  const limit = audit?.pageLimit ?? pages.length;
  const coverage = limit ? Math.min(100, Math.round(analysed / limit * 100)) : 0;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = pages.find((page) => page.id === selectedId) ?? pages[0];
  const groups = useMemo(() => {
    const depths = new Map<number, ResourceAuditPage[]>();
    for (const page of pages) {
      const depth = Math.max(0, page.crawlDepth || 0);
      depths.set(depth, [...(depths.get(depth) ?? []), page]);
    }
    return [...depths.entries()].sort(([a], [b]) => a - b);
  }, [pages]);
  const findings = selected ? issues.filter((issue) => issue.affectedUrl === selected.url) : [];
  return <section ref={container} className="suite-panel overflow-hidden audit-evidence-map" data-active={active} aria-labelledby="page-map-heading">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><div><h2 id="page-map-heading" className="flex items-center gap-2 text-lg font-semibold"><Waypoints className="h-5 w-5 text-accent" />Your website, page by page</h2><p className="mt-1 text-xs text-muted-foreground">Collected pages grouped by crawl depth. Select a page to inspect its evidence.</p></div><span className="text-sm tabular-nums">{pages.length} pages in view</span></header>
    {audit && <div className="audit-journey border-b border-border p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase text-accent">{isTerminalAuditStatus(audit.status) ? 'Collected evidence' : audit.status === 'queued' ? 'Waiting for the audit engine' : 'Your audit in motion'}</p><p className="mt-1 break-words text-sm text-muted-foreground">{audit.currentPhase || 'Preparing audit'}</p></div>{audit.status === 'running' && <button type="button" className="quiet-button min-h-10 text-xs" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? 'Resume animation' : 'Pause animation'}</button>}</div>
      <ol className="audit-journey-stages">
        {[{ label: 'Discovered', value: audit.pagesDiscovered, detail: 'URLs found', color: 'var(--accent)' }, { label: 'Analysed', value: analysed, detail: 'Pages with evidence', color: 'var(--success)' }, { label: 'Findings', value: audit.issuesFound, detail: 'Recorded observations', color: 'var(--warning)' }].map((stage, index) => <li key={stage.label} className="audit-journey-stage" style={{ '--stage-color': stage.color } as React.CSSProperties}><span className="audit-journey-step" aria-hidden="true">0{index + 1}</span><div><h3 className="text-sm font-semibold">{stage.label}</h3><div className="my-2 text-4xl font-semibold tabular-nums">{stage.value.toLocaleString()}</div><p className="text-xs text-muted-foreground">{stage.detail}</p></div></li>)}
      </ol>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-semibold">Page coverage</span><span className="tabular-nums text-muted-foreground">{analysed} / {limit} allowance · {coverage}%</span></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Analysed page coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coverage}><div className="h-full origin-left rounded-full bg-accent transition-transform duration-500" style={{ transform: `scaleX(${coverage / 100})` }} /></div>
      <p className="mt-5 text-xs font-semibold text-muted-foreground">Recent pages</p>
      <div className="mt-2 flex items-end gap-1 overflow-x-auto" role="group" aria-label="Recent page findings">{pages.slice(-24).map((page) => <button type="button" key={page.id} onClick={() => setSelectedId(page.id)} aria-pressed={selected?.id === page.id} aria-label={`${page.title || page.url}: ${page.issueCount} findings${page.fetchStatus === 'failed' ? ', fetch failed' : ''}`} title={`${page.url}: ${page.issueCount} findings`} className="flex h-14 min-w-8 flex-1 items-end rounded-sm p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" style={{ background: selected?.id === page.id ? 'var(--border)' : undefined }}><span aria-hidden="true" className="audit-evidence-column" style={{ height: `${12 + Math.min(36, page.issueCount * 2)}px`, background: page.statusCode >= 400 || page.fetchStatus === 'failed' ? 'var(--danger)' : page.issueCount ? 'var(--warning)' : 'var(--success)' }} /></button>)}{!pages.length && <span className="text-xs text-muted-foreground">Waiting for the first page</span>}</div>
      <p className="mt-3 text-xs text-muted-foreground">{audit.checksCompleted.toLocaleString()} checks completed. Bar height shows findings per recent page; select a page below for details.</p>
    </div>}
    <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]">
      <div className="page-map-depths min-w-0 space-y-6 overflow-y-auto p-5">
        {!pages.length && <p className="py-8 text-sm text-muted-foreground">The first analyzed page will appear here. No page evidence has arrived yet.</p>}
        {groups.map(([depth, items]) => <div key={depth} className="page-map-depth"><h3 className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground"><span className="page-map-depth-marker" aria-hidden="true" /> Depth {depth} <span className="tabular-nums">{items.length} page{items.length === 1 ? '' : 's'}</span></h3><div className="flex flex-wrap gap-2">{items.map((page) => <button key={page.id} type="button" aria-pressed={selected?.id === page.id} onClick={() => setSelectedId(page.id)} title={page.url} className={`page-map-node flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border px-3 text-sm ${selected?.id === page.id ? 'border-accent bg-accent text-accent-foreground' : 'border-border bg-card hover:border-accent'}`}><FileText className="h-4 w-4 shrink-0" /><span className="max-w-36 truncate">{page.title || page.url}</span><span className="tabular-nums">{page.issueCount}</span><span className="sr-only"> findings</span></button>)}</div></div>)}
      </div>
      <div className="min-w-0 border-t border-border bg-[var(--surface-inset)] p-5 lg:border-l lg:border-t-0">
        {selected ? <><h3 className="break-words font-semibold">{selected.title || 'Page evidence'}</h3><p className="mt-2 break-all text-xs text-muted-foreground">{selected.url}</p><dl className="my-5 grid grid-cols-2 gap-4 border-y border-border py-4"><div><dt className="text-xs text-muted-foreground">HTTP response</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{selected.statusCode || 'Unavailable'}</dd></div><div><dt className="text-xs text-muted-foreground">Findings</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{selected.issueCount}</dd></div></dl>{selected.sourceUrl && <p className="mb-4 break-all text-xs text-muted-foreground">Discovered from: {selected.sourceUrl}</p>}<ul className="space-y-3">{findings.slice(0, 5).map((issue) => <li key={issue.id} className="text-sm"><span className="font-semibold">{issue.title}</span><p className="mt-1 text-xs leading-5 text-muted-foreground">{issue.recommendation}</p></li>)}</ul>{!findings.length && <p className="text-sm text-muted-foreground">No findings for this page in the currently loaded evidence.</p>}</> : <p className="text-sm text-muted-foreground">Select a collected page to see its findings and discovery source.</p>}
      </div>
    </div>
  </section>;
}
