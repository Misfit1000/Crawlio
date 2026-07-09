import React, { useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Briefcase,
  CheckCircle2,
  Code2,
  FileText,
  Gauge,
  Globe,
  Layers,
  Link2,
  Lock,
  MapPin,
  Monitor,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  Upload,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';
import { createAuditSubmitGuard } from '../lib/api/audit-submit-guard';
import {
  FeatureSuiteCard,
  MegaMenuPanel,
  MetricCard,
  PricingCard,
  SectionHeader,
  SeverityStack,
  SitePreviewSection,
  StatusBadge,
  SurfaceCard,
  ToolCard,
  UseCaseCard,
} from './ui/visual-system';

interface Props {
  onStartAudit: (url: string) => Promise<void> | void;
  onExploreFeatures: () => void;
}

type IconType = React.ComponentType<{ className?: string }>;

const trustBullets = [
  'Resource-light live audits',
  'No paid SEO or AI API required',
  'Passive browser-safety checks only',
  'No raw HTML storage',
];

const suiteFeatures: Array<{
  icon: IconType;
  eyebrow: string;
  title: string;
  description: string;
  status: string;
  points: string[];
  muted?: boolean;
}> = [
  {
    icon: Search,
    eyebrow: 'Working product',
    title: 'Website Audit',
    description: 'Run a live website scan that checks public pages and turns findings into clear next steps.',
    status: 'Live',
    points: ['Titles and descriptions', 'Headings and page structure', 'Internal links and image descriptions'],
  },
  {
    icon: Monitor,
    eyebrow: 'Visual report',
    title: 'Google-style Preview',
    description: 'See desktop, mobile, and search result previews near the executive summary.',
    status: 'Live',
    points: ['SERP snippet preview', 'Mobile preview concept', 'Desktop report context'],
  },
  {
    icon: Gauge,
    eyebrow: 'Website health',
    title: 'Website Health',
    description: 'Find redirects, slow responses, oversized pages, status codes, and confusing page signals.',
    status: 'Live',
    points: ['Status code review', 'Redirect and URL health', 'Resource and page-size signals'],
  },
  {
    icon: ShieldCheck,
    eyebrow: 'Passive safety',
    title: 'Browser Safety',
    description: 'Review public HTTPS and browser protection settings without probing or attacking the site.',
    status: 'Live',
    points: ['HTTPS checks', 'Browser security protections', 'Non-invasive only'],
  },
  {
    icon: FileText,
    eyebrow: 'Content workflow',
    title: 'Keyword and Content Tools',
    description: 'Use deterministic content checks and add your own keyword notes where external data is needed.',
    status: 'Import-ready',
    points: ['Content structure checks', 'Manual keyword notes', 'No search-volume claims'],
  },
  {
    icon: Upload,
    eyebrow: 'Bring your data',
    title: 'Imported Ranking Data',
    description: 'Plan ranking views around CSV or provider exports instead of pretending SEOIntel has paid ranking feeds.',
    status: 'Import-only',
    points: ['CSV-friendly direction', 'Separated from audit results', 'No paid provider lock-in'],
    muted: true,
  },
  {
    icon: Link2,
    eyebrow: 'Bring your data',
    title: 'Imported Backlink Data',
    description: 'Backlink areas are framed for imported data until a real provider is intentionally added later.',
    status: 'Import-only',
    points: ['External data stays labeled', 'No fake backlink counts', 'Report-ready structure'],
    muted: true,
  },
  {
    icon: Layers,
    eyebrow: 'Roadmap',
    title: 'Competitor Compare',
    description: 'Competitor analysis remains a roadmap area until background worker support is available.',
    status: 'Coming soon',
    points: ['No serverless crawl loops', 'Worker-ready direction', 'Clear expectation setting'],
    muted: true,
  },
  {
    icon: Briefcase,
    eyebrow: 'Delivery',
    title: 'Reports',
    description: 'Create client-friendly audit summaries with top fixes first and technical details second.',
    status: 'Live',
    points: ['Executive summary', 'Fix priority cards', 'Printable report layout'],
  },
];

const freeTools: Array<{
  icon: IconType;
  title: string;
  description: string;
  href: string;
  label?: string;
}> = [
  {
    icon: Zap,
    title: 'Quick SEO Checker',
    description: 'Start a resource-light website scan and get a live fix list.',
    href: '#start-audit',
  },
  {
    icon: Search,
    title: 'Title and Description Checker',
    description: 'Review page titles, meta descriptions, and search preview length.',
    href: '#features',
  },
  {
    icon: Monitor,
    title: 'Google Preview Tool',
    description: 'Preview how a page title, URL, and description can look in search.',
    href: '#reports',
  },
  {
    icon: Activity,
    title: 'Redirect and URL Health Checker',
    description: 'Check status codes, redirects, and normalized URLs in plain language.',
    href: '#features',
  },
  {
    icon: ShieldCheck,
    title: 'Browser Safety Checker',
    description: 'Review HTTPS and public browser protection settings safely.',
    href: '#features',
  },
  {
    icon: Globe,
    title: 'Sitemap and Search Access Checker',
    description: 'Look for sitemap signals and search engine access rules.',
    href: '#features',
  },
];

const useCases = [
  {
    icon: Store,
    title: 'Small businesses',
    description: 'Find obvious website issues before spending time or money on campaigns.',
    outcomes: ['Plain-English fixes', 'Quick site health score', 'Simple report for owners'],
  },
  {
    icon: Users,
    title: 'Agencies and freelancers',
    description: 'Run client discovery audits and turn the findings into a clear scope of work.',
    outcomes: ['Top fixes first', 'Client-friendly language', 'Visual previews for handoff'],
  },
  {
    icon: BarChart3,
    title: 'Marketers',
    description: 'Check landing pages, campaign pages, and content pages before launch.',
    outcomes: ['Search preview review', 'Content structure checks', 'Priority-based backlog'],
  },
  {
    icon: Code2,
    title: 'Developers',
    description: 'See technical SEO and browser-safety signals without digging through raw page output.',
    outcomes: ['Status and redirect checks', 'Preferred page URL review', 'Browser protection notes'],
  },
  {
    icon: MapPin,
    title: 'Local site owners',
    description: 'Audit service pages, contact pages, and city pages with easy next actions.',
    outcomes: ['Mobile preview context', 'Metadata checks', 'Fast quick-audit workflow'],
  },
];

const planCards: Array<{
  title: string;
  price: string;
  description: string;
  features: string[];
  cta: string;
  href?: string;
  featured?: boolean;
  note: string;
}> = [
  {
    title: 'Free Quick Audit',
    price: '$0',
    description: 'Best for checking one public site quickly.',
    features: ['Lightweight website scan', 'Live audit progress', 'SEO and passive safety checks', 'One active free audit at a time'],
    cta: 'Start free audit',
    href: '#start-audit',
    note: 'Designed to stay fast and resource-light.',
  },
  {
    title: 'Paid Full Audit',
    price: 'Paid',
    description: 'For owners and teams that need deeper reporting.',
    features: ['Larger website scan limits', 'Priority processing when available', 'More detailed report sections', 'Export-friendly client summaries'],
    cta: 'Explore dashboard',
    featured: true,
    note: 'Uses the same worker-backed architecture with higher plan limits.',
  },
  {
    title: 'Agency / Admin',
    price: 'Scale',
    description: 'For managing many sites and monitoring the audit engine.',
    features: ['Admin queue visibility', 'User and plan controls', 'Audit diagnostics', 'Deep-audit-ready workflow'],
    cta: 'Review admin flow',
    note: 'Built around the current admin and plan behavior.',
  },
];

const resourcesColumns = [
  {
    title: 'Product',
    links: [
      { label: 'Website audit', href: '#features', description: 'SEO, website health, and passive safety checks.' },
      { label: 'Visual reports', href: '#reports', description: 'Desktop, mobile, and Google-style preview context.' },
      { label: 'Plans', href: '#pricing', description: 'Free, paid, and agency-ready audit paths.' },
    ],
  },
  {
    title: 'Free tools',
    links: [
      { label: 'Quick SEO Checker', href: '#start-audit', description: 'Run the live audit flow.' },
      { label: 'Google Preview Tool', href: '#free-tools', description: 'Review title and description snippets.' },
      { label: 'Browser Safety Checker', href: '#free-tools', description: 'Check public browser protection signals.' },
    ],
  },
  {
    title: 'Guides',
    links: [
      { label: 'Free vs full audits', href: '#pricing', description: 'Understand when to upgrade.' },
      { label: 'Passive safety checks', href: '#faq', description: 'What SEOIntel checks and what it does not do.' },
      { label: 'Imported data', href: '#features', description: 'How ranking and backlink data are kept honest.' },
    ],
  },
];

const faqs = [
  {
    question: 'Is this a full SEO suite already?',
    answer: 'The live website audit, visual previews, website health checks, and passive safety checks are the working core. Ranking and backlink sections are clearly framed as imported-data areas until real providers are added.',
  },
  {
    question: 'Does SEOIntel use paid SEO APIs or AI APIs?',
    answer: 'No. The current product focuses on deterministic checks, public website signals, and optional imported data. It does not depend on paid SEO APIs or AI APIs.',
  },
  {
    question: 'Does SEOIntel store raw HTML?',
    answer: 'No. The app stores audit jobs, events, page summaries, issues, and report data. Raw page HTML is not stored.',
  },
  {
    question: 'Are browser-safety checks invasive?',
    answer: 'No. They review public HTTPS and browser protection settings. SEOIntel does not exploit vulnerabilities, run penetration tests, or attack the site.',
  },
  {
    question: 'Why are some features labeled import-only or coming soon?',
    answer: 'That keeps the product honest. SEOIntel should show a strong suite direction without pretending to have paid ranking feeds, backlink databases, or competitor crawlers that have not been implemented.',
  },
];

export default function LandingPage({ onStartAudit, onExploreFeatures }: Props) {
  const [url, setUrl] = useState('');
  const [starting, setStarting] = useState(false);
  const auditStartGuardRef = useRef(createAuditSubmitGuard());

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!url.trim() || !auditStartGuardRef.current.begin()) return;

    setStarting(true);
    try {
      await onStartAudit(url);
    } finally {
      auditStartGuardRef.current.end();
      setStarting(false);
    }
  };

  return (
    <main className="w-full bg-background text-foreground">
      <section id="product" className="section-shell relative overflow-hidden pb-16 pt-12 md:pb-24 md:pt-20">
        <div className="absolute inset-x-4 top-8 -z-10 h-80 rounded-[3rem] bg-gradient-to-br from-accent/12 via-emerald-500/10 to-transparent blur-3xl" />

        <div className="grid items-center gap-10 lg:grid-cols-[1.02fr_0.98fr]">
          <div className="space-y-8">
            <nav className="flex flex-wrap gap-2 text-sm" aria-label="Homepage sections">
              <a href="#features" className="quiet-button px-3 py-1.5">Features</a>
              <a href="#free-tools" className="quiet-button px-3 py-1.5">Free tools</a>
              <a href="#use-cases" className="quiet-button px-3 py-1.5">Use cases</a>
              <a href="#pricing" className="quiet-button px-3 py-1.5">Pricing</a>
            </nav>

            <div className="space-y-5">
              <StatusBadge tone="accent">Live SEO suite for practical website checks</StatusBadge>
              <h1 className="max-w-4xl text-4xl font-bold leading-tight md:text-6xl">
                Find SEO, website health, and browser-safety issues before they cost you leads.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
                SEOIntel combines resource-light live audits, visual previews, plain-English fix guidance, and honest imported-data areas for teams that need clarity without heavy services.
              </p>
            </div>

            <form id="start-audit" onSubmit={handleSubmit} className="trust-card p-2" aria-label="Start a free website audit">
              <div className="flex flex-col gap-2 md:flex-row">
                <label className="flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-muted/60 px-4 py-3">
                  <Globe className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="sr-only">Website URL</span>
                  <input
                    type="text"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="example.com"
                    className="w-full bg-transparent text-lg outline-none placeholder:text-muted-foreground/60"
                    required
                  />
                </label>
                <button type="submit" disabled={starting || !url.trim()} className="trust-button px-6 py-3">
                  {starting ? 'Starting audit...' : 'Start free audit'}
                  <ArrowRight className="h-5 w-5" />
                </button>
              </div>
            </form>

            <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
              {trustBullets.map((text) => (
                <TrustBullet key={text} text={text} />
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={onExploreFeatures} className="quiet-button">
                Open product dashboard
              </button>
              <a href="#reports" className="quiet-button">
                View report preview
              </a>
            </div>
          </div>

          <ProductSuitePreview />
        </div>
      </section>

      <section id="features" className="section-shell py-16 md:py-20">
        <SectionHeader
          eyebrow="Feature suite"
          title="A fuller SEO platform shape, with honest feature boundaries."
          description="SEOIntel presents a complete suite direction while keeping the working product clear: live audits, visual previews, website health, passive safety checks, and import-ready data areas."
          action={<StatusBadge tone="success">No fake data claims</StatusBadge>}
        />
        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {suiteFeatures.map((feature) => (
            <FeatureSuiteCard key={feature.title} {...feature} />
          ))}
        </div>
      </section>

      <section id="free-tools" className="border-y border-border bg-muted/30 py-16 md:py-20">
        <div className="section-shell">
          <SectionHeader
            eyebrow="Free tools"
            title="Useful single-purpose checks for people who are not ready for a full workflow."
            description="These tools route visitors toward current SEOIntel capabilities instead of promising unsupported ranking, traffic, or backlink data."
          />
          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {freeTools.map((tool) => (
              <ToolCard key={tool.title} {...tool} />
            ))}
          </div>
        </div>
      </section>

      <section id="use-cases" className="section-shell py-16 md:py-20">
        <SectionHeader
          eyebrow="Use cases"
          title="Built for people who need answers, not another technical maze."
          description="Different users can enter through the same quick audit and read the results at the level they need."
        />
        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
          {useCases.map((useCase) => (
            <UseCaseCard key={useCase.title} {...useCase} />
          ))}
        </div>
      </section>

      <section id="reports" className="section-shell py-16 md:py-20">
        <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr]">
          <div className="space-y-5">
            <StatusBadge tone="success">Visual report workflow</StatusBadge>
            <h2 className="text-3xl font-bold md:text-4xl">Start with the answer, then show the evidence.</h2>
            <p className="text-muted-foreground">
              Reports lead with an executive summary, top fixes, and visual page context. Technical details stay available for developers without overwhelming business users.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCard label="Overall health" value="84" detail="Sample score display" icon={<Gauge className="h-6 w-6" />} tone="green" />
              <MetricCard label="Top fixes" value="12" detail="Sorted by fix priority" icon={<Wrench className="h-6 w-6" />} tone="yellow" />
            </div>
            <SeverityStack critical={3} high={6} medium={12} low={8} />
            <SurfaceCard className="p-5">
              <h3 className="text-lg font-bold">Plain-English report sections</h3>
              <div className="mt-4 grid gap-3">
                {['What happened', 'Why it matters', 'How to fix it', 'Technical detail if needed'].map((item) => (
                  <div key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </SurfaceCard>
          </div>
          <SitePreviewSection
            url="https://example.com"
            hostname="example.com"
            title="Example Brand - Services, Pricing, and Local Trust"
            description="A clear preview helps users understand what was checked before they read technical details."
          />
        </div>
      </section>

      <section id="pricing" className="border-y border-border bg-muted/30 py-16 md:py-20">
        <div className="section-shell">
          <div className="mb-10 text-center">
            <div className="text-sm font-bold uppercase tracking-[0.18em] text-accent">Pricing</div>
            <h2 className="mt-3 text-3xl font-bold md:text-4xl">Start free, then unlock deeper audits when you need them.</h2>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
              The plan language matches the current free, paid, and admin behavior while keeping resource usage under control.
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {planCards.map((plan) => (
              <PricingCard
                key={plan.title}
                title={plan.title}
                price={plan.price}
                description={plan.description}
                features={plan.features}
                featured={plan.featured}
                note={plan.note}
                cta={
                  plan.href ? (
                    <a href={plan.href} className="trust-button w-full justify-center">
                      {plan.cta}
                    </a>
                  ) : (
                    <button type="button" onClick={onExploreFeatures} className="trust-button w-full justify-center">
                      {plan.cta}
                    </button>
                  )
                }
              />
            ))}
          </div>
        </div>
      </section>

      <section id="resources" className="section-shell py-16 md:py-20">
        <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr]">
          <div>
            <div className="text-sm font-bold uppercase tracking-[0.18em] text-accent">Resources</div>
            <h2 className="mt-3 text-3xl font-bold md:text-4xl">Make the product feel complete without making unsupported promises.</h2>
            <p className="mt-3 text-muted-foreground">
              Resource links are organized like a real SEO suite, but each item points to actual audit features, free checks, or honest setup guidance.
            </p>
          </div>
          <MegaMenuPanel columns={resourcesColumns} />
        </div>
      </section>

      <section className="section-shell py-16 md:py-20">
        <SectionHeader
          eyebrow="How it works"
          title="The audit stays live without running crawler loops inside Vercel requests."
          description="Vercel handles the frontend and lightweight API routes. The separate audit engine performs the scan and writes progress so users can see what is happening."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-4">
          {[
            { title: 'Enter a URL', text: 'Start with any public website URL.', icon: Globe },
            { title: 'Queue the audit', text: 'The request creates a safe job instead of crawling inside the page request.', icon: Layers },
            { title: 'Scan in the audit engine', text: 'The worker checks pages and writes live progress events.', icon: Activity },
            { title: 'Review the report', text: 'See top fixes, previews, and technical details when needed.', icon: FileText },
          ].map((step, index) => {
            const StepIcon = step.icon;
            return (
              <SurfaceCard key={step.title} className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">{index + 1}</div>
                  <StepIcon className="h-5 w-5 text-accent" />
                </div>
                <h3 className="text-lg font-bold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.text}</p>
              </SurfaceCard>
            );
          })}
        </div>
      </section>

      <section id="faq" className="section-shell pb-20">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <div className="text-sm font-bold uppercase tracking-[0.18em] text-accent">FAQ</div>
            <h2 className="mt-3 text-3xl font-bold md:text-4xl">Clear expectations before someone starts.</h2>
          </div>
          <div className="space-y-3">
            {faqs.map((faq) => (
              <FaqItem key={faq.question} {...faq} />
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border bg-card/70">
        <div className="section-shell grid gap-8 py-10 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div>
            <div className="text-xl font-bold">SEO<span className="text-accent">Intel</span></div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Visual SEO, website health, and passive browser-safety audits with a resource-light architecture.
            </p>
          </div>
          <FooterLinks title="Product" links={[['Features', '#features'], ['Reports', '#reports'], ['Pricing', '#pricing']]} />
          <FooterLinks title="Free tools" links={[['Quick SEO Checker', '#start-audit'], ['Google Preview Tool', '#free-tools'], ['Browser Safety Checker', '#free-tools']]} />
          <FooterLinks title="Resources" links={[['Use cases', '#use-cases'], ['Guides', '#resources'], ['FAQ', '#faq']]} />
        </div>
      </footer>
    </main>
  );
}

function ProductSuitePreview() {
  return (
    <SurfaceCard className="overflow-hidden">
      <div className="border-b border-border bg-muted/40 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-red-400" />
            <span className="h-3 w-3 rounded-full bg-amber-400" />
            <span className="h-3 w-3 rounded-full bg-emerald-400" />
          </div>
          <span className="rounded-full bg-background px-3 py-1 text-xs font-semibold text-muted-foreground">SEOIntel suite preview</span>
        </div>
      </div>
      <div className="grid gap-4 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <MiniScore icon={Gauge} label="Site score" value="84" tone="text-emerald-600" />
          <MiniScore icon={Search} label="SEO fixes" value="12" tone="text-amber-600" />
          <MiniScore icon={ShieldCheck} label="Safety" value="A-" tone="text-emerald-600" />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_0.78fr]">
          <div className="rounded-2xl border border-border bg-background p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Monitor className="h-4 w-4 text-accent" /> Live audit workspace
            </div>
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="h-3 w-28 rounded bg-foreground/75" />
                    <div className="mt-2 h-2 w-20 rounded bg-muted-foreground/30" />
                  </div>
                </div>
                <div className="h-8 w-20 rounded-full bg-accent/20" />
              </div>
              <div className="grid gap-4 md:grid-cols-[1fr_0.8fr]">
                <div>
                  <div className="h-5 w-3/4 rounded bg-foreground/80" />
                  <div className="mt-3 h-3 w-full rounded bg-muted-foreground/30" />
                  <div className="mt-2 h-3 w-5/6 rounded bg-muted-foreground/30" />
                  <div className="mt-5 h-9 w-32 rounded-xl bg-accent" />
                </div>
                <div className="rounded-xl bg-gradient-to-br from-accent/20 to-emerald-500/20 p-4">
                  <Lock className="mb-8 h-5 w-5 text-accent" />
                  <div className="h-3 w-24 rounded bg-foreground/50" />
                  <div className="mt-2 h-2 w-16 rounded bg-muted-foreground/30" />
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Smartphone className="h-4 w-4 text-accent" /> Preview stack
            </div>
            <div className="space-y-3">
              <div className="mx-auto w-36 rounded-[1.6rem] border-4 border-foreground/80 bg-card p-2">
                <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-muted-foreground/40" />
                <div className="rounded-xl bg-muted p-3">
                  <div className="mb-3 h-7 w-7 rounded-lg bg-accent/20" />
                  <div className="h-3 w-full rounded bg-foreground/80" />
                  <div className="mt-2 h-2 w-5/6 rounded bg-muted-foreground/30" />
                  <div className="mt-3 h-7 rounded-lg bg-accent" />
                </div>
              </div>
              <div className="rounded-xl border border-border bg-white p-3 text-slate-900 shadow-sm dark:bg-white">
                <div className="text-xs text-slate-600">example.com</div>
                <div className="mt-1 text-sm font-medium text-blue-700">Example page title preview</div>
                <p className="mt-1 text-xs leading-5 text-slate-600">See how a page may appear before customers click.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {['Website scan running', 'Top fixes sorted', 'Passive safety reviewed'].map((item) => (
            <div key={item} className="rounded-2xl border border-border bg-background p-3 text-sm font-semibold text-muted-foreground">
              <CheckCircle2 className="mb-2 h-4 w-4 text-emerald-600" />
              {item}
            </div>
          ))}
        </div>
      </div>
    </SurfaceCard>
  );
}

function TrustBullet({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
      <span>{text}</span>
    </div>
  );
}

function MiniScore({ icon: Icon, label, value, tone }: { icon: IconType; label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <Icon className="mb-3 h-5 w-5 text-accent" />
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="trust-card group p-5">
      <summary className="cursor-pointer list-none font-semibold">
        <span className="flex items-center justify-between gap-4">
          {question}
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        </span>
      </summary>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{answer}</p>
    </details>
  );
}

function FooterLinks({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div>
      <h3 className="font-bold">{title}</h3>
      <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
        {links.map(([label, href]) => (
          <a key={`${label}-${href}`} href={href} className="hover:text-foreground">
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}
