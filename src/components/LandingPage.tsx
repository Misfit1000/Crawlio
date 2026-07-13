import React, { useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  FileText,
  Globe,
  Link2,
  Monitor,
  Search,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { createAuditSubmitGuard } from '../lib/api/audit-submit-guard';
import { AUDIT_TARGET_INPUT_PROPS, normalizeAuditTarget } from '../lib/url/normalize-audit-target';
import {
  CategoryScoreBar,
  RadialScoreGauge,
  SectionHeader,
  SeverityDistribution,
  StatusBadge,
  SurfaceCard,
} from './ui/visual-system';

interface Props {
  onStartAudit: (url: string) => Promise<void> | void;
  onExploreFeatures: () => void;
  onNavigate: (destination: LandingDestination) => void;
}

export type LandingDestination = 'dashboard' | 'reports' | 'start-audit';

const coverage = [
  {
    icon: Search,
    title: 'On-page SEO',
    description: 'Page titles, descriptions, headings, image text, internal links, and search-result previews.',
    checks: ['Title and description quality', 'Heading structure', 'Internal links and image text'],
  },
  {
    icon: Globe,
    title: 'Technical SEO',
    description: 'Status codes, redirects, preferred URLs, search access rules, sitemaps, and indexing signals.',
    checks: ['Crawl and index access', 'Redirect and status review', 'Sitemap and preferred URL checks'],
  },
  {
    icon: ShieldCheck,
    title: 'Passive security',
    description: 'Public HTTPS and browser-protection settings, reviewed without exploitation or attack traffic.',
    checks: ['HTTPS and HSTS', 'Content and frame protections', 'Mixed-content warnings'],
  },
];

const useCases = [
  { title: 'Site owners', text: 'See the problems that deserve attention before paying for campaigns or a redesign.' },
  { title: 'Agencies', text: 'Turn discovery findings into a clear scope of work and a report clients can follow.' },
  { title: 'Marketing teams', text: 'Review landing pages before launch and keep technical issues out of campaign work.' },
  { title: 'Developers', text: 'Trace findings to affected pages, evidence, and specific implementation changes.' },
];

const faqs = [
  {
    question: 'What does an audit collect?',
    answer: 'SEOIntel stores the audit status, page summaries, findings, and report data needed to show results. It does not retain complete raw page HTML.',
  },
  {
    question: 'Are rankings or traffic estimated?',
    answer: 'No. Rankings, traffic, backlinks, and search volume appear only when they come from data you import or a real provider. The audit never invents those values.',
  },
  {
    question: 'Is the security review a penetration test?',
    answer: 'No. It observes public HTTPS, response headers, forms, cookies, and browser-protection signals. It does not exploit vulnerabilities or attempt unauthorised access.',
  },
  {
    question: 'Does AI decide audit scores?',
    answer: 'No. Audit findings and scores come from deterministic checks. Administrators may use optional AI-assisted drafting for blog articles, but every draft requires editorial review before publication.',
  },
  {
    question: 'Why might some pages be missing?',
    answer: 'A website may block automated requests, require authentication, time out, or return an error. Reports identify unavailable evidence instead of counting it as a passed check.',
  },
];

export default function LandingPage({ onStartAudit, onExploreFeatures, onNavigate }: Props) {
  const [url, setUrl] = useState('');
  const [starting, setStarting] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
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

  return (
    <main id="main-content" className="w-full bg-background text-foreground">
      <section id="product" className="border-b border-border bg-card">
        <div className="section-shell py-12 sm:py-16 lg:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:gap-14">
            <div className="min-w-0">
              <h1 className="max-w-2xl text-4xl font-bold leading-[1.08] sm:text-5xl lg:text-[3.4rem]">
                Find SEO problems before they cost you traffic.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
                Audit a public website, review affected pages, and get clear recommendations without fabricated rankings or traffic estimates.
              </p>

              <form id="start-audit" onSubmit={handleSubmit} noValidate className="mt-8 max-w-xl" aria-label="Start a website audit">
                <label htmlFor="homepage-audit-url" className="mb-2 block text-sm font-semibold">Website or domain</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative min-w-0 flex-1">
                    <Globe className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <input
                      {...AUDIT_TARGET_INPUT_PROPS}
                      id="homepage-audit-url"
                      autoComplete="url"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      aria-describedby={auditError ? 'homepage-audit-error' : 'homepage-audit-help'}
                      aria-invalid={Boolean(auditError)}
                      className="suite-input pl-11"
                    />
                  </div>
                  <button type="submit" disabled={starting || !url.trim()} className="trust-button shrink-0 px-5">
                    {starting ? 'Starting audit...' : 'Start audit'}
                    {!starting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
                <p id="homepage-audit-help" className="mt-2 text-xs leading-5 text-muted-foreground">Use a public website you own or have permission to review.</p>
                {auditError && <p id="homepage-audit-error" className="mt-2 text-sm font-medium text-red-600" role="alert">{auditError}</p>}
              </form>

              <div className="mt-6 flex flex-wrap gap-x-5 gap-y-3 text-sm text-muted-foreground" aria-label="Audit data practices">
                <span className="inline-flex items-center gap-2"><Activity className="h-4 w-4 text-accent" aria-hidden="true" /> Live progress</span>
                <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" /> Passive checks only</span>
                <span className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-accent" aria-hidden="true" /> No raw HTML storage</span>
              </div>

              <button type="button" onClick={onExploreFeatures} className="quiet-button mt-7">Open your workspace</button>
            </div>

            <ExampleReportPreview onOpen={() => onNavigate('reports')} />
          </div>
        </div>
      </section>

      <section id="features" className="section-shell scroll-mt-24 py-14 md:py-18">
        <SectionHeader
          title="What the audit checks"
          description="The first view explains what needs attention. Technical evidence stays available when you need to verify a finding."
        />
        <div className="mt-9 grid border-y border-border lg:grid-cols-3 lg:divide-x lg:divide-border">
          {coverage.map((group) => {
            const Icon = group.icon;
            return (
              <article key={group.title} className="border-b border-border px-1 py-7 last:border-b-0 lg:border-b-0 lg:px-7 first:lg:pl-0 last:lg:pr-0">
                <Icon className="h-7 w-7 text-accent" aria-hidden="true" />
                <h3 className="mt-4 text-xl font-semibold">{group.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{group.description}</p>
                <ul className="mt-5 space-y-2 text-sm">
                  {group.checks.map((check) => <li key={check} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />{check}</li>)}
                </ul>
              </article>
            );
          })}
        </div>
      </section>

      <section id="reports" className="border-y border-border bg-muted/25 py-14 md:py-18">
        <div className="section-shell grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
          <div>
            <SectionHeader
              title="Start with the fixes that matter most"
              description="Reports separate urgent problems from routine improvements, show affected pages, and keep evidence close to each recommendation."
            />
            <ul className="mt-7 space-y-4 text-sm leading-6">
              <li><strong className="font-semibold">Clear priorities.</strong> Findings are grouped by urgency and audit area.</li>
              <li><strong className="font-semibold">Page-level evidence.</strong> See where an issue was found and what the audit observed.</li>
              <li><strong className="font-semibold">Honest coverage.</strong> Failed or blocked checks remain visible as limitations, not passes.</li>
            </ul>
            <button type="button" onClick={() => onNavigate('reports')} className="quiet-button mt-7">View reports</button>
          </div>
          <ReportDetailPreview />
        </div>
      </section>

      <section id="how-it-works" className="section-shell scroll-mt-24 py-14 md:py-18">
        <SectionHeader title="From URL to report" />
        <ol className="mt-8 grid border-y border-border md:grid-cols-3 md:divide-x md:divide-border">
          {[
            ['1', 'Submit the website', 'The service validates the address and creates one audit job.'],
            ['2', 'Follow the audit', 'Live updates show discovery, page checks, and report preparation.'],
            ['3', 'Work through findings', 'Review priorities, evidence, affected pages, and recommended fixes.'],
          ].map(([number, title, text]) => (
            <li key={number} className="border-b border-border py-7 last:border-b-0 md:border-b-0 md:px-7 first:md:pl-0 last:md:pr-0">
              <span className="text-sm font-semibold text-accent">Step {number}</span>
              <h3 className="mt-2 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="use-cases" className="border-y border-border bg-card py-14 md:py-18">
        <div className="section-shell">
          <SectionHeader title="Built for practical audit work" description="Use the same report at different levels of detail, from a quick owner review to an implementation backlog." />
          <div className="mt-8 grid gap-x-10 gap-y-0 md:grid-cols-2">
            {useCases.map((item) => (
              <article key={item.title} className="border-b border-border py-6">
                <h3 className="font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="section-shell scroll-mt-24 py-14 md:py-18">
        <SectionHeader title="Audit plans" description="Plan limits reflect the current audit service. Billing and self-service upgrades are not available yet." />
        <div className="mt-8 overflow-hidden rounded-xl border border-border">
          <div className="grid bg-muted/50 text-sm font-semibold sm:grid-cols-[1.2fr_1fr_1fr]"><div className="p-4">Capability</div><div className="hidden border-l border-border p-4 sm:block">Free</div><div className="hidden border-l border-border p-4 sm:block">Full audit access</div></div>
          {[
            ['Pages per audit', 'Up to 5', 'Up to 25'],
            ['Audit allowance', '3 daily / 30 monthly', '25 daily / 500 monthly'],
            ['Active audits', 'One at a time', 'Subject to plan and queue limits'],
            ['Reports', 'Core findings and live progress', 'Deeper reports and export access'],
          ].map(([label, free, full]) => (
            <div key={label} className="grid border-t border-border text-sm sm:grid-cols-[1.2fr_1fr_1fr]">
              <div className="p-4 font-semibold">{label}</div>
              <div className="px-4 pb-4 text-muted-foreground sm:border-l sm:border-border sm:py-4"><span className="mr-2 font-semibold text-foreground sm:hidden">Free:</span>{free}</div>
              <div className="px-4 pb-4 text-muted-foreground sm:border-l sm:border-border sm:py-4"><span className="mr-2 font-semibold text-foreground sm:hidden">Full:</span>{full}</div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => onNavigate('start-audit')} className="trust-button mt-6">Start a free audit</button>
      </section>

      <section className="border-y border-border bg-muted/25 py-14 md:py-18">
        <div className="section-shell grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold md:text-3xl">What you can trust</h2>
            <ul className="mt-6 space-y-4 text-sm leading-6">
              <li><strong className="font-semibold">Deterministic results.</strong> Audit findings and scores come from defined checks, not generated guesses.</li>
              <li><strong className="font-semibold">Visible limitations.</strong> Blocked pages and unavailable evidence stay visible in the report.</li>
              <li><strong className="font-semibold">Focused storage.</strong> Reports keep page summaries and findings without retaining complete raw HTML.</li>
            </ul>
          </div>
          <div>
            <h2 className="text-2xl font-semibold md:text-3xl">What the audit does not claim</h2>
            <ul className="mt-6 space-y-4 text-sm leading-6 text-muted-foreground">
              <li>Metadata previews are report compositions, not screenshots of the live website.</li>
              <li>Response timing is not presented as browser-measured Core Web Vitals.</li>
              <li>Passive security observations are not penetration testing.</li>
              <li>Ranking, traffic, backlink, and search-volume data require a real import or provider.</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="faq" className="section-shell scroll-mt-24 py-14 md:py-18">
        <div className="grid gap-8 lg:grid-cols-[0.65fr_1.35fr]">
          <div>
            <h2 className="text-3xl font-semibold">Questions before you start</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">The audit is designed for public websites and transparent about unavailable evidence.</p>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {faqs.map((faq) => <FaqItem key={faq.question} {...faq} />)}
          </div>
        </div>
      </section>
    </main>
  );
}

function ExampleReportPreview({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-background shadow-sm" aria-label="Example audit report">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <div className="text-xs font-semibold text-accent">Example report</div>
          <div className="mt-0.5 font-semibold">example.com</div>
        </div>
        <StatusBadge tone="neutral">Demonstration data</StatusBadge>
      </div>
      <div className="grid gap-5 p-4 sm:p-5 md:grid-cols-[10rem_1fr]">
        <div className="flex items-center justify-center border-b border-border pb-5 md:border-b-0 md:border-r md:pb-0 md:pr-5">
          <RadialScoreGauge value={84} label="Example score" detail="Calculated from sample findings" size="sm" />
        </div>
        <div className="space-y-3">
          <CategoryScoreBar label="On-page SEO" value={86} detail="Titles, descriptions, headings" />
          <CategoryScoreBar label="Technical SEO" value={78} detail="Status, redirects, search access" />
          <CategoryScoreBar label="Passive security" value={88} detail="Public browser protections" />
        </div>
      </div>
      <div className="border-t border-border p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3"><span className="font-semibold">Findings by priority</span><span className="text-xs text-muted-foreground">Sample counts</span></div>
        <SeverityDistribution critical={3} high={6} medium={12} low={8} />
      </div>
      <div className="flex flex-col gap-3 border-t border-border bg-muted/25 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs leading-5 text-muted-foreground">The live report uses findings collected from the submitted website.</span>
        <button type="button" onClick={onOpen} className="quiet-button shrink-0">View report workspace</button>
      </div>
    </div>
  );
}

function ReportDetailPreview() {
  return (
    <SurfaceCard className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div><div className="text-xs font-semibold text-accent">Example finding</div><h3 className="mt-1 font-semibold">Page returned 404 Not Found</h3></div>
        <StatusBadge tone="warning">High priority</StatusBadge>
      </div>
      <div className="grid gap-0 md:grid-cols-[1fr_14rem]">
        <div className="divide-y divide-border px-5">
          <div className="py-5"><div className="text-sm font-semibold">What happened</div><p className="mt-2 text-sm leading-6 text-muted-foreground">The URL no longer serves an available page. Visitors and crawlers following links to it reach a dead end.</p></div>
          <div className="py-5"><div className="text-sm font-semibold">Why it matters</div><p className="mt-2 text-sm leading-6 text-muted-foreground">Broken destinations interrupt navigation and may leave important content inaccessible.</p></div>
          <div className="py-5"><div className="text-sm font-semibold">Recommended fix</div><p className="mt-2 text-sm leading-6 text-muted-foreground">Restore the page, redirect it to the closest relevant replacement, or remove links and sitemap entries pointing to it.</p></div>
        </div>
        <div className="border-t border-border bg-muted/30 p-5 md:border-l md:border-t-0">
          <div className="text-sm font-semibold">Affected page</div>
          <div className="mt-3 break-all text-xs leading-5 text-muted-foreground">https://example.com/old-service</div>
          <div className="mt-6 flex items-center gap-2 text-xs"><Link2 className="h-4 w-4 text-accent" aria-hidden="true" /> Found from an internal link</div>
          <div className="mt-3 flex items-center gap-2 text-xs"><Monitor className="h-4 w-4 text-accent" aria-hidden="true" /> HTTP status: 404</div>
          <div className="mt-3 flex items-center gap-2 text-xs"><Smartphone className="h-4 w-4 text-accent" aria-hidden="true" /> Page preview unavailable</div>
        </div>
      </div>
    </SurfaceCard>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="group py-5">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-semibold marker:content-none">
        {question}
        <span className="text-xl font-normal text-muted-foreground transition-transform group-open:rotate-45" aria-hidden="true">+</span>
      </summary>
      <p className="max-w-3xl pb-1 pr-8 text-sm leading-6 text-muted-foreground">{answer}</p>
    </details>
  );
}
