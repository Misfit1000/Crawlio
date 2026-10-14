import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './audit-report.css';
import { Pause, Play, Waypoints } from 'lucide-react';
import type { ResourceAuditPage, ResourceAuditIssue, ResourceAuditDocument } from '../../lib/audit/resource-types';
import { PageEvidenceDrawer } from './PageEvidenceDrawer';
import { ProgressBar } from '../ui/visual-system';
import { isTerminalAuditStatus } from '../../lib/audit/audit-time';
import { auditCoverage } from '../../lib/audit/audit-evidence-quality';
import { scopeIncludesGroup } from '../../lib/audit/audit-scope';

function pageLabel(page: ResourceAuditPage) {
  try { return new URL(page.url).pathname || '/'; } catch { return page.title || page.url; }
}

export const AuditPageMap = memo(function AuditPageMap({ pages, issues, audit, onPageSelect }: { pages: ResourceAuditPage[]; issues: ResourceAuditIssue[]; audit?: ResourceAuditDocument; onPageSelect?: (page: ResourceAuditPage) => void }) {
  const container = useRef<HTMLElement>(null);
  const seen = useRef<Set<string> | null>(null);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [paused, setPaused] = useState(false);
  const [arrivals, setArrivals] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<ResourceAuditPage | null>(null);
  const close = useCallback(() => setSelected(null), []);
  const visiblePages = useMemo(() => {
    if (pages.length <= 48) return pages;
    const root = pages.find(page => page.crawlDepth === 0) || pages[0];
    return [root, ...pages.filter(page => page.id !== root.id).slice(-47)];
  }, [pages]);

  useEffect(() => {
    let intersecting = false;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      setVisible(intersecting && !document.hidden);
      setReducedMotion(media.matches || document.documentElement.dataset.motion === 'reduced');
    };
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; update(); });
    const preferences = new MutationObserver(update);
    if (container.current) observer.observe(container.current);
    preferences.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    media.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => { observer.disconnect(); preferences.disconnect(); media.removeEventListener('change', update); document.removeEventListener('visibilitychange', update); };
  }, []);

  const active = audit?.status === 'running' && visible && !paused && !reducedMotion;
  const coverage = audit ? auditCoverage(audit) : null;
  useEffect(() => {
    const current = new Set(visiblePages.map(page => page.id));
    setArrivals(new Set(seen.current && active ? visiblePages.filter(page => !seen.current!.has(page.id)).map(page => page.id) : []));
    seen.current = current;
  }, [visiblePages]);

  const layout = useMemo(() => {
    const groups = new Map<number, ResourceAuditPage[]>();
    for (const page of visiblePages) {
      const depth = Math.min(3, Math.max(0, page.crawlDepth || 0));
      const group = groups.get(depth) || [];
      group.push(page);
      groups.set(depth, group);
    }
    const bands: Array<{ depth: number; x: number; count: number }> = [];
    const nodes: Array<{ page: ResourceAuditPage; x: number; y: number }> = [];
    let column = 0;
    let rows = 1;
    for (const [depth, items] of [...groups].sort(([a], [b]) => a - b)) {
      const x = 24 + column * 220;
      bands.push({ depth, x, count: items.length });
      items.forEach((page, index) => nodes.push({ page, x, y: 72 + index * 64 }));
      rows = Math.max(rows, items.length);
      column++;
    }
    const byUrl = new Map(nodes.map(node => [node.page.url, node]));
    const links = nodes.flatMap(node => {
      const source = node.page.sourceUrl ? byUrl.get(node.page.sourceUrl) : undefined;
      return source && source !== node ? [{ source, target: node }] : [];
    });
    return { bands, nodes, links, width: Math.max(660, column * 220 + 24), height: Math.max(220, rows * 64 + 88) };
  }, [visiblePages]);

  const select = (page: ResourceAuditPage) => onPageSelect ? onPageSelect(page) : setSelected(page);
  return <section ref={container} className="audit-evidence-map min-w-0" data-active={active} aria-label="Your website, page by page">
    <header className="audit-section-heading mb-6 flex flex-wrap items-center justify-between gap-4"><div><h2 id="page-map-heading" className="flex items-center gap-2"><Waypoints className="h-5 w-5 text-accent" />Pages discovered</h2><p className="mt-2 text-xs text-muted-foreground">{audit && isTerminalAuditStatus(audit.status) ? 'Collected evidence. ' : ''}Page sample: {visiblePages.length}{coverage ? ` of ${coverage.discovered.toLocaleString()} discovered URLs` : ' stored pages'}. Lines show recorded discovery sources.</p></div>{audit?.status === 'running' && <button type="button" className="quiet-button min-h-11 px-3 text-xs" aria-pressed={paused} aria-label={paused ? 'Resume animation' : 'Pause animation'} disabled={reducedMotion} title={reducedMotion ? 'Reduced motion is enabled' : paused ? 'Resume arrival animation' : 'Pause arrival animation'} onClick={() => setPaused(value => !value)}>{paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}{paused ? 'Resume' : 'Pause'}</button>}</header>
    {!visiblePages.length ? <div className="audit-map-empty flex min-h-60 flex-col items-center justify-center rounded-md bg-muted/25 p-8 text-center"><Waypoints className="h-8 w-8 text-muted-foreground" /><p className="mt-4 font-medium">Waiting for the first page</p><p className="mt-2 text-sm text-muted-foreground">Observed pages will appear here when evidence arrives.</p></div> : <div className="audit-topology-scroll max-h-96 overflow-auto" role="region" aria-label="Sampled page discovery map" tabIndex={0}>
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="audit-topology block h-auto w-full" role="group" aria-label={`${visiblePages.length} sampled pages grouped by crawl depth, and ${layout.links.length} recorded discovery links`}>
        {layout.bands.map(band => <g key={band.depth}><text x={band.x} y="24" className="audit-map-depth-label">{band.depth === 0 ? 'Entry page' : `Depth ${band.depth}${band.depth === 3 ? '+' : ''}`}</text><text x={band.x} y="43" className="audit-map-node-count">{band.count} sampled {band.count === 1 ? 'page' : 'pages'}</text></g>)}
        <g fill="none" aria-hidden="true">{layout.links.map(({ source, target }) => <path key={`${source.page.id}:${target.page.id}`} className={`audit-map-link ${arrivals.has(target.page.id) ? 'audit-map-link-arrival' : ''}`} d={`M ${source.x + 184} ${source.y + 24} C ${source.x + 204} ${source.y + 24}, ${target.x - 20} ${target.y + 24}, ${target.x} ${target.y + 24}`} />)}</g>
        {layout.nodes.map(({ page, x, y }) => {
          const outcome = page.fetchStatus === 'failed' || page.fetchStatus === 'blocked' || !page.statusCode || page.statusCode >= 400 ? 'error' : page.issueCount ? 'findings' : 'clear';
          return <g key={page.id} role="button" tabIndex={0} aria-label={`${scopeIncludesGroup(audit?.scope, 'seo') ? page.title || page.url : page.url}, HTTP ${page.statusCode || 'unavailable'}, ${page.issueCount} findings. Open page evidence.`} onClick={() => select(page)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(page); } }} className={`audit-map-node ${arrivals.has(page.id) ? 'audit-map-arrival' : ''}`} data-outcome={outcome} transform={`translate(${x} ${y})`}>
            <title>{page.url}</title><rect width="184" height="48" rx="6" /><circle cx="14" cy="24" r="4" /><text x="26" y="20" className="audit-map-node-label">{pageLabel(page).length > 23 ? `${pageLabel(page).slice(0, 22)}...` : pageLabel(page)}</text><text x="26" y="36" className="audit-map-node-count">{page.issueCount} findings / {page.statusCode || 'No response'}</text>
          </g>;
        })}
      </svg>
    </div>}
    <footer className="flex flex-wrap gap-x-5 gap-y-2 py-3 text-xs text-muted-foreground"><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[var(--success)]" />No recorded findings</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[var(--warning)]" />Has findings</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[var(--danger)]" />Error or unavailable</span><span className="sm:ml-auto">Animation follows new evidence only</span></footer>
    {coverage && <div className="mt-3"><ProgressBar label="Audit allowance used" value={coverage.allowancePercent} /></div>}
    {!onPageSelect && <PageEvidenceDrawer scope={audit?.scope} page={selected} issues={issues} onClose={close} />}
  </section>;
});
