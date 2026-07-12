import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Briefcase,
  CheckCircle2,
  Code2,
  CreditCard,
  Download,
  FileText,
  Gauge,
  Globe,
  Layers,
  Link2,
  MapPin,
  Monitor,
  Search,
  Smartphone,
  ShieldCheck,
  Store,
  Upload,
  Users,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import { createAuditSubmitGuard } from '../lib/api/audit-submit-guard';
import {
  CategoryScoreBar,
  FeatureProofCard,
  FeatureSuiteCard,
  MegaMenuPanel,
  PricingCard,
  RadialScoreGauge,
  SectionHeader,
  SeverityBadge,
  SeverityDistribution,
  StatusBadge,
  SurfaceCard,
  ToolCard,
} from './ui/visual-system';

interface Props {
  onStartAudit: (url: string) => Promise<void> | void;
  onExploreFeatures: () => void;
  onNavigate: (destination: LandingDestination) => void;
}

type IconType = React.ComponentType<{ className?: string }>;
export type LandingDestination =
  | 'dashboard'
  | 'website-analyzer'
  | 'seo-audit'
  | 'security-audit'
  | 'reports'
  | 'imports'
  | 'rank-tracker'
  | 'search-data'
  | 'keyword-research'
  | 'start-audit';

const credibilityBadges: Array<{ icon: IconType; title: string; description: string }> = [
  { icon: BarChart3, title: 'No fake data', description: 'Ranking, traffic, backlink, and search-volume values are never invented.' },
  { icon: ShieldCheck, title: 'Passive security only', description: 'Checks use public signals without probing, exploitation, or attack payloads.' },
  { icon: CheckCircle2, title: 'Your data stays focused', description: 'SEOIntel stores findings and page summaries, never complete raw HTML.' },
  { icon: Zap, title: 'Actionable live reports', description: 'Realtime progress leads to prioritized fixes and export-ready evidence.' },
];

const featureHighlights = [
  {
    icon: Search,
    title: 'SEO Audit',
    description: 'Find search visibility issues that affect how pages are understood and shown.',
    checks: ['Title and meta description checks', 'Heading and image alt review', 'Google-style SERP preview'],
    cta: 'Open SEO audit',
    action: 'seo-audit' as LandingDestination,
  },
  {
    icon: Gauge,
    title: 'Technical SEO',
    description: 'Review crawlability, redirects, response signals, and access rules in plain language.',
    checks: ['Status codes and redirects', 'Robots and sitemap signals', 'Page size and response timing'],
    cta: 'Open website scan',
    action: 'website-analyzer' as LandingDestination,
  },
  {
    icon: ShieldCheck,
    title: 'Passive Security',
    description: 'Review public browser protection signals without scans that attack or exploit the site.',
    checks: ['HTTPS and HSTS review', 'CSP and frame protection', 'Mixed-content warning signals'],
    cta: 'Open safety check',
    action: 'security-audit' as LandingDestination,
  },
  {
    icon: Zap,
    title: 'Performance',
    description: 'Understand observed response time, page size, and resource signals.',
    checks: ['Response timing', 'Page weight observations', 'Resource counts'],
    cta: 'Open performance checks',
    action: 'website-analyzer' as LandingDestination,
  },
  {
    icon: FileText,
    title: 'Reports',
    description: 'Turn audit findings into executive summaries, previews, and top-fix lists.',
    checks: ['Overall and category scores', 'Fix priority distribution', 'PDF and data exports'],
    cta: 'Open reports',
    action: 'reports' as LandingDestination,
  },
];

