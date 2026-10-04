import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Waypoints } from 'lucide-react';
import type { ResourceAuditPage, ResourceAuditIssue, ResourceAuditDocument } from '../../lib/audit/resource-types';
import { PageEvidenceDrawer } from './PageEvidenceDrawer';
import { isTerminalAuditStatus } from '../../lib/audit/audit-time';
import { auditCoverage } from '../../lib/audit/audit-evidence-quality';
import { ProgressBar } from '../ui/visual-system';
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
      const depth = Math.max(0, page.crawlDepth || 0);
      const group = groups.get(depth) || [];
      group.push(page);
      groups.set(depth, group);
    }
    let y = 32;
    const bands: Array<{ depth: number; y: number }> = [];
    const nodes: Array<{ page: ResourceAuditPage; x: number; y: number }> = [];
    for (const [depth, items] of [...groups].sort(([a], [b]) => a - b)) {
      bands.push({ depth, y });
      items.forEach((page, index) => nodes.push({ page, x: 44 + (index % 8) * 98, y: y + 30 + Math.floor(index / 8) * 56 }));
      y += 46 + Math.ceil(items.length / 8) * 56;
    }
    const byUrl = new Map(nodes.map(node => [node.page.url, node]));
    const links = nodes.flatMap(node => {
      const source = node.page.sourceUrl ? byUrl.get(node.page.sourceUrl) : undefined;
      return source && source !== node ? [{ source, target: node }] : [];
    });
    return { bands, nodes, links, height: Math.max(180, y) };
  }, [visiblePages]);

  const select = (page: ResourceAuditPage) => onPageSelect ? onPageSelect(page) : setSelected(page);
  return <section ref={container} className="audit-evidence-map min-w-0 border-y border-border" data-active={active} aria-labelledby="page-map-heading">
    <header className="flex flex-wrap items-center justify-between gap-3 py-4"><div><h2 id="page-map-heading" className="flex items-center gap-2 text-base font-semibold"><Waypoints className="h-4 w-4 text-accent" />Your website, page by page</h2><p className="mt-1 text-xs text-muted-foreground">{audit && isTerminalAuditStatus(audit.status) ? 'Collected evidence. ' : ''}Sample of {visiblePages.length} stored pages, grouped by crawl depth. Lines show recorded discovery sources.</p></div>{audit?.status === 'running' && <button type="button" className="quiet-button min-h-9 px-3 py-1 text-xs" aria-pressed={paused} aria-label={paused ? 'Resume animation' : 'Pause animation'} disabled={reducedMotion} title={reducedMotion ? 'Reduced motion is enabled' : paused ? 'Resume arrival animation' : 'Pause arrival animation'} onClick={() => setPaused(value => !value)}>{paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}{paused ? 'Resume' : 'Pause'}</button>}</header>
    {coverage && <div className="mb-4 max-w-md"><ProgressBar label={audit?.scope?.coverage === 'page' ? 'Single-page coverage' : 'Audit page limit used'} value={coverage.allowancePercent} /><p className="mt-1 text-xs text-muted-foreground">{coverage.analysed} / {coverage.allowance.toLocaleString()} pages in this audit. {audit?.planPageLimit != null && `${audit.planPageLimit.toLocaleString()} pages in the plan allowance. `}The map below is a sample.</p></div>}
    {!visiblePages.length ? <p className="py-10 text-center text-sm text-muted-foreground">Waiting for the first stored page. No page evidence has arrived yet.</p> : <div className="audit-topology-scroll overflow-auto rounded-md bg-[var(--surface-inset)]" role="region" aria-label="Sampled page discovery map" tabIndex={0}>
      <svg viewBox={`0 0 840 ${layout.height}`} className="audit-topology" role="group" aria-label={`${visiblePages.length} sampled pages and ${layout.links.length} recorded discovery links`}>
        {layout.bands.map(band => <text key={band.depth} x="12" y={band.y} className="audit-map-depth-label">Depth {band.depth}</text>)}
        <g fill="none" aria-hidden="true">{layout.links.map(({ source, target }) => <path key={`${source.page.id}:${target.page.id}`} className={`audit-map-link ${arrivals.has(target.page.id) ? 'audit-map-link-arrival' : ''}`} d={`M ${source.x + 42} ${source.y + 14} C ${source.x + 42} ${source.y + 44}, ${target.x + 42} ${target.y - 24}, ${target.x + 42} ${target.y}`} />)}</g>
        {layout.nodes.map(({ page, x, y }) => {
          const outcome = page.fetchStatus === 'failed' || page.fetchStatus === 'blocked' || !page.statusCode || page.statusCode >= 400 ? 'error' : page.issueCount ? 'findings' : 'clear';
          return <g key={page.id} role="button" tabIndex={0} aria-label={`${scopeIncludesGroup(audit?.scope, 'seo') ? page.title || page.url : page.url}, HTTP ${page.statusCode || 'unavailable'}, ${page.issueCount} findings. Open page evidence.`} onClick={() => select(page)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(page); } }} className={`audit-map-node ${arrivals.has(page.id) ? 'audit-map-arrival' : ''}`} data-outcome={outcome} transform={`translate(${x} ${y})`}>
            <title>{page.url}</title><rect width="84" height="44" rx="4" /><circle cx="9" cy="22" r="3" /><text x="17" y="17" className="audit-map-node-label">{pageLabel(page).slice(0, 9)}</text><text x="17" y="32" className="audit-map-node-count">{page.issueCount} findings</text>
          </g>;
        })}
      </svg>
    </div>}
    <footer className="flex flex-wrap gap-x-5 gap-y-2 py-3 text-xs text-muted-foreground"><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[var(--success)]" />No recorded findings</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[var(--warning)]" />Has findings</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[var(--danger)]" />Error or unavailable</span><span className="sm:ml-auto">Animation follows new evidence only</span></footer>
    {!onPageSelect && <PageEvidenceDrawer scope={audit?.scope} page={selected} issues={issues} onClose={close} />}
  </section>;
});
