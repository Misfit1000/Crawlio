import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Globe } from 'lucide-react';
import { AUDIT_TARGET_INPUT_PROPS, normalizeAuditTarget } from '../lib/url/normalize-audit-target';
import { createPublicPlanComparison, mergePublicPlanPresentation, type PublicPlanProjection } from '../lib/plans/public-plan-presentation';
import { loadPublicPlanProjection } from '../lib/plans/public-plan-client';
import { useAuditEntitlements } from '../hooks/useAuditEntitlements';
import { getAuditModeConfig, type AuditMode } from '../lib/audit/audit-config';
import { AuditModePicker } from './audit/AuditModePicker';
import { AuditConceptScene } from './ui/AuditConceptScene';

const ExampleFindingExplorer = lazy(() => import('./home/ExampleFindingExplorer'));
const sectionLayout = 'content-auto section-shell py-11 md:py-16 scroll-mt-24';
const headingLayout = 'mb-7 flex flex-wrap items-start justify-between gap-5';
const sectionTitle = 'max-w-2xl text-2xl font-semibold md:text-3xl';
const sectionDescription = 'max-w-md text-sm leading-7 text-muted-foreground';
export type LandingDestination = 'dashboard' | 'reports' | 'start-audit';
interface Props {
  onStartAudit: (url: string, mode: AuditMode) => Promise<void> | void;
  onExploreFeatures: () => void;
  onNavigate: (destination: LandingDestination) => void;
}

const capabilities = [
  ['SEO & content', 'Titles, descriptions, headings, canonical signals and structured data.'],
  ['Crawl & links', 'Robots rules, sitemaps, redirects and broken internal destinations.'],
  ['Page health', 'Response times, page weight, accessibility and passive security.'],
];
const questions = [
  ['What can I audit?', 'Public websites and individual pages. Private networks and authenticated pages are not supported.'],
  ['Will every page be checked?', 'The audit follows discoverable pages up to your allowance. Fewer pages or access restrictions are reported as coverage limits.'],
  ['Are scores based on AI?', 'No. Scores come from deterministic checks and collected evidence. Unavailable checks are never treated as passes.'],
  ['Does Crawlio measure rankings or traffic?', 'Search performance needs connected or imported provider data. Domain strength is a Crawlio audit score, not third-party Domain Authority.'],
  ['What about JavaScript sites and performance?', 'Crawlio analyzes retrievable public responses. Response timing is not browser-measured Core Web Vitals, and browser-only content can have limited evidence.'],
  ['Can I track fixes and export?', 'Reports include finding progress, notes, comparisons and plan-enabled PDF, CSV and JSON exports. Owners can delete audits or request account deletion in Settings.'],
];