const auditCheckGroups: Array<{ title: string; description: string; icon: IconType; checks: string[] }> = [
  {
    title: 'SEO checks',
    description: 'Metadata and content signals that shape search snippets and page understanding.',
    icon: Search,
    checks: ['Title tag', 'Meta description', 'Preferred page URL', 'Headings', 'Image alt text', 'Internal links', 'Open Graph/social metadata', 'SERP snippet preview'],
  },
  {
    title: 'Technical SEO checks',
    description: 'Public technical signals that affect access, crawling, and page health.',
    icon: Gauge,
    checks: ['Status codes', 'Redirects', 'Robots/sitemap signals', 'Crawlability', 'Can Google index this page?', 'Page size', 'Response timing', 'Mobile viewport'],
  },
  {
    title: 'Passive security checks',
    description: 'Non-invasive security observations from public response signals.',
    icon: ShieldCheck,
    checks: ['HTTPS', 'HSTS', 'CSP', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Insecure form warning when detected', 'Mixed content warning when detected'],
  },
];

const suiteFeatures: Array<{
  icon: IconType;
  eyebrow: string;
  title: string;
  description: string;
  status: string;
  points: string[];
  cta: string;
  action: LandingDestination;
  muted?: boolean;
}> = [
  {
    icon: Search,
    eyebrow: 'Working product',
    title: 'Website Audit',
    description: 'Run a live website scan that checks public pages and turns findings into clear next steps.',
    status: 'Live',
    points: ['Titles and descriptions', 'Headings and page structure', 'Internal links and image descriptions'],
    cta: 'Run website audit',
    action: 'website-analyzer',
  },
  {
    icon: Monitor,
    eyebrow: 'Visual report',
    title: 'Google-style Preview',
    description: 'See desktop, mobile, and search result previews near the executive summary.',
    status: 'Live',
    points: ['SERP snippet preview', 'Mobile preview concept', 'Desktop report context'],
    cta: 'Open reports',
    action: 'reports',
  },
  {
    icon: Gauge,
    eyebrow: 'Website health',
    title: 'Website Health',
    description: 'Find redirects, slow responses, oversized pages, status codes, and confusing page signals.',
    status: 'Live',
    points: ['Status code review', 'Redirect and URL health', 'Resource and page-size signals'],
    cta: 'Open website scan',
    action: 'website-analyzer',
  },
  {
    icon: ShieldCheck,
    eyebrow: 'Passive safety',
    title: 'Passive Security Review',
    description: 'Review public HTTPS and browser protection settings without probing or attacking the site.',
    status: 'Live',
    points: ['HTTPS checks', 'Browser security protections', 'Non-invasive only'],
    cta: 'Start passive review',
    action: 'security-audit',
  },
  {
    icon: FileText,
    eyebrow: 'Content workflow',
    title: 'Keyword and Content Tools',
    description: 'Use deterministic content checks and add your own keyword notes where external data is needed.',
    status: 'Import-ready',
    points: ['Content structure checks', 'Manual keyword notes', 'No search-volume claims'],
    cta: 'Open keyword tools',
    action: 'keyword-research',
  },
  {
    icon: Upload,
    eyebrow: 'Bring your data',
    title: 'Imported Ranking Data',
    description: 'Plan ranking views around CSV or provider exports instead of pretending SEOIntel has paid ranking feeds.',
    status: 'Import-only',
    points: ['CSV-friendly direction', 'Separated from audit results', 'No paid provider lock-in'],
    cta: 'Open imports',
    action: 'rank-tracker',
    muted: true,
  },
  {
    icon: Link2,
    eyebrow: 'Bring your data',
    title: 'Imported Backlink Data',
    description: 'Backlink areas are framed for imported data until a real provider is intentionally added later.',
    status: 'Import-only',
    points: ['External data stays labeled', 'No fake backlink counts', 'Report-ready structure'],
    cta: 'Open imports',
    action: 'imports',
    muted: true,
  },
  {
    icon: Layers,
    eyebrow: 'Roadmap',
    title: 'Competitor Compare',
    description: 'Competitor analysis remains a roadmap area until background worker support is available.',
    status: 'Coming soon',
    points: ['No serverless scan loops', 'Background audit processing', 'Clear expectation setting'],
    cta: 'Open dashboard',
    action: 'dashboard',
    muted: true,
  },
  {
    icon: Briefcase,
    eyebrow: 'Delivery',
    title: 'Reports',
    description: 'Create client-friendly audit summaries with top fixes first and technical details second.',
    status: 'Live',
    points: ['Executive summary', 'Fix priority cards', 'Printable report layout'],
    cta: 'Open reports',
    action: 'reports',
  },
];

const freeTools: Array<{
  icon: IconType;
  title: string;
  description: string;
  label?: string;
  cta?: string;
  action: LandingDestination;
  group: 'On-page SEO' | 'Technical SEO' | 'Passive Security' | 'Import-ready data';
}> = [
  {
    icon: Zap,
    title: 'Quick SEO Checker',
    description: 'Start a resource-light website scan and get a live fix list.',
    action: 'start-audit',
    cta: 'Start quick audit',
    label: 'Live',
    group: 'On-page SEO',
  },
  {
    icon: Search,
    title: 'Title and Description Checker',
    description: 'Review page titles, meta descriptions, and search preview length.',
    action: 'website-analyzer',
    cta: 'Open website scan',
    label: 'Live',
    group: 'On-page SEO',
  },
  {
    icon: Monitor,
    title: 'Google Preview Tool',
    description: 'Preview how a page title, URL, and description can look in search.',
    action: 'reports',
    cta: 'Open report preview',
    label: 'Live',
    group: 'On-page SEO',
  },
  {
    icon: Gauge,
    title: 'Technical SEO Checker',
    description: 'Review status codes, redirects, access rules, response timing, and page-size signals.',
    action: 'website-analyzer',
    cta: 'Open technical scan',
    label: 'Live',
    group: 'Technical SEO',
  },
  {
    icon: Activity,
    title: 'Redirect and URL Health Checker',
    description: 'Check status codes, redirects, and normalized URLs in plain language.',
    action: 'website-analyzer',
    cta: 'Open URL checker',
    label: 'Live',
    group: 'Technical SEO',
  },
  {
    icon: Globe,
    title: 'Sitemap and Search Access Checker',
    description: 'Look for sitemap signals and search engine access rules.',
    action: 'website-analyzer',
    cta: 'Open scan tools',
    label: 'Live',
    group: 'Technical SEO',
  },
  {
    icon: ShieldCheck,
    title: 'Passive Security Checker',
    description: 'Review HTTPS and public browser protection settings safely.',
    action: 'security-audit',
    cta: 'Open safety checker',
    label: 'Live',
    group: 'Passive Security',
  },
  {
    icon: FileText,
    title: 'Keyword Notes Workspace',
    description: 'Bring your own keyword data. SEOIntel does not invent search volume or CPC.',
    action: 'keyword-research',
    cta: 'Open keyword tools',
    label: 'Import-ready',
    group: 'Import-ready data',
  },
  {
    icon: BarChart3,
    title: 'Ranking Data Import',
    description: 'Provider export required. No fake Google ranking positions are shown.',
    action: 'rank-tracker',
    cta: 'Open ranking imports',
    label: 'Provider required',
    group: 'Import-ready data',
  },
  {
    icon: Link2,
    title: 'Backlink Data Import',
    description: 'Import backlink exports later instead of pretending to own a backlink database.',
    action: 'imports',
    cta: 'Open data imports',
    label: 'Provider required',
    group: 'Import-ready data',
  },
];

const useCases = [
  {
    icon: Store,
    title: 'Small businesses',
    description: 'Find obvious website issues before spending time or money on campaigns.',
    outcomes: ['Plain-English fixes', 'Quick site health score', 'Simple report for owners'],
    action: 'start-audit' as LandingDestination,
  },
  {
    icon: Users,
    title: 'Agencies and freelancers',
    description: 'Run client discovery audits and turn the findings into a clear scope of work.',
    outcomes: ['Top fixes first', 'Client-friendly language', 'Visual previews for handoff'],
    action: 'reports' as LandingDestination,
  },
  {
    icon: BarChart3,
    title: 'Marketers',
    description: 'Check landing pages, campaign pages, and content pages before launch.',
    outcomes: ['Search preview review', 'Content structure checks', 'Priority-based backlog'],
    action: 'keyword-research' as LandingDestination,
  },
  {
    icon: Code2,
    title: 'Developers',
    description: 'See technical SEO and passive security signals without digging through raw page output.',
    outcomes: ['Status and redirect checks', 'Preferred page URL review', 'Browser protection notes'],
    action: 'website-analyzer' as LandingDestination,
  },
  {
    icon: MapPin,
    title: 'Local site owners',
    description: 'Audit service pages, contact pages, and city pages with easy next actions.',
    outcomes: ['Mobile preview context', 'Metadata checks', 'Fast quick-audit workflow'],
    action: 'start-audit' as LandingDestination,
  },
];

const planCards: Array<{
  title: string;
  price: string;
  description: string;
  features: string[];
  cta: string;
  action: LandingDestination;
  featured?: boolean;
  note: string;
}> = [
  {
    title: 'Free Quick Audit',
    price: '$0',
    description: 'Best for checking one public site quickly.',
    features: ['Quick 5-page scan', '3 daily / 30 monthly audits', 'SEO and passive safety checks', 'One active free audit at a time'],
    cta: 'Start free audit',
    action: 'start-audit',
    note: 'Designed to stay fast and resource-light.',
  },
  {
    title: 'Paid Full Audit',
    price: 'Paid',
    description: 'For owners and teams that need deeper reporting.',
    features: ['Standard 25-page scan', '25 daily / 500 monthly audits', 'Higher queue priority', 'Export-friendly client summaries'],
    cta: 'Explore dashboard',
    action: 'dashboard',
    featured: true,
    note: 'Uses the same worker-backed architecture with higher plan limits.',
  },
  {
    title: 'Agency / Admin',
    price: 'Scale',
    description: 'For managing many sites and monitoring the audit engine.',
    features: ['Agency deep-ready scans when the worker supports them', 'Admin queue visibility', 'User and plan controls', 'Audit diagnostics'],
    cta: 'Open reports',
    action: 'reports',
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
      { label: 'Passive Security Review', href: '#free-tools', description: 'Review public browser protection signals.' },
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
    question: 'Does SEOIntel use AI?',
    answer: 'The audit engine does not use AI for scores or findings. Administrators can optionally use Gemini to create review-only blog drafts; generated drafts are never published automatically.',
  },
  {
    question: 'Does the audit depend on paid SEO data APIs?',
    answer: 'No. Audits use deterministic checks, public website signals, and optional imported data. SEOIntel does not invent ranking, traffic, backlink, or search-volume values.',
  },
  {
    question: 'Does SEOIntel show real Google rankings?',
    answer: 'Not unless ranking data is imported from a real provider/export. SEOIntel does not fake SERP positions, traffic, domain authority, search volume, or CPC.',
  },
  {
    question: 'Does SEOIntel store raw HTML?',
    answer: 'No. The app stores audit jobs, events, page summaries, issues, and report data. Raw page HTML is not stored.',
  },
  {
    question: 'Is the Passive Security Review invasive?',
    answer: 'No. They review public HTTPS and browser protection settings. SEOIntel does not exploit vulnerabilities, run penetration tests, or attack the site.',
  },
  {
    question: 'Why are some features labeled import-only or coming soon?',
    answer: 'That keeps the product honest. SEOIntel should show a strong suite direction without pretending to have paid ranking feeds, backlink databases, or competitor crawlers that have not been implemented.',
  },
  {
    question: 'What does Free include?',
    answer: 'Free users get lightweight quick audits, live progress, basic SEO checks, passive safety checks, and one active audit at a time.',
  },
  {
    question: 'What does Paid Full Audit include?',
    answer: 'Paid users unlock standard full audits with larger page limits, higher queue priority, richer report sections, and export-friendly summaries.',
  },
  {
    question: 'Why is deep audit limited by worker capability?',
    answer: 'Deep audits need always-on audit engine capacity. SEOIntel does not run long crawler loops inside Vercel API routes.',
  },
  {
    question: 'Can I import ranking or backlink data?',
    answer: 'Yes, the product direction is import-ready/provider-ready. Any imported data must come from a real export or provider, not generated placeholders.',
  },
];

export default function LandingPage({ onStartAudit, onExploreFeatures, onNavigate }: Props) {
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
      <section id="product" className="relative overflow-hidden border-b border-border bg-card">
        <div className="hero-grid pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute -right-24 top-10 h-[34rem] w-[44rem] rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-500/5" />
        <div className="section-shell relative py-12 sm:py-16 lg:py-20">
          <div className="grid items-center gap-12 lg:grid-cols-[0.82fr_1.18fr] xl:gap-16">
            <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="min-w-0">
              <StatusBadge tone="success">Worker-backed live audits</StatusBadge>
              <h1 className="mt-6 max-w-2xl text-4xl font-bold leading-[1.08] sm:text-5xl lg:text-[3.55rem]">
                Find SEO issues. Fix what matters.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                Audit on-page SEO, technical delivery, performance observations, and passive browser security in one clear, prioritized report.
              </p>

              <form id="start-audit" onSubmit={handleSubmit} className="mt-8 flex max-w-xl flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-[0_12px_32px_-22px_rgba(49,104,245,0.55)] sm:flex-row" aria-label="Start a free website audit">
                <label className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">
                  <Globe className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="sr-only">Website URL</span>
                  <input type="text" inputMode="url" autoComplete="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Enter your website URL" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--subtle-foreground)]" required />
                </label>
                <button type="submit" disabled={starting || !url.trim()} className="trust-button min-w-40 px-5">
                  {starting ? 'Starting audit...' : 'Audit my website'}
                  {!starting && <ArrowRight className="h-4 w-4" />}
                </button>
              </form>

              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2"><CreditCard className="h-4 w-4 text-emerald-600" /> No credit card</span>
                <span className="inline-flex items-center gap-2"><Activity className="h-4 w-4 text-accent" /> Realtime progress</span>
                <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-violet-600" /> Passive checks</span>
              </div>

              <div className="mt-7 flex flex-wrap gap-3">
                <button type="button" onClick={onExploreFeatures} className="quiet-button">Open dashboard</button>
                <button type="button" onClick={() => onNavigate('reports')} className="inline-flex items-center gap-2 px-2 py-2 text-sm font-semibold text-accent hover:underline">View report experience <ArrowRight className="h-4 w-4" /></button>
              </div>
            </motion.div>

            <HeroAuditDashboard onOpenIssues={() => onNavigate('reports')} onDownload={() => onNavigate('reports')} />
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-background">
        <div className="section-shell grid gap-px py-8 sm:grid-cols-2 lg:grid-cols-4">
          {credibilityBadges.map((badge) => <CredibilityBadge key={badge.title} {...badge} />)}
        </div>
      </section>

      <section id="features" className="scroll-mt-24 border-y border-border bg-muted/30 py-16 md:py-20">
        <div className="section-shell">
          <SectionHeader
            eyebrow="Core product"
            title="Everything you need in one clear audit."
            description="Review search visibility, website health, passive browser protections, performance signals, and client-ready reports without invented data."
          />
          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {featureHighlights.map((feature) => (
              <FeatureProofCard
                key={feature.title}
                icon={feature.icon}
                title={feature.title}
                description={feature.description}
                checks={feature.checks}
                cta={
                  <button type="button" onClick={() => onNavigate(feature.action)} className="text-sm font-bold text-accent hover:underline">
                    {feature.cta}
                  </button>
                }
              />
            ))}
          </div>
        </div>
      </section>

      <section id="suite-features" className="section-shell scroll-mt-24 py-16 md:py-20">
        <SectionHeader
          eyebrow="Feature suite"
          title="A fuller SEO platform shape, with honest feature boundaries."
          description="SEOIntel presents a complete suite direction while keeping the working product clear: live audits, visual previews, website health, passive safety checks, and import-ready data areas."
          action={<StatusBadge tone="success">No fake data claims</StatusBadge>}
        />
        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {suiteFeatures.map((feature) => (
            <FeatureSuiteCard
              key={feature.title}
              icon={feature.icon}
              eyebrow={feature.eyebrow}
              title={feature.title}
              description={feature.description}
              status={feature.status}
              points={feature.points}
              muted={feature.muted}
              cta={
                <button type="button" onClick={() => onNavigate(feature.action)} className="quiet-button w-full justify-center">
                  {feature.cta}
                </button>
              }
            />
          ))}
        </div>
      </section>

      <section id="audit-checks" className="section-shell py-16 md:py-20">
        <SectionHeader
          eyebrow="What the audit checks"
          title="Specific checks people understand before they click."
          description="SEOIntel keeps technical detail available, but the first layer uses plain terms and fix-oriented language."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {auditCheckGroups.map((group) => (
            <AuditCheckGroup key={group.title} {...group} />
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
          <div className="mt-10 grid gap-6 xl:grid-cols-2">
            {(['On-page SEO', 'Technical SEO', 'Passive Security', 'Import-ready data'] as const).map((group) => (
              <ToolGroup key={group} title={group} tools={freeTools.filter((tool) => tool.group === group)} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      </section>

      <section id="use-cases" className="section-shell py-16 md:py-20">
        <AudienceSection onNavigate={onNavigate} />
      </section>

      <section id="reports" className="border-y border-border bg-muted/20 py-16 md:py-20">
        <div className="section-shell">
          <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
            <div>
              <StatusBadge tone="success">Visual report workflow</StatusBadge>
              <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">Reports should lead to decisions, not more technical clutter.</h2>
            </div>
            <p className="max-w-3xl text-base leading-7 text-muted-foreground md:text-lg">
              SEOIntel now leads with score context, top fixes, page previews, and clear ranking-data status. Technical detail is still available, but the first view is built for fast decisions on desktop and mobile.
            </p>
          </div>
          <ReportShowcase onNavigate={onNavigate} />
        </div>
      </section>

      <section id="pricing" className="border-y border-border bg-muted/30 py-16 md:py-20">
        <div className="section-shell">
          <div className="mb-10 text-center">
            <div className="text-sm font-bold uppercase tracking-wider text-accent">Pricing</div>
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
                  <button type="button" onClick={() => onNavigate(plan.action)} className="trust-button w-full justify-center">
                    {plan.cta}
                  </button>
                }
              />
            ))}
          </div>
          <PricingComparisonTable />
        </div>
      </section>

      <section id="resources" className="section-shell py-16 md:py-20">
        <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr]">
          <div>
            <div className="text-sm font-bold uppercase tracking-wider text-accent">Resources</div>
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
            <div className="text-sm font-bold uppercase tracking-wider text-accent">FAQ</div>
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
              Visual SEO, website health, and Passive Security Review reports with a resource-light architecture.
            </p>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Safety note: passive checks only. SEOIntel does not run exploit tests, store raw HTML, or invent ranking/backlink data.
            </p>
          </div>
          <FooterLinks title="Product" links={[['Features', '#features'], ['Reports', '#reports'], ['Pricing', '#pricing']]} />
          <FooterLinks title="Free tools" links={[['Quick SEO Checker', '#start-audit'], ['Google Preview Tool', '#free-tools'], ['Passive Security Review', '#free-tools']]} />
          <FooterLinks title="Resources" links={[['SEOIntel blog', '/blog'], ['Use cases', '#use-cases'], ['FAQ', '#faq'], ['Audit safety', '#audit-checks']]} />
        </div>
      </footer>
    </main>
  );
}

