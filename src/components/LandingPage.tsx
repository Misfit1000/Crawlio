import React, { useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Code2,
  ExternalLink,
  Eye,
  FileCheck2,
  Globe,
  LockKeyhole,
  Search,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';
import { createAuditSubmitGuard } from '../lib/api/audit-submit-guard';
import { AUDIT_TARGET_INPUT_PROPS, normalizeAuditTarget } from '../lib/url/normalize-audit-target';
import { CategoryScoreBar, RadialScoreGauge, SeverityDistribution, StatusBadge } from './ui/visual-system';

interface Props {
  onStartAudit: (url: string) => Promise<void> | void;
  onExploreFeatures: () => void;
  onNavigate: (destination: LandingDestination) => void;
}

export type LandingDestination = 'dashboard' | 'reports' | 'start-audit';

const coverageGroups = [
  {
    id: 'search',
    label: 'Search presentation',
    icon: Search,
    summary: 'How each page explains itself to people and search engines.',
    checks: [
      ['Metadata', 'Page titles, descriptions, preferred URLs, and search-result composition.'],
      ['Headings', 'H1 presence, hierarchy, skipped levels, and repeated headings.'],
      ['Structured data', 'Public schema markup, parsing errors, and supported entity signals.'],
      ['Indexing directives', 'Noindex instructions, conflicting signals, and index access.'],
    ],
    score: 86,
  },
  {
    id: 'delivery',
    label: 'Access and delivery',
    icon: Waypoints,
    summary: 'Whether important pages can be found, reached, and served reliably.',
    checks: [
      ['Crawlability', 'Search access rules, sitemap discovery, and blocked destinations.'],
      ['Status codes', 'Successful pages, redirects, client errors, and server failures.'],
      ['Redirects', 'Chains, loops, temporary redirects, and avoidable internal hops.'],
      ['Canonical signals', 'Preferred page URLs that are missing, invalid, or conflicting.'],
    ],
    score: 78,
  },
  {
    id: 'quality',
    label: 'Page quality',
    icon: FileCheck2,
    summary: 'Signals that affect navigation, clarity, accessibility, and page weight.',
    checks: [
      ['Internal links', 'Broken destinations, source pages, anchor text, and link reach.'],
      ['Images', 'Missing alternative text and image delivery observations.'],
      ['Page accessibility', 'Language, labels, landmarks, and basic document structure.'],
      ['Performance signals', 'Response timing, response size, and resource observations.'],
    ],
    score: 82,
  },
  {
    id: 'safety',
    label: 'Passive security',
    icon: ShieldCheck,
    summary: 'Public browser-protection signals checked without exploitation.',
    checks: [
      ['HTTPS', 'Secure delivery, certificate reachability, and HTTP redirection.'],
      ['Browser protections', 'HSTS, content policy, frame, referrer, and MIME protections.'],
      ['Cookies and forms', 'Public cookie attributes and form transport observations.'],
      ['Exposure checks', 'Common public configuration and diagnostic-file paths.'],
    ],
    score: 88,
  },
];

const findingExamples = [
  { title: 'Page returned 404 Not Found', category: 'Crawlability', severity: 'High', pages: 4, evidence: '/services/old-offer returned HTTP 404', action: 'Restore the page, redirect it to the closest replacement, or remove links pointing to it.', impact: 'Visitors and crawlers following the link reach a dead end.' },
  { title: 'Important page contains noindex', category: 'Indexing', severity: 'Critical', pages: 1, evidence: 'robots meta: noindex,follow', action: 'Confirm whether the page should appear in search, then remove the directive only if it was unintended.', impact: 'The page explicitly asks search engines not to include it in results.' },
  { title: 'Multiple pages share the same title', category: 'On-page SEO', severity: 'Medium', pages: 7, evidence: '“Services | Example” appears on 7 pages', action: 'Write a distinct title that describes the purpose of each affected page.', impact: 'Repeated titles make separate pages harder to distinguish in search results.' },
  { title: 'Internal link redirects unnecessarily', category: 'Links', severity: 'Medium', pages: 12, evidence: '/about → /company/about', action: 'Update internal links to point directly to the final preferred address.', impact: 'Avoidable redirects add a request and make internal navigation less direct.' },
  { title: 'Canonical points to another URL', category: 'Technical SEO', severity: 'High', pages: 2, evidence: 'Canonical target differs from the current page', action: 'Verify the intended preferred URL and align canonical, sitemap, and internal-link signals.', impact: 'Conflicting preferred-page signals can split indexing attention.' },
  { title: 'Browser protection is unavailable', category: 'Passive security', severity: 'Medium', pages: 5, evidence: 'Content-Security-Policy header not observed', action: 'Introduce and test a policy that allows only the resources the site needs.', impact: 'The browser has fewer restrictions on where page resources may load from.' },
  { title: 'Heading structure skips levels', category: 'Accessibility', severity: 'Low', pages: 3, evidence: 'H2 is followed by H4', action: 'Use a logical heading sequence that reflects the page outline.', impact: 'An inconsistent outline makes long pages harder to navigate and interpret.' },
];

const workflow = [
  ['01', 'Audit the website', 'The address is validated and one queue job is created.'],
  ['02', 'Group related findings', 'Repeated page-level observations become one finding with measurable reach.'],
  ['03', 'Review evidence', 'Open affected pages, source URLs, response details, and collected metadata.'],
  ['04', 'Set the priority', 'Severity, page reach, confidence, and evidence determine the order.'],
  ['05', 'Track the work', 'Set a workflow status and keep implementation notes beside the finding.'],
  ['06', 'Compare the next audit', 'See which findings are new, resolved, or still present.'],
];

const faqs = [
  ['What does an audit check?', 'The audit reviews on-page SEO, technical delivery, crawlability, internal links, metadata, headings, indexing directives, redirects, structured data, page accessibility, performance signals, and passive browser protections.'],
  ['Can SEOIntel audit JavaScript-rendered pages?', 'The audit analyses the public response it can retrieve. Content that appears only after complex browser execution may have limited evidence, and the report will show that limitation rather than inventing a result.'],
  ['Does it estimate rankings or traffic?', 'No. Rankings, traffic, backlinks, and search volume appear only when they come from data you import or a real provider.'],
  ['What does completed with warnings mean?', 'The report contains useful collected evidence, but one or more pages or checks were blocked, unavailable, or stopped by a safe audit limit. Those gaps remain visible.'],
  ['Is the security audit a penetration test?', 'No. Passive security observations are not penetration testing. The audit reads public responses and browser-protection signals without exploitation or attack traffic.'],
  ['Are private or internal websites supported?', 'No. Audits are restricted to public websites. Private network addresses, local services, and authenticated internal pages are blocked by safety controls.'],
  ['How is audit data stored?', 'SEOIntel stores job state, page summaries, findings, events, and report data. Complete raw HTML is not retained, and metadata previews are not screenshots.'],
  ['Does AI decide audit scores?', 'No. Audit findings and scores come from deterministic checks. Optional AI-assisted drafting is limited to administrator blog tools and still requires editorial review.'],
  ['Can I delete an audit or account?', 'Account owners can remove stored audits and request account deletion from the workspace settings. Retention and deletion boundaries are explained in the privacy policy.'],
];

export default function LandingPage({ onStartAudit, onExploreFeatures, onNavigate }: Props) {
  const [url, setUrl] = useState('');
  const [starting, setStarting] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [activeCoverage, setActiveCoverage] = useState(coverageGroups[0].id);
  const [activeFinding, setActiveFinding] = useState(0);
  const auditStartGuardRef = useRef(createAuditSubmitGuard());

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeAuditTarget(url);
    if (!normalized.isValid) {
      setAuditError(normalized.error || 'Enter a valid public website or domain.');
      return;
    }
    if (!auditStartGuardRef.current.begin()) return;
    setStarting(true);
    setAuditError(null);
    try {
      await onStartAudit(url);
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : 'The audit could not start. Please try again.');
    } finally {
      auditStartGuardRef.current.end();
      setStarting(false);
    }
  };

  const selectedCoverage = coverageGroups.find((group) => group.id === activeCoverage) || coverageGroups[0];
  const selectedFinding = findingExamples[activeFinding];

  return (
    <main id="main-content" className="w-full bg-background text-foreground">
      <section id="product" className="relative overflow-hidden border-b border-border bg-card">
        <div className="hero-grid pointer-events-none absolute inset-0 opacity-65" aria-hidden="true" />
        <div className="section-shell relative py-10 sm:py-14 lg:py-18">
          <div className="grid items-center gap-10 xl:grid-cols-[0.9fr_1.1fr] xl:gap-12">
            <div className="min-w-0">
              <div className="mb-5 flex flex-wrap gap-3 text-xs font-semibold text-muted-foreground"><span className="inline-flex items-center gap-2"><CircleAlert className="h-4 w-4 text-accent" /> Public website audits</span><span className="inline-flex items-center gap-2"><Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-300" /> Live progress</span></div>
              <h1 className="max-w-2xl text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-[3.6rem]">See what is holding your website back.</h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">Run a technical SEO audit, trace each problem to the affected pages, and understand what to fix first.</p>

              <form id="start-audit" onSubmit={handleSubmit} noValidate className="mt-8 max-w-2xl" aria-label="Start a website audit">
                <label htmlFor="homepage-audit-url" className="mb-2 block text-sm font-semibold">Website or domain</label>
                <div className="rounded-xl border border-border bg-card p-2 shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 sm:flex">
                  <div className="relative min-w-0 flex-1">
                    <Globe className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <input {...AUDIT_TARGET_INPUT_PROPS} id="homepage-audit-url" autoComplete="url" value={url} onChange={(event) => setUrl(event.target.value)} aria-describedby={auditError ? 'homepage-audit-error' : 'homepage-audit-help'} aria-invalid={Boolean(auditError)} className="min-h-12 w-full bg-transparent pl-11 pr-3 text-base outline-none placeholder:text-[var(--subtle-foreground)]" />
                  </div>
                  <button type="submit" disabled={starting || !url.trim()} className="trust-button mt-2 min-h-12 w-full shrink-0 px-5 sm:mt-0 sm:w-auto">{starting ? 'Starting audit...' : 'Start audit'}{!starting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}</button>
                </div>
                <div className="mt-2 flex flex-col gap-2 text-xs leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><p id="homepage-audit-help">Try example.com, www.example.com, or a full public page URL.</p><a href="#example-report" className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">View example report <ArrowRight className="h-3.5 w-3.5" /></a></div>
                {auditError && <p id="homepage-audit-error" className="mt-2 text-sm font-medium text-red-600 dark:text-red-300" role="alert">{auditError}</p>}
              </form>

              <div className="mt-7 grid max-w-2xl grid-cols-2 gap-x-5 gap-y-3 border-t border-border pt-5 text-xs text-muted-foreground sm:grid-cols-4" aria-label="Audit trust points">
                {['Deterministic checks', 'No fabricated traffic data', 'Clear affected-page evidence', 'Public websites only'].map((point) => <span key={point} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />{point}</span>)}
              </div>
            </div>
            <ExampleWorkspacePreview onOpen={() => onNavigate('reports')} />
          </div>
        </div>
      </section>

      <section id="features" className="content-auto section-shell scroll-mt-24 py-14 md:py-18">
        <div className="grid gap-10 xl:grid-cols-[0.7fr_1.3fr]">
          <div className="xl:sticky xl:top-28 xl:self-start"><p className="text-sm font-semibold text-accent">Audit coverage</p><h2 className="mt-2 text-3xl font-semibold leading-tight md:text-4xl">See what the audit actually checks.</h2><p className="mt-4 max-w-lg text-sm leading-7 text-muted-foreground">Coverage is organised around the decisions you need to make, not a wall of disconnected feature cards.</p>
            <div className="mt-7 grid gap-1 border-y border-border py-2" role="tablist" aria-label="Audit coverage categories">
              {coverageGroups.map((group) => { const Icon = group.icon; const active = group.id === selectedCoverage.id; return <button key={group.id} type="button" role="tab" aria-selected={active} onClick={() => setActiveCoverage(group.id)} className={`flex min-h-12 items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold ${active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Icon className="h-4 w-4" /><span className="flex-1">{group.label}</span><span className="text-xs tabular-nums opacity-80">{group.score}</span></button>; })}
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="grid gap-6 border-b border-border p-5 sm:p-7 md:grid-cols-[1fr_170px] md:items-center"><div><div className="flex items-center gap-3">{React.createElement(selectedCoverage.icon, { className: 'h-6 w-6 text-accent' })}<h3 className="text-2xl font-semibold">{selectedCoverage.label}</h3></div><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{selectedCoverage.summary}</p></div><CategoryScoreBar label="Example category score" value={selectedCoverage.score} detail="Demonstration data" /></div>
            <div className="divide-y divide-border">
              {selectedCoverage.checks.map(([title, description], index) => <article key={title} className="grid gap-2 p-5 sm:grid-cols-[44px_180px_1fr] sm:items-start sm:p-6"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-sm font-semibold tabular-nums">{String(index + 1).padStart(2, '0')}</div><h4 className="font-semibold">{title}</h4><p className="text-sm leading-6 text-muted-foreground">{description}</p></article>)}
            </div>
          </div>
        </div>
      </section>

      <section id="example-report" className="content-auto border-y border-border bg-[var(--surface-inset)] py-14 md:py-18">
        <div className="section-shell">
          <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end"><div><p className="text-sm font-semibold text-accent">Specific recommendations</p><h2 className="mt-2 text-3xl font-semibold leading-tight md:text-4xl">A finding should explain the problem, not just name it.</h2><p className="mt-4 text-sm leading-7 text-muted-foreground">Select an example to see the same evidence-first structure used in reports.</p></div><div className="flex flex-wrap gap-2 lg:justify-end"><StatusBadge tone="neutral">Example report</StatusBadge><StatusBadge tone="accent">Demonstration data</StatusBadge></div></div>
          <div className="mt-8 grid overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[0.8fr_1.2fr]">
            <div className="divide-y divide-border border-b border-border lg:border-b-0 lg:border-r">
              {findingExamples.map((finding, index) => <button key={finding.title} type="button" onClick={() => setActiveFinding(index)} className={`flex w-full items-start gap-3 px-4 py-4 text-left sm:px-5 ${activeFinding === index ? 'bg-accent/8' : 'hover:bg-muted/45'}`}><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${finding.severity === 'Critical' ? 'bg-red-500' : finding.severity === 'High' ? 'bg-orange-500' : finding.severity === 'Medium' ? 'bg-amber-500' : 'bg-sky-500'}`} /><span className="min-w-0"><span className="block text-sm font-semibold">{finding.title}</span><span className="mt-1 block text-xs text-muted-foreground">{finding.category} · {finding.pages} affected {finding.pages === 1 ? 'page' : 'pages'}</span></span></button>)}
            </div>
            <article className="p-5 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap gap-2"><StatusBadge tone={selectedFinding.severity === 'Critical' ? 'danger' : selectedFinding.severity === 'Low' ? 'neutral' : 'warning'}>{selectedFinding.severity}</StatusBadge><StatusBadge tone="accent">{selectedFinding.category}</StatusBadge></div><h3 className="mt-4 text-2xl font-semibold">{selectedFinding.title}</h3></div><div className="text-right"><div className="text-2xl font-semibold tabular-nums">{selectedFinding.pages}</div><div className="text-xs text-muted-foreground">Affected pages</div></div></div>
              <div className="mt-6 grid gap-0 border-y border-border md:grid-cols-2 md:divide-x md:divide-border"><div className="py-5 md:pr-6"><h4 className="text-sm font-semibold">Why it matters</h4><p className="mt-2 text-sm leading-6 text-muted-foreground">{selectedFinding.impact}</p></div><div className="py-5 md:pl-6"><h4 className="text-sm font-semibold">Recommended action</h4><p className="mt-2 text-sm leading-6 text-muted-foreground">{selectedFinding.action}</p></div></div>
              <div className="mt-5 rounded-lg border border-border bg-[var(--surface-inset)] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Code2 className="h-4 w-4" /> Evidence preview</div><code className="mt-2 block overflow-x-auto text-sm text-foreground">{selectedFinding.evidence}</code></div>
            </article>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="content-auto section-shell scroll-mt-24 py-14 md:py-18">
        <div className="grid gap-10 xl:grid-cols-[0.62fr_1.38fr]"><div><p className="text-sm font-semibold text-accent">From evidence to action</p><h2 className="mt-2 text-3xl font-semibold leading-tight md:text-4xl">The report becomes a working backlog.</h2><p className="mt-4 text-sm leading-7 text-muted-foreground">Findings retain the context needed to verify, assign, fix, and compare the work.</p><button type="button" onClick={onExploreFeatures} className="quiet-button mt-6">Open your workspace <ExternalLink className="h-4 w-4" /></button></div>
          <ol className="grid border-y border-border md:grid-cols-2">
            {workflow.map(([number, title, description], index) => <li key={number} className={`grid grid-cols-[44px_1fr] gap-3 border-b border-border py-5 md:px-6 ${index % 2 === 0 ? 'md:border-r' : ''} ${index >= 4 ? 'md:border-b-0' : ''}`}><span className="font-semibold tabular-nums text-accent">{number}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p></div></li>)}
          </ol>
        </div>
      </section>

      <section className="content-auto border-y border-border bg-card py-14 md:py-18">
        <div className="section-shell grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div><div className="flex h-11 w-11 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><LockKeyhole className="h-5 w-5" /></div><h2 className="mt-5 text-3xl font-semibold leading-tight md:text-4xl">The report is clear about what it knows.</h2><p className="mt-4 text-sm leading-7 text-muted-foreground">Audit scores come from collected checks. Missing evidence remains a limitation and is never converted into a pass.</p></div>
          <div className="divide-y divide-border border-y border-border">
            {[
              ['Measured scores', 'Scores use deterministic findings and observed affected-page reach.'],
              ['Imported search data', 'Rankings and traffic require a real provider or a user-supplied import.'],
              ['Metadata previews', 'Desktop, mobile, and search compositions are not presented as browser screenshots.'],
              ['Passive security', 'Public response checks are not penetration testing and do not attempt exploitation.'],
              ['Performance boundaries', 'Response timing is not described as browser-measured Core Web Vitals.'],
              ['Unavailable checks', 'Blocked, failed, or unsupported evidence is not counted as passed.'],
            ].map(([title, copy]) => <div key={title} className="grid gap-2 py-4 sm:grid-cols-[180px_1fr]"><h3 className="text-sm font-semibold">{title}</h3><p className="text-sm leading-6 text-muted-foreground">{copy}</p></div>)}
          </div>
        </div>
      </section>

      <section id="pricing" className="content-auto section-shell scroll-mt-24 py-14 md:py-18">
        <div className="max-w-3xl"><p className="text-sm font-semibold text-accent">Plans and limits</p><h2 className="mt-2 text-3xl font-semibold leading-tight md:text-4xl">Choose the audit depth you need.</h2><p className="mt-4 text-sm leading-7 text-muted-foreground">Self-service billing is not available yet. Plan access is enabled by an administrator, and server-enforced limits always take priority.</p></div>
        <div className="mt-8 overflow-hidden rounded-xl border border-border bg-card">
          <div className="grid divide-y divide-border lg:grid-cols-3 lg:divide-x lg:divide-y-0">
            {[
              { name: 'Free', mode: 'Quick audit', pages: 'Up to 5 pages', allowance: '3 daily · 30 monthly', points: ['Core SEO and technical findings', 'Live progress and stored reports', 'One active audit at a time'], note: 'PDF export is unavailable on Free.' },
              { name: 'Plus', mode: 'Full standard audit', pages: 'Up to 25 pages', allowance: '25 daily · 500 monthly', points: ['Extended findings and page coverage', 'PDF, JSON, and CSV exports', 'Higher queue priority and concurrency'], note: 'Mapped to the current paid plan.' },
              { name: 'Pro', mode: 'Agency deep audit', pages: 'Up to 75 pages', allowance: '100 daily · 3,000 monthly', points: ['Quick, standard, and deep modes', 'Expanded report and workflow limits', 'Highest non-admin queue priority'], note: 'Deep mode requires an available configured audit engine.' },
            ].map((plan, index) => <article key={plan.name} className={`p-5 sm:p-7 ${index === 1 ? 'bg-accent/[0.045]' : ''}`}><div className="flex items-start justify-between gap-3"><div><h3 className="text-2xl font-semibold">{plan.name}</h3><p className="mt-1 text-sm text-muted-foreground">{plan.mode}</p></div>{index === 1 && <StatusBadge tone="accent">Full audit</StatusBadge>}</div><div className="mt-6 border-y border-border py-4"><div className="text-lg font-semibold">{plan.pages}</div><div className="mt-1 text-sm text-muted-foreground">{plan.allowance}</div></div><ul className="mt-5 space-y-3 text-sm">{plan.points.map((point) => <li key={point} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />{point}</li>)}</ul><p className="mt-5 text-xs leading-5 text-muted-foreground">{plan.note}</p></article>)}
          </div>
        </div>
        <button type="button" onClick={() => onNavigate('start-audit')} className="trust-button mt-6">Start a free audit <ArrowRight className="h-4 w-4" /></button>
      </section>

      <section id="faq" className="content-auto border-t border-border bg-[var(--surface-inset)] py-14 md:py-18">
        <div className="section-shell grid gap-8 lg:grid-cols-[0.58fr_1.42fr]"><div><p className="text-sm font-semibold text-accent">Before you start</p><h2 className="mt-2 text-3xl font-semibold leading-tight">Practical audit questions.</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">The service is built for public websites and reports unavailable evidence directly.</p></div><div className="divide-y divide-border border-y border-border">{faqs.map(([question, answer]) => <FaqItem key={question} question={question} answer={answer} />)}</div></div>
      </section>
    </main>
  );
}