export default function LandingPage({ onStartAudit, onExploreFeatures, onNavigate }: Props) {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<AuditMode>('quick');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [optionsRequested, setOptionsRequested] = useState(false);
  const [projection, setProjection] = useState<PublicPlanProjection | null>(null);
  const [plansUnavailable, setPlansUnavailable] = useState(false);
  const [exampleReady, setExampleReady] = useState(false);
  const pricing = useRef<HTMLElement>(null);
  const example = useRef<HTMLElement>(null);
  const submitting = useRef(false);
  const entitlements = useAuditEntitlements({ loadGuestPlan: optionsRequested, guestPlan: projection?.plans.find(plan => plan.sourcePlan === 'free') || null });
  const plans = useMemo(() => mergePublicPlanPresentation(projection), [projection]);
  const comparison = useMemo(() => createPublicPlanComparison(plans), [plans]);

  useEffect(() => {
    if (entitlements.hasCurrentEntitlements && !entitlements.selectableModes.includes(mode) && entitlements.selectableModes[0]) setMode(entitlements.selectableModes[0]);
  }, [entitlements.hasCurrentEntitlements, entitlements.selectableModes.join(','), mode]);
  useEffect(() => {
    const controller = new AbortController();
    let requestedAt = 0;
    let approaching = false;
    let active = true;
    let timer: number | undefined;
    const load = () => {
      if (!active || document.hidden || !approaching || Date.now() - requestedAt < 30_000) return;
      requestedAt = Date.now();
      void loadPublicPlanProjection(controller.signal).then(value => {
        if (active) { setProjection(value); setPlansUnavailable(false); }
      }).catch(cause => { if (active && cause?.name !== 'AbortError') setPlansUnavailable(true); });
    };
    const schedule = () => {
      clearInterval(timer);
      if (!document.hidden && approaching) {
        load();
        timer = window.setInterval(load, 30_000);
      }
    };
    const observer = new IntersectionObserver(([entry]) => { approaching = entry.isIntersecting; schedule(); }, { rootMargin: '800px 0px' });
    if (pricing.current) observer.observe(pricing.current);
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('focus', load);
    return () => { active = false; controller.abort(); observer.disconnect(); clearInterval(timer); document.removeEventListener('visibilitychange', schedule); window.removeEventListener('focus', load); };
  }, []);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setExampleReady(true); observer.disconnect(); }
    }, { rootMargin: '200px 0px' });
    if (example.current) observer.observe(example.current);
    return () => observer.disconnect();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    const normalized = normalizeAuditTarget(url);
    if (!normalized.isValid) { setError(normalized.error || 'Enter a public website.'); return; }
    if (entitlements.hasCurrentEntitlements && !entitlements.selectableModes.includes(mode)) { setError('Choose an available audit type.'); return; }
    submitting.current = true;
    setStarting(true);
    setError('');
    try { await onStartAudit(url, mode); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The audit could not start.'); }
    finally { submitting.current = false; setStarting(false); }
  };

  return <main id="main-content" className="w-full bg-background text-foreground">
    <section id="product" className="clarity-hero">
      <AuditConceptScene />
      <div className="clarity-hero-content section-shell">
        <h1>Crawlio website audits</h1>
        <p className="clarity-hero-description">Find SEO problems. See the evidence. Know what to fix.</p>
        <form id="start-audit" onSubmit={submit} onFocusCapture={() => setOptionsRequested(true)} onPointerDownCapture={() => setOptionsRequested(true)} className="clarity-audit-form" noValidate>
          <label htmlFor="homepage-audit-url" className="sr-only">Website or domain</label>
          <div className="clarity-url-row"><Globe className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" /><input id="homepage-audit-url" {...AUDIT_TARGET_INPUT_PROPS} value={url} onChange={event => setUrl(event.target.value)} aria-describedby={error ? 'homepage-audit-error' : 'homepage-mode-description'} aria-invalid={Boolean(error)} placeholder="Enter your website or domain" /><button type="submit" className="trust-button" disabled={starting || !url.trim() || entitlements.hasCurrentEntitlements && !entitlements.selectableModes.includes(mode)}>Start audit <ArrowRight className="h-4 w-4" /></button></div>
          <AuditModePicker value={mode} onChange={setMode} modes={entitlements.selectableModes} limits={entitlements.pageLimits} loading={!entitlements.hasCurrentEntitlements} />
          <p id="homepage-mode-description" className="mt-3 text-xs text-muted-foreground">{getAuditModeConfig(mode).description}</p>
          {entitlements.guestPlanError && <p className="mt-2 text-xs text-[var(--warning)]">Audit options unavailable.<button type="button" onClick={entitlements.retryGuestPlan} className="ml-2 underline">Retry</button></p>}
          {error && <p id="homepage-audit-error" role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
        </form>
        <a href="#example-report" className="clarity-example-link">Explore a sample report <ArrowRight className="h-4 w-4" /></a>
      </div>
    </section>
    <section id="features" className={sectionLayout}>
      <div className={headingLayout}><h2 className={sectionTitle}>A complete view of your website</h2><p className={sectionDescription}>Findings connect each problem to its affected pages and a practical fix.</p></div>
      <div className="grid gap-6 md:grid-cols-3 md:gap-8">{capabilities.map(([title, description], index) => <article key={title}><span className="text-sm tabular-nums text-accent">0{index + 1}</span><h3 className="mt-3 text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">{description}</p></article>)}</div>
    </section>
    <section id="example-report" ref={example} className="content-auto clarity-example-section">
      <div className={sectionLayout}><div className={headingLayout}><div><p className="mb-2 text-xs font-semibold text-accent">Sample data</p><h2 className={sectionTitle}>From finding to fix</h2></div></div><div id="reports"><Suspense fallback={<ExamplePlaceholder />}>{exampleReady ? <ExampleFindingExplorer /> : <ExamplePlaceholder />}</Suspense></div></div>
    </section>
    <section id="how-it-works" className={sectionLayout}>
      <div className={headingLayout}><h2 className={sectionTitle}>Check. Fix. Improve.</h2><button type="button" className="quiet-button" onClick={onExploreFeatures}>Open workspace <ArrowRight className="h-4 w-4" /></button></div>
      <ol className="grid gap-6 md:grid-cols-3 md:gap-8">{[['Check your site', 'Follow coverage and measured findings as pages are analyzed.'], ['Work through fixes', 'Inspect evidence, assign priorities and keep progress beside each finding.'], ['Compare results', 'See what changed after your next audit.']].map(([title, description], index) => <li key={title}><span className="text-sm tabular-nums text-accent">0{index + 1}</span><h3 className="mt-3 text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">{description}</p></li>)}</ol>
    </section>
    <section id="pricing" ref={pricing} className={`${sectionLayout} border-t border-border`}>
      <div className={headingLayout}><h2 className={sectionTitle}>Choose your audit depth</h2><p className={sectionDescription}>Plan access is managed by an administrator. Self-service billing is not yet available.</p></div>
      <div className="grid gap-5 md:grid-cols-3">{plans.map(plan => <article key={plan.id} className={`rounded-lg border p-6 ${plan.recommended ? 'border-accent' : 'border-border'}`}><div className="flex items-center justify-between gap-2"><h3 className="text-xl font-semibold">{plan.name}</h3>{plan.recommended && <span className="text-xs font-semibold text-accent">Most versatile</span>}</div><p className="mt-2 text-sm text-muted-foreground">{plan.mode}</p><p className="my-5 text-2xl font-semibold tabular-nums">Up to {plan.pagesPerAudit} pages</p><p className="text-sm text-muted-foreground">{plan.allowance}</p><ul className="my-5 space-y-3 text-sm">{plan.features.map(feature => <li key={feature} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" />{feature}</li>)}</ul><p className="text-xs text-muted-foreground">{plan.footer}</p></article>)}</div>
      {plansUnavailable && <p role="status" className="mt-4 text-xs text-muted-foreground">Showing last available limits. Current allowances are verified when an audit starts.</p>}
      <details className="mt-6 border-y border-border py-4"><summary className="cursor-pointer text-sm font-semibold">Compare all capabilities</summary><div className="mt-4 overflow-x-auto"><table className="suite-table w-full min-w-[600px]"><caption className="sr-only">Plan comparison</caption><thead><tr><th scope="col">Capability</th>{plans.map(plan => <th scope="col" key={plan.id}>{plan.name}</th>)}</tr></thead><tbody>{comparison.map(row => <tr key={row.label}><th scope="row">{row.label}</th>{row.values.map((value, index) => <td key={index}>{value}</td>)}</tr>)}</tbody></table></div></details>
      <button type="button" className="trust-button mt-5" onClick={() => onNavigate('start-audit')}>Start your audit <ArrowRight className="h-4 w-4" /></button>
    </section>
    <section className={`${sectionLayout} border-t border-border`}><div className={headingLayout}><h2 className={sectionTitle}>Practical SEO guides</h2><a href="/blog" className="quiet-button">Read the blog <ArrowRight className="h-4 w-4" /></a></div><a href="/blog/robots-txt-noindex-canonical-guide" className="relative block border-y border-border py-6 pr-12"><span className="text-xs font-semibold text-accent">Technical SEO</span><h3 className="mt-3 text-lg font-semibold">Robots.txt, noindex and canonical tags</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">Understand which control to use, what it changes, and how to verify it.</p><ArrowRight className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-accent" /></a></section>
    <section id="faq" className={`${sectionLayout} border-t border-border`}><h2 className="mb-6 text-2xl font-semibold">Before you start</h2>{questions.map(([question, answer]) => <details key={question} className="border-b border-border py-4"><summary className="min-h-8 cursor-pointer text-sm font-semibold">{question}</summary><p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{answer}</p></details>)}</section>
  </main>;
}

function ExamplePlaceholder() {
  return <article className="min-h-72 rounded-lg border border-border bg-card p-6"><p className="text-xs font-semibold text-[var(--warning)]">High priority · Sample finding</p><h3 className="mt-3 text-2xl font-semibold">Broken internal link</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">Four sample pages link to a URL that returns 404.</p><div className="mt-5 border-t border-border pt-4"><h4 className="text-sm font-semibold">Recommended fix</h4><p className="mt-2 text-sm leading-7 text-muted-foreground">Restore the page, link to its replacement, or remove the obsolete link.</p></div></article>;
}
