import { useMemo, useState } from 'react';
import { FileText, Waypoints } from 'lucide-react';
import type { ResourceAuditPage, ResourceAuditIssue } from '../../lib/audit/resource-types';

export function AuditPageMap({ pages, issues }: { pages: ResourceAuditPage[]; issues: ResourceAuditIssue[] }) {
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
  return <section className="suite-panel overflow-hidden" aria-labelledby="page-map-heading">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><div><h2 id="page-map-heading" className="flex items-center gap-2 text-lg font-semibold"><Waypoints className="h-5 w-5 text-accent" />Your website, page by page</h2><p className="mt-1 text-xs text-muted-foreground">Collected pages grouped by crawl depth. Select a page to inspect its evidence.</p></div><span className="text-sm tabular-nums">{pages.length} pages in view</span></header>
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