function HeroAuditDashboard({ onOpenIssues, onDownload }: { onOpenIssues: () => void; onDownload: () => void }) {
  const phases = [
    { label: 'Checking page titles', progress: 34 },
    { label: 'Reviewing search access', progress: 58 },
    { label: 'Checking browser protections', progress: 76 },
    { label: 'Prioritizing fixes', progress: 92 },
  ];
  const [phaseIndex, setPhaseIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setPhaseIndex((current) => (current + 1) % phases.length), 2600);
    return () => window.clearInterval(timer);
  }, [phases.length]);

  const phase = phases[phaseIndex];
  return (
    <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.55, delay: 0.08 }} className="relative min-w-0">
      <div className="absolute -inset-6 -z-10 rounded-full bg-blue-500/10 blur-3xl" />
      <div className="overflow-hidden rounded-xl border border-blue-200/80 bg-card shadow-[0_24px_70px_-38px_rgba(30,64,175,0.55)] dark:border-blue-400/20">
        <div className="grid sm:grid-cols-[3.5rem_minmax(0,1fr)]">
          <aside className="hidden bg-[#071840] px-2 py-4 text-blue-100 sm:flex sm:flex-col sm:items-center">
            <ShieldCheck className="h-6 w-6 text-blue-300" />
            <div className="mt-8 grid gap-3">
              {[Activity, Monitor, BarChart3, FileText, ShieldCheck].map((Icon, index) => <span key={index} className={`flex h-9 w-9 items-center justify-center rounded-lg ${index === 0 ? 'bg-blue-600 text-white' : 'text-blue-200/70'}`}><Icon className="h-4 w-4" /></span>)}
            </div>
          </aside>

          <div className="relative min-w-0 p-3 sm:p-4">
            <div className="motion-scan-line pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-blue-500/50" />
            <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-semibold text-muted-foreground">Interactive report preview</div>
                <div className="mt-0.5 font-semibold">Overview: example.com</div>
              </div>
              <button type="button" onClick={onDownload} className="quiet-button min-h-9 px-3 py-1.5 text-xs"><Download className="h-3.5 w-3.5" /> Download report</button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-[1.15fr_repeat(4,0.72fr)]">
              <div className="row-span-2 rounded-lg border border-border bg-background p-3 lg:row-span-1">
                <RadialScoreGauge value={86} label="Overall score" detail="Example audit result" size="sm" />
              </div>
              {[['SEO', 88, 'Good'], ['Technical', 84, 'Good'], ['Performance', 78, 'Review'], ['Security', 90, 'Strong']].map(([label, score, status]) => (
                <div key={String(label)} className="rounded-lg border border-border bg-background p-3">
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                  <div className="mt-2 text-2xl font-semibold">{score}</div>
                  <div className={`mt-2 text-[10px] font-semibold ${status === 'Review' ? 'text-amber-600' : 'text-emerald-600'}`}>{status}</div>
                </div>
              ))}
            </div>

            <div className="mt-2 grid gap-2 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-3"><div className="text-xs font-semibold">Issues overview</div><div className="text-[10px] text-accent">{phase.label}</div></div>
                <div className="mt-3 space-y-2.5">
                  {[['Urgent', 14, 22, 'bg-red-500'], ['Warnings', 38, 58, 'bg-amber-500'], ['Notices', 65, 76, 'bg-blue-500'], ['Passed', 152, 92, 'bg-emerald-500']].map(([label, count, width, color]) => (
                    <div key={String(label)} className="grid grid-cols-[4.3rem_1fr_2rem] items-center gap-2 text-[10px]"><span>{label}</span><div className="h-1.5 overflow-hidden rounded-full bg-muted"><motion.div animate={{ width: `${width}%` }} transition={{ duration: 0.7 }} className={`h-full rounded-full ${color}`} /></div><span className="text-right font-semibold">{count}</span></div>
                  ))}
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><motion.div animate={{ width: `${phase.progress}%` }} transition={{ duration: 0.55 }} className="h-full rounded-full bg-accent" /></div>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="text-xs font-semibold">Top issues</div>
                <div className="mt-3 space-y-2 text-[10px]">
                  <div className="flex gap-2"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-500" /><span>Missing meta description</span></div>
                  <div className="flex gap-2"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500" /><span>Page title needs attention</span></div>
                  <div className="flex gap-2"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500" /><span>Heading order can improve</span></div>
                </div>
                <button type="button" onClick={onOpenIssues} className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline">View all issues <ArrowRight className="h-3 w-3" /></button>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2">
              <button type="button" onClick={onOpenIssues} className="rounded-lg border border-border bg-background p-2.5 text-left hover:border-accent/30"><Monitor className="h-4 w-4 text-accent" /><div className="mt-2 text-[10px] font-semibold">Desktop preview</div><div className="mt-2 h-8 rounded bg-gradient-to-br from-blue-100 to-slate-100 dark:from-blue-950 dark:to-slate-900" /></button>
              <button type="button" onClick={onOpenIssues} className="rounded-lg border border-border bg-background p-2.5 text-left hover:border-accent/30"><Smartphone className="h-4 w-4 text-accent" /><div className="mt-2 text-[10px] font-semibold">Mobile preview</div><div className="mx-auto mt-2 h-8 w-5 rounded bg-slate-900" /></button>
              <button type="button" onClick={onOpenIssues} className="rounded-lg border border-border bg-background p-2.5 text-left hover:border-accent/30"><Search className="h-4 w-4 text-accent" /><div className="mt-2 text-[10px] font-semibold">Google preview</div><div className="mt-2 h-1.5 w-4/5 rounded bg-blue-600/70" /><div className="mt-1 h-1 w-full rounded bg-muted" /></button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function AudienceSection({ onNavigate }: { onNavigate: (destination: LandingDestination) => void }) {
  const roles = useCases.slice(0, 4);
  return (
    <div className="grid items-center gap-10 lg:grid-cols-[0.88fr_1.12fr]">
      <div>
        <div className="page-eyebrow">Built for practical SEO work</div>
        <h2 className="mt-3 max-w-xl text-3xl font-semibold leading-tight sm:text-4xl">Useful for owners, agencies, marketers, and developers</h2>
        <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">Move from a public URL to measured findings, visual context, and a prioritized backlog without pretending unsupported data exists.</p>
        <ul className="mt-6 grid gap-3 text-sm">
          {['Find urgent issues before they compound', 'Review desktop, mobile, and search context', 'Share a structured report with stakeholders', 'Keep technical evidence available for developers'].map((item) => <li key={item} className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />{item}</li>)}
        </ul>
        <button type="button" onClick={() => onNavigate('dashboard')} className="trust-button mt-7">Explore the workspace <ArrowRight className="h-4 w-4" /></button>
      </div>

      <div className="relative rounded-xl border border-border bg-card p-5 sm:p-8">
        <div className="pointer-events-none absolute left-1/2 top-1/2 hidden h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-blue-300 lg:block" />
        <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_9rem_1fr] lg:grid-rows-2 lg:items-center">
          {roles.map((role, index) => {
            const Icon = role.icon;
            const placement = index === 0 ? 'lg:col-start-1 lg:row-start-1' : index === 1 ? 'lg:col-start-3 lg:row-start-1' : index === 2 ? 'lg:col-start-1 lg:row-start-2' : 'lg:col-start-3 lg:row-start-2';
            return <button key={role.title} type="button" onClick={() => onNavigate(role.action)} className={`group rounded-xl border border-border bg-background p-4 text-left transition hover:border-accent/35 hover:bg-muted/50 ${placement}`}><div className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent group-hover:bg-accent group-hover:text-white"><Icon className="h-5 w-5" /></span><div><h3 className="text-sm font-semibold">{role.title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{role.outcomes[0]}</p></div></div></button>;
          })}
          <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }} className="hidden h-28 w-28 items-center justify-center justify-self-center rounded-xl border border-blue-200 bg-blue-50 text-blue-600 shadow-sm dark:border-blue-500/25 dark:bg-blue-500/10 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:flex"><ShieldCheck className="h-12 w-12" /></motion.div>
        </div>
      </div>
    </div>
  );
}

