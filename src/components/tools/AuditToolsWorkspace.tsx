import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, Loader2, Printer, ShieldCheck } from 'lucide-react';
import type { ResourceAuditLiveData } from '../../lib/audit/resource-types';
import { analyzeCrawlClutter, generateSitemap, redactToolUrl } from '../../lib/tools/audit-tools';
import { extractReportScores, scoreToGrade } from '../../lib/audit/report-insights';
import { completePresentationSummary } from '../audit/audit-presentation';
import { API_ROUTES } from '../../lib/api/routes';
import { getAuditAccessHeaders } from '../../lib/api/auth-headers';
import { safeJsonFetch } from '../../lib/http/safe-json';
import { downloadAuditExport } from '../../lib/http/download';
import RobotsSandbox, { type StoredRobotsEvidence } from './RobotsSandbox';

const ToolsPage = lazy(() => import('./ToolsPage'));
const views = ['Preview and markup', 'Robots rules', 'Crawl analysis', 'Sitemap', 'Executive summary', 'Score badge'] as const;
type View = typeof views[number];
function saveText(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AuditToolsWorkspace({ data }: { data: ResourceAuditLiveData }) {
  const audit = data.audit;
  const [view, setView] = useState<View>('Preview and markup');
  const [pageId, setPageId] = useState(data.latestPages[0]?.id || '');
  const [robots, setRobots] = useState<StoredRobotsEvidence | null>(null);
  const [permissions, setPermissions] = useState<Array<{ id: string; expiresAt: string; revokedAt: string | null }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const pages = useMemo(() => data.latestPages.slice(0, 100), [data.latestPages]);
  const selectedPage = pages.find(page => page.id === pageId) || pages[0];
  const origins = useMemo(() => [...new Set(pages.flatMap(page => { try { return [new URL(page.url).origin]; } catch { return []; } }))], [pages]);
  const [selectedOrigin, setSelectedOrigin] = useState(() => { try { return new URL(audit?.normalizedUrl || '').origin; } catch { return ''; } });
  const origin = selectedOrigin || origins[0] || '';
  const sitemap = useMemo(() => generateSitemap(pages, origin), [pages, origin]);
  const clutter = useMemo(() => analyzeCrawlClutter(pages), [pages]);
  const complete = completePresentationSummary(audit, data.finalReport);
  const scores = extractReportScores(data.finalReport?.scores);
  const coverage = `${pages.length} loaded page records; ${audit?.pagesCrawled ?? 0} successfully analysed in this audit`;
  const [badgeConsent, setBadgeConsent] = useState(false);
  const [badge, setBadge] = useState<{ url: string; shareId: string; sourceShareId: string; expiresAt: string } | null>(null);

  function printSummary() {
    const sheet = document.querySelector('[data-print-sheet]');
    if (!sheet) return;
    document.getElementById('crawlio-print-summary')?.remove();
    const printSheet = sheet.cloneNode(true) as HTMLElement;
    printSheet.id = 'crawlio-print-summary'; printSheet.removeAttribute('data-print-sheet');
    document.body.append(printSheet);
    document.body.classList.add('printing-audit-summary');
    const cleanup = () => { printSheet.remove(); document.body.classList.remove('printing-audit-summary'); };
    window.addEventListener('afterprint', cleanup, { once: true });
    try { window.print(); } catch { cleanup(); window.removeEventListener('afterprint', cleanup); }
  }

  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await work(); } catch (error) { if (!controller.current?.signal.aborted) setMessage(error instanceof Error ? error.message : 'The action could not complete.'); }
    finally { setBusy(false); }
  }
  const loadRobots = () => action(async () => {
    if (!audit) return;
    controller.current?.abort(); controller.current = new AbortController();
    const response = await safeJsonFetch<{ data: { robots: StoredRobotsEvidence | null } }>(API_ROUTES.auditToolEvidence(audit.id), { headers: await getAuditAccessHeaders(), signal: controller.current.signal });
    if (!response.success) throw new Error('Stored robots evidence could not be loaded. You can still use paste mode.');
    setRobots(response.data.data.robots);
    if (!response.data.data.robots) setMessage('This audit has no retained robots document. Paste a document to test it locally.');
  });
  const enableBadge = () => action(async () => {
    if (!audit || !badgeConsent) return;
    const headers = await getAuditAccessHeaders({ 'Content-Type': 'application/json' });
    const shared = await safeJsonFetch<{ data: { shareUrl: string; shareId: string } }>(API_ROUTES.auditShare(audit.id), { method: 'POST', headers, body: JSON.stringify({ expiresInDays: 7 }) });
    if (!shared.success) throw new Error('An owner-authorized public report share is required. Sign in with the audit owner account.');
    const source = shared.data.data;
    const shareToken = new URL(source.shareUrl).pathname.split('/').pop();
    const issued = await safeJsonFetch<{ data: { badgeUrl: string; shareId: string; expiresAt: string } }>(API_ROUTES.auditScoreBadge(audit.id), { method: 'POST', headers, body: JSON.stringify({ confirm: true, shareToken }) });
    if (!issued.success) {
      await fetch(`/api/tools/audit/${encodeURIComponent(audit.id)}/shares/${encodeURIComponent(source.shareId)}`, { method: 'DELETE', headers }).catch(() => undefined);
      throw new Error('The public badge could not be issued. The temporary report share was revoked where possible.');
    }
    const value = issued.data.data;
    setBadge({ url: new URL(value.badgeUrl, window.location.origin).href, shareId: value.shareId, sourceShareId: source.shareId, expiresAt: value.expiresAt });
    setMessage('Public badge enabled for 7 days. Anyone with the badge URL can view the result.');
  });
  const revokeBadge = () => action(async () => {
    if (!audit || !badge) return;
    const headers = await getAuditAccessHeaders();
    for (const id of [badge.sourceShareId, badge.shareId]) {
      const result = await fetch(`/api/tools/audit/${encodeURIComponent(audit.id)}/shares/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
      if (!result.ok) throw new Error('Revocation could not complete. Try again.');
    }
    setBadge(null); setBadgeConsent(false); setMessage('Badge and its report permission revoked.');
  });
  const loadPermissions = () => action(async () => {
    const result = await safeJsonFetch<{ data: { shares: Array<{ id: string; expiresAt: string; revokedAt: string | null }> } }>(`/api/tools/audit/${encodeURIComponent(audit!.id)}/shares`, { headers: await getAuditAccessHeaders() });
    if (!result.success) throw new Error('Only the audit owner can manage public permissions.');
    setPermissions(result.data.data.shares);
  });

  if (!audit) return null;
  return <section className="min-w-0 space-y-5" aria-label="Audit tools">
    <p className="text-xs text-muted-foreground">{coverage}. Local tools do not change stored evidence or the audit score.</p>
    <nav aria-label="Audit tool selection" className="flex flex-wrap gap-2 border-b border-border pb-3">{views.map(item => <button key={item} type="button" aria-pressed={view === item} className={view === item ? 'trust-button min-h-10 px-3 py-2 text-xs' : 'quiet-button min-h-10 px-3 py-2 text-xs'} onClick={() => { setView(item); setMessage(''); }}>{item}</button>)}</nav>
    {message && <p role="status" className="break-words border-l-2 border-accent pl-3 text-sm">{message}</p>}
    {busy && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Working...</p>}
    {view === 'Preview and markup' && <>
      <label className="block text-sm font-semibold">Page evidence<select value={selectedPage?.id || ''} onChange={event => setPageId(event.target.value)} className="suite-input mt-2 w-full">{pages.map(page => <option key={page.id} value={page.id}>{redactToolUrl(page.url)}</option>)}</select></label>
      <Suspense fallback={<p className="text-sm">Loading local tools...</p>}><ToolsPage initialPage={selectedPage} embedded /></Suspense>
    </>}
    {view === 'Robots rules' && <><button type="button" disabled={busy} className="quiet-button" onClick={loadRobots}>Load retained robots evidence</button><RobotsSandbox evidence={robots} observedPages={pages} /></>}
    {view === 'Crawl analysis' && <div className="space-y-5">
      <h3 className="text-lg font-semibold">Discovery depth and potential clutter</h3>
      <p className="text-sm text-muted-foreground">{complete ? 'The depth chart uses complete stored aggregates.' : 'Depth counts cover this loaded subset only.'} Discovery depth is not shortest graph distance. Incoming links and orphan status are not measured by parent relationships.</p>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">{Object.entries(complete?.depthCounts || clutter.depth).sort(([a], [b]) => Number(a) - Number(b)).map(([depth, count]) => <div key={depth}><dt className="text-xs text-muted-foreground">Depth {depth}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{count}</dd></div>)}</dl>
      <p className="text-sm">{clutter.sitemapDiscovery} loaded pages were discovered through a sitemap. This is not proof they are orphaned.</p>
      <h4 className="font-semibold">Tracking parameter candidates in loaded evidence</h4>
      {!clutter.trackingGroups.length && <p className="text-sm text-muted-foreground">No tracking candidates in this subset.</p>}
      <ul className="divide-y divide-border">{clutter.trackingGroups.map(group => <li key={group.url} className="py-3"><p className="break-all text-sm font-semibold">{group.url}</p>{group.examples.map(url => <p key={url} className="mt-1 break-all text-xs text-muted-foreground">{url}</p>)}</li>)}</ul>
      <details><summary className="cursor-pointer text-sm font-semibold">Possible case or trailing-slash variants ({clutter.possiblePathVariants.length} groups)</summary><p className="my-3 text-xs text-muted-foreground">Candidates, not equivalent URLs or confirmed defects. Filter, sorting, pagination and language parameters remain distinct.</p>{clutter.possiblePathVariants.map((group, index) => <ul key={index} className="mb-3">{group.map(url => <li key={url} className="break-all text-xs">{url}</li>)}</ul>)}</details>
    </div>}
    {view === 'Sitemap' && <div className="space-y-4">
      <h3 className="text-lg font-semibold">Evidence-based sitemap</h3>
      <label className="block text-sm font-semibold">Selected origin<select className="suite-input mt-2" value={origin} onChange={event => setSelectedOrigin(event.target.value)}>{[...new Set([origin, ...origins])].filter(Boolean).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <p className="text-sm text-muted-foreground">{sitemap.included} eligible URLs in {pages.length} loaded records; {sitemap.excluded.length} excluded. Only retained HTML, robots, redirect, canonical and indexing evidence is used. No invented modification dates, priority or frequency.</p>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={!sitemap.included} className="quiet-button" onClick={() => saveText(sitemap.xml, 'crawlio-loaded-subset-sitemap.xml', 'application/xml')}><Download className="h-4 w-4" />Download loaded subset</button>
        {audit.processingVersion === 2 && <button type="button" disabled={busy || !['completed', 'completed_with_warnings'].includes(audit.status)} className="trust-button" onClick={() => void action(async () => { await downloadAuditExport(audit.id, 'sitemap.xml'); setMessage('Complete retained-evidence sitemap downloaded for the original audited origin. Excluded or unavailable pages are not included.'); })}><Download className="h-4 w-4" />Prepare complete sitemap</button>}</div>
      <p className="text-xs text-muted-foreground">The complete export uses the existing private worker job, expires after 24 hours, and follows your plan export permission. Its origin is {new URL(audit.normalizedUrl).origin}.</p>
      <details><summary className="cursor-pointer text-sm font-semibold">Excluded URLs and reasons</summary><ul className="mt-3 divide-y divide-border">{sitemap.excluded.slice(0, 50).map((item, index) => <li key={index} className="py-2"><p className="break-all text-xs font-semibold">{item.url}</p><p className="mt-1 text-xs text-muted-foreground">{item.reasons.join('; ')}</p></li>)}</ul></details>
    </div>}
    {view === 'Executive summary' && <>
      <button type="button" className="quiet-button" onClick={printSummary}><Printer className="h-4 w-4" />Print executive summary</button>
      <article data-print-sheet className="space-y-5 border-y border-border py-5">
        <h3 className="break-words text-xl font-semibold">{audit.hostname}: audit executive summary</h3>
        <p className="text-sm">{new Date(audit.completedAt || audit.updatedAt).toLocaleString()} · {audit.status.replaceAll('_', ' ')} · {audit.effectiveMode}</p>
        <p className="text-3xl font-semibold tabular-nums">{scores.overall == null ? 'Score not available' : `${Math.round(scores.overall)}/100 · Grade ${scoreToGrade(scores.overall)}`}</p>
        <p className="text-sm">{data.finalReport?.summary || 'The final report is not yet available.'}</p>
        <p className="text-xs text-muted-foreground">Scoring model {String(data.finalReport?.scores.scoringVersion || 'not recorded')}. {complete ? `${complete.analysedPages} analysed / ${complete.attemptedPages} attempted pages in complete aggregates.` : coverage + '; summary recommendations are limited to the loaded evidence.'} This audit is not a ranking or an indexing guarantee.</p>
        <h4 className="font-semibold">Prioritized actions</h4><ol className="list-decimal space-y-3 pl-5">{(complete?.topRecommendations || []).slice(0, 6).map(item => <li key={item.key} className="break-words text-sm"><strong>{item.title}</strong> · {item.affectedPages} affected pages<p className="mt-1 text-muted-foreground">{item.recommendation}</p></li>)}</ol>
        {!complete?.topRecommendations.length && <p className="text-sm">Open Findings for the retained evidence and priorities. No complete recommendations aggregate was stored for this audit.</p>}
        <p className="break-all text-xs">Full evidence: {window.location.origin}/app/audits/{encodeURIComponent(audit.id)}/overview (authorized access required).</p>
      </article>
    </>}
    {view === 'Score badge' && <div className="max-w-2xl space-y-4">
      <h3 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-5 w-5" />Public audit result badge</h3>
      <p className="text-sm text-muted-foreground">Owner opt-in makes a score, audit date, scoring version and coverage note publicly embeddable for up to 7 days. It is not certification or a ranking. The linked read-only report is also public. Requests recheck share permissions; revocation is not hidden by CDN caching.</p>
      {!badge ? <><label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={badgeConsent} onChange={event => setBadgeConsent(event.target.checked)} className="mt-1" />I authorize this result and read-only report to be publicly shared.</label><button type="button" className="trust-button" disabled={busy || !badgeConsent || scores.overall == null || !['completed', 'completed_with_warnings'].includes(audit.status)} onClick={enableBadge}>Enable public badge</button></> : <>
        <label className="block text-sm font-semibold">Embed HTML<textarea readOnly className="suite-input mt-2 min-h-24 w-full font-mono text-xs" value={`<img src="${badge.url.replaceAll('&', '&amp;')}" alt="Crawlio audit result" width="400" height="116" loading="lazy" referrerpolicy="no-referrer">`} /></label>
        <p className="text-xs text-muted-foreground">Expires {new Date(badge.expiresAt).toLocaleString()}. Existing permissions can also be revoked after reopening this report.</p>
        <div className="flex flex-wrap gap-2"><button className="quiet-button" onClick={() => void action(async () => { await navigator.clipboard.writeText(badge.url); setMessage('Badge URL copied.'); })}><Copy className="h-4 w-4" />Copy badge URL</button><button className="quiet-button" disabled={busy} onClick={revokeBadge}>Revoke badge</button></div>
      </>}
      <div className="border-t border-border pt-4"><button type="button" className="quiet-button" disabled={busy} onClick={loadPermissions}>Manage existing public permissions</button>{permissions && <ul className="mt-3 divide-y divide-border">{!permissions.length && <li className="text-sm text-muted-foreground">No active report or badge permissions.</li>}{permissions.map(permission => <li key={permission.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="text-xs">Report/badge permission · expires {new Date(permission.expiresAt).toLocaleString()}</span><button type="button" disabled={busy} className="quiet-button" onClick={() => void action(async () => {
        const result = await fetch(`/api/tools/audit/${encodeURIComponent(audit.id)}/shares/${encodeURIComponent(permission.id)}`, { method: 'DELETE', headers: await getAuditAccessHeaders() });
        if (!result.ok) throw new Error('Permission could not be revoked.');
        setPermissions(current => current?.filter(item => item.id !== permission.id) || []); setMessage('Public permission revoked. Dependent badges stop serving immediately.');
      })}>Revoke</button></li>)}</ul>}</div>
    </div>}
  </section>;
}