function ExampleWorkspacePreview({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="report-grid relative min-w-0 overflow-hidden rounded-xl border border-border bg-[var(--surface-inset)] p-3 shadow-sm" aria-label="Example audit report">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"><div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground"><BarChart3 className="h-4 w-4" /></div><div><div className="flex items-center gap-2 text-xs font-semibold text-accent">Example report <span className="text-muted-foreground">· Demonstration data</span></div><div className="mt-0.5 font-semibold">example.com</div></div></div><StatusBadge tone="success">Report ready</StatusBadge></div>
        <div className="grid lg:grid-cols-[190px_minmax(0,1fr)]">
          <div className="flex items-center justify-center border-b border-border p-5 lg:border-b-0 lg:border-r"><RadialScoreGauge value={84} label="Audit score" detail="Example result" size="sm" /></div>
          <div className="p-4 sm:p-5"><div className="grid gap-3 sm:grid-cols-3"><CategoryScoreBar label="SEO" value={86} detail="Titles and headings" /><CategoryScoreBar label="Technical" value={78} detail="Access and delivery" /><CategoryScoreBar label="Security" value={88} detail="Passive checks" /></div><div className="mt-4"><SeverityDistribution critical={3} high={6} medium={12} low={8} /></div></div>
        </div>
        <div className="grid border-t border-border xl:grid-cols-[1fr_210px]"><div className="p-4 sm:p-5"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone="warning">High priority</StatusBadge><span className="text-xs text-muted-foreground">4 affected pages</span></div><h3 className="mt-3 text-lg font-semibold">Page returned 404 Not Found</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Restore the destination, redirect it to the closest relevant page, or remove internal links pointing to it.</p><div className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--surface-inset)] px-3 py-2 text-xs text-muted-foreground"><Eye className="h-4 w-4 text-accent" /> Evidence and source pages available</div></div><div className="border-t border-border bg-[var(--surface-inset)] p-4 xl:border-l xl:border-t-0"><div className="text-xs font-semibold text-muted-foreground">Coverage</div><dl className="mt-3 grid grid-cols-2 gap-3"><div><dt className="text-[11px] text-muted-foreground">Analysed</dt><dd className="text-xl font-semibold">25</dd></div><div><dt className="text-[11px] text-muted-foreground">Checks</dt><dd className="text-xl font-semibold">142</dd></div><div><dt className="text-[11px] text-muted-foreground">Warnings</dt><dd className="text-xl font-semibold text-amber-600 dark:text-amber-300">2</dd></div><div><dt className="text-[11px] text-muted-foreground">Passed</dt><dd className="text-xl font-semibold text-emerald-600 dark:text-emerald-300">111</dd></div></dl></div></div>
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs text-muted-foreground">Every value in this preview is labeled example data.</span><button type="button" onClick={onOpen} className="quiet-button min-h-10 shrink-0 px-3 py-2 text-sm">View report workspace</button></div>
      </div>
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  return <details className="group py-5"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-semibold marker:content-none">{question}<ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" /></summary><p className="max-w-3xl pb-1 pr-8 text-sm leading-6 text-muted-foreground">{answer}</p></details>;
}