function CredibilityBadge({ icon: Icon, title, description }: { icon: IconType; title: string; description: string }) {
  return (
    <div className="flex gap-3 px-4 py-3 lg:px-6">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon className="h-5 w-5" />
      </div>
      <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div>
    </div>
  );
}

function ToolGroup({ title, tools, onNavigate }: { title: string; tools: typeof freeTools; onNavigate: (destination: LandingDestination) => void }) {
  return (
    <SurfaceCard className="p-5">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h3 className="text-xl font-bold">{title}</h3>
        <StatusBadge tone={title === 'Import-ready data' ? 'warning' : 'success'}>{title === 'Import-ready data' ? 'Provider/export required' : 'Real checks'}</StatusBadge>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {tools.map((tool) => (
          <ToolCard
            key={tool.title}
            icon={tool.icon}
            title={tool.title}
            description={tool.description}
            label={tool.label}
            cta={tool.cta}
            onClick={() => onNavigate(tool.action)}
          />
        ))}
      </div>
    </SurfaceCard>
  );
}

function ReportShowcase({ onNavigate }: { onNavigate: (destination: LandingDestination) => void }) {
  const [activeView, setActiveView] = useState<'summary' | 'previews' | 'imports'>('summary');
  const issueRows = [
    { title: 'Missing or weak page title', detail: 'The page title is short or unclear for search snippets.', severity: 'high' as const },
    { title: 'Meta description needs a rewrite', detail: 'The Google-style preview may not explain the page clearly.', severity: 'medium' as const },
    { title: 'Browser protection headers incomplete', detail: 'The Passive Security Review found missing browser protections.', severity: 'medium' as const },
  ];
  const viewCopy = {
    summary: 'Top fixes and score cards stay first so report readers know what to do next.',
    previews: 'Desktop, mobile, and Google-style previews give visual context before the technical detail.',
    imports: 'Ranking tables stay empty until real GSC, Bing, CSV, or provider rows are imported.',
  };

  return (
      <div className="mt-10 w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_50px_-34px_rgba(15,31,74,0.45)] dark:shadow-black/20">
      <div className="border-b border-border bg-card px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-red-400" />
            <span className="h-3 w-3 rounded-full bg-amber-400" />
            <span className="h-3 w-3 rounded-full bg-emerald-400" />
            <span className="truncate rounded-full border border-border bg-muted/50 px-4 py-2 text-sm text-muted-foreground">Report dashboard - example.com</span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <StatusBadge tone="success">Realtime audit</StatusBadge>
            <StatusBadge tone="accent">Visual report</StatusBadge>
            <StatusBadge tone="warning">Ranking import ready</StatusBadge>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-full rounded-lg border border-border bg-muted/45 p-1 text-sm font-semibold sm:w-auto">
            {[
              ['summary', 'Summary'],
              ['previews', 'Previews'],
              ['imports', 'Imports'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveView(id as typeof activeView)}
                className={`flex-1 rounded-md px-3 py-2 transition-colors sm:flex-none ${
                  activeView === id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground">{viewCopy[activeView]}</p>
            <button type="button" onClick={() => onNavigate(activeView === 'imports' ? 'imports' : 'reports')} className="quiet-button justify-center">
              {activeView === 'imports' ? 'Open imports' : 'Open reports'}
            </button>
          </div>
        </div>
      </div>

      <div className="min-w-0 bg-muted/25 p-4 sm:p-6">
        {activeView === 'summary' && (
        <div className="min-w-0">
          <div className="grid min-w-0 gap-5 md:grid-cols-[180px_minmax(0,1fr)]">
            <div className="min-w-0 rounded-xl border border-border bg-muted/30 p-5">
              <RadialScoreGauge value={84} label="Website health" detail="Example score display from audit signals" size="md" />
            </div>
            <div className="grid min-w-0 content-start gap-3">
              <CategoryScoreBar label="SEO audit" value={86} detail="Titles, descriptions, headings, links" />
              <CategoryScoreBar label="Technical SEO" value={78} detail="Status codes, redirects, sitemap access" tone="accent" />
              <CategoryScoreBar label="Passive security" value={88} detail="HTTPS and browser protections" />
            </div>
          </div>

          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="font-bold">Top fixes first</h3>
              <span className="text-xs font-semibold text-muted-foreground">Sorted by fix priority</span>
            </div>
            <SeverityDistribution critical={3} high={6} medium={12} low={8} />
          </div>

          <div className="mt-6 grid gap-3 lg:grid-cols-3">
            {issueRows.map((issue) => (
              <div key={issue.title} className="rounded-lg border border-border bg-muted/25 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h4 className="font-bold">{issue.title}</h4>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{issue.detail}</p>
                  </div>
                  <SeverityBadge severity={issue.severity} />
                </div>
              </div>
            ))}
          </div>
        </div>
        )}

        {activeView === 'previews' && (
        <div className="grid min-w-0 gap-5">
          <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
            <HomepageDesktopPreview />
            <HomepageMobilePreview />
          </div>
          <HomepageSerpPreview />
        </div>
        )}

        {activeView === 'imports' && <SerpRankingDataPanel />}
      </div>
    </div>
  );
}

function HomepageDesktopPreview() {
  return (
    <div className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-3">
        <Monitor className="h-4 w-4 text-accent" />
        <span className="text-sm font-bold">Desktop page preview</span>
      </div>
      <div className="bg-muted/35 p-3 text-slate-950 sm:p-5">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3 sm:px-5 sm:py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white">E</div>
              <div>
                <div className="font-bold">Example Brand</div>
                <div className="text-xs text-slate-500">Local service website</div>
              </div>
            </div>
            <div className="hidden gap-5 text-sm font-semibold text-slate-600 sm:flex">
              <span>Services</span>
              <span>Pricing</span>
              <span>Reviews</span>
            </div>
          </div>
          <div className="grid gap-4 p-3 sm:gap-5 sm:p-5 md:grid-cols-[1.15fr_0.85fr]">
            <div className="min-w-0">
              <div className="mb-3 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">Metadata preview</div>
              <h3 className="text-2xl font-bold leading-tight text-slate-950 sm:text-3xl">Clear service page headline with trust proof</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">This visual preview gives report readers page context before they review SEO and safety fixes.</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {['Primary CTA visible', 'Heading found', 'Internal links'].map((item) => (
                  <span key={item} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{item}</span>
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-blue-950 p-4 text-white">
              <div className="rounded-xl bg-white/10 p-4">
                <div className="h-28 rounded-xl bg-gradient-to-br from-blue-400 to-emerald-300" />
                <div className="mt-4 h-3 w-4/5 rounded-full bg-white/70" />
                <div className="mt-2 h-3 w-2/3 rounded-full bg-white/40" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HomepageMobilePreview() {
  return (
    <div className="w-full min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-accent" />
          <span className="text-sm font-bold">Mobile preview</span>
        </div>
        <StatusBadge tone="success">Responsive</StatusBadge>
      </div>
      <div className="mx-auto max-w-[260px] rounded-[2rem] border-8 border-slate-950 bg-slate-950 p-2 shadow-lg">
        <div className="overflow-hidden rounded-[1.4rem] bg-white text-slate-950">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-blue-600 text-center text-sm font-bold leading-8 text-white">E</div>
              <span className="text-sm font-bold">Example</span>
            </div>
            <div className="grid gap-1">
              <span className="h-0.5 w-5 rounded bg-slate-600" />
              <span className="h-0.5 w-5 rounded bg-slate-600" />
              <span className="h-0.5 w-5 rounded bg-slate-600" />
            </div>
          </div>
          <div className="p-4">
            <div className="h-28 rounded-2xl bg-gradient-to-br from-blue-100 to-emerald-100" />
            <h3 className="mt-4 text-xl font-bold leading-tight text-slate-950">Example Brand Services</h3>
            <p className="mt-2 text-xs leading-5 text-slate-600">Tap targets, visible CTA, and readable mobile copy are checked from public signals.</p>
            <div className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-bold text-white">Sample CTA area</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HomepageSerpPreview() {
  return (
    <div className="w-full min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        <Search className="h-5 w-5 text-accent" />
        <h3 className="text-lg font-bold">Google-style preview</h3>
      </div>
      <div className="min-w-0 rounded-2xl border border-border bg-white p-4 text-slate-950 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">E</div>
          <div className="min-w-0">
            <div className="truncate text-sm text-slate-800">Example Brand</div>
            <div className="truncate text-xs text-slate-500">https://example.com/services</div>
          </div>
        </div>
        <div className="mt-3 text-lg leading-6 text-[#1a0dab] sm:text-xl">Example Brand - Services, Pricing, and Local Trust</div>
        <p className="mt-2 text-sm leading-6 text-[#4d5156]">
          A clear preview helps users understand what was checked before reading technical details and fix guidance.
        </p>
        <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
          {['Title length checked', 'Description checked', 'URL clarity checked'].map((item) => (
            <span key={item} className="rounded-full bg-slate-100 px-3 py-2 font-bold text-slate-600">{item}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SerpRankingDataPanel() {
  return (
    <div className="w-full min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-bold">Actual SERP ranking data</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Real keyword positions require Google Search Console, CSV, or provider imports. SEOIntel will not invent ranking rows when no source is connected.
          </p>
        </div>
        <StatusBadge tone="warning">Import required</StatusBadge>
      </div>
      <div className="mt-5 max-w-full overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-3 sm:px-4">Keyword</th>
              <th className="px-3 py-3 sm:px-4">URL</th>
              <th className="px-3 py-3 sm:px-4">Position</th>
              <th className="px-3 py-3 sm:px-4">Clicks</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground sm:px-4">
                No ranking source connected yet. Import real data to populate this table.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PricingComparisonTable() {
  const rows = [
    ['Audit type', 'Quick audit', 'Full standard audit', 'Deep-ready workflow'],
    ['Page limit', '5 pages', '25 pages', '75 agency / 100 admin when worker supports deep audit'],
    ['Daily audits', '3', '25', '100 agency / 1000 admin'],
    ['Monthly audits', '30', '500', '3000 agency / 100000 admin'],
    ['Live progress', 'Yes', 'Yes', 'Yes'],
    ['Passive security', 'Included', 'Included', 'Included'],
    ['Ranking/backlink data', 'Import-ready only', 'Import-ready only', 'Provider/export required'],
  ];

  return (
    <SurfaceCard className="mt-8 overflow-hidden">
      <div className="border-b border-border bg-card px-5 py-4">
        <h3 className="text-xl font-bold">Plan comparison</h3>
        <p className="mt-1 text-sm text-muted-foreground">Uses the current SEOIntel limits. No inflated crawl limits or fake data claims.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-4 font-bold">Capability</th>
              <th className="p-4 font-bold">Free Quick Audit</th>
              <th className="p-4 font-bold">Paid Full Audit</th>
              <th className="p-4 font-bold">Agency/Admin Deep-ready</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(([capability, free, paid, agency]) => (
              <tr key={capability} className="bg-card/60">
                <td className="p-4 font-semibold">{capability}</td>
                <td className="p-4 text-muted-foreground">{free}</td>
                <td className="p-4 text-muted-foreground">{paid}</td>
                <td className="p-4 text-muted-foreground">{agency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SurfaceCard>
  );
}

function AuditCheckGroup({ icon: Icon, title, description, checks }: { icon: IconType; title: string; description: string; checks: string[] }) {
  return (
    <SurfaceCard className="p-6">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="text-2xl font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="mt-5 grid gap-2">
        {checks.map((check) => (
          <div key={check} className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{check}</span>
          </div>
        ))}
      </div>
    </SurfaceCard>
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
