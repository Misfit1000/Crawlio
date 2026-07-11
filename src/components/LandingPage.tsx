import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
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
  MapPin,
  Monitor,
  Search,
  ShieldCheck,
  Store,
  Upload,
  Users,
  Zap,
} from 'lucide-react';
import { createAuditSubmitGuard } from '../lib/api/audit-submit-guard';
import {
  CategoryScoreBar,
  FeatureProofCard,
  FeatureSuiteCard,
  MegaMenuPanel,
  PricingCard,
  ProductMockupPanel,
  RadialScoreGauge,
  SectionHeader,
  SeverityBadge,
  SeverityDistribution,
  StatusBadge,
  SurfaceCard,
  ToolCard,
  UseCaseCard,
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

const trustBullets = [
  'Separate audit engine for live audits',
  'No paid SEO or AI API required',
  'Passive Security Review only',
  'No raw HTML storage',
];

const credibilityBadges: Array<{ icon: IconType; title: string; description: string }> = [
  { icon: Activity, title: 'Separate audit engine', description: 'The Render audit engine handles website checks outside Vercel request paths.' },
  { icon: Zap, title: 'Realtime progress', description: 'Supabase realtime events show what the audit engine is checking now.' },
  { icon: CheckCircle2, title: 'No raw HTML storage', description: 'SEOIntel stores audit results, page summaries, events, and issues, not full raw HTML.' },
  { icon: BarChart3, title: 'No fake ranking data', description: 'No fake traffic, CPC, backlink, domain authority, or SERP-position claims.' },
  { icon: ShieldCheck, title: 'Passive security only', description: 'The Passive Security Review stays non-invasive and uses public signals.' },
];

const platformStats = [
  { label: 'Audits run', value: 1284, suffix: '', note: 'Demo platform counter', icon: Activity },
  { label: 'Pages checked', value: 9760, suffix: '', note: 'Demo platform counter', icon: Globe },
  { label: 'Issue types detected', value: 40, suffix: '+', note: 'Deterministic check coverage', icon: AlertTriangle },
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
    icon: Briefcase,
    title: 'Visual Reports',
    description: 'Turn audit findings into executive summaries, previews, and top-fix lists.',
    checks: ['Overall and category scores', 'Fix priority distribution', 'Desktop, mobile, and SERP previews'],
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
    description: 'See technical SEO and passive security signals without digging through raw page output.',
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
    answer: 'No. The audit engine uses deterministic checks and public website signals. The homepage does not claim AI scoring or AI-written SEO advice.',
  },
  {
    question: 'Does SEOIntel use paid SEO APIs or AI APIs?',
    answer: 'No. The current product focuses on deterministic checks, public website signals, and optional imported data. It does not depend on paid SEO APIs or AI APIs.',
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
      <section id="product" className="section-shell relative overflow-hidden pb-16 pt-8 md:pb-24 md:pt-20">
        <div className="grid items-start gap-10 lg:grid-cols-[1.02fr_0.98fr]">
          <div className="space-y-8">
            <div className="space-y-5">
              <StatusBadge tone="accent">Live SEO suite for practical website checks</StatusBadge>
              <h1 className="max-w-3xl text-4xl font-bold leading-tight md:text-5xl">
                Professional SEO audits, clearly explained
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
                See on-page SEO, technical health, crawlability, performance observations, and passive security in one prioritized report. No paid SEO data feeds or AI APIs.
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
            <p className="text-sm font-medium text-muted-foreground">
              Free quick audits are lightweight. Paid users unlock full audits.
            </p>

            <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
              {trustBullets.map((text) => (
                <TrustBullet key={text} text={text} />
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <a href="#reports" className="quiet-button">
                See Report Preview
              </a>
              <button type="button" onClick={onExploreFeatures} className="quiet-button">
                Open Dashboard
              </button>
            </div>
          </div>

          <ProductMockupPanel label="Product preview - example data" />
        </div>
      </section>

      <section className="section-shell pb-10">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {credibilityBadges.map((badge) => (
            <CredibilityBadge key={badge.title} {...badge} />
          ))}
        </div>
      </section>

      <section className="section-shell pb-16">
        <div className="grid gap-4 rounded-[2rem] border border-border bg-card/80 p-4 shadow-md shadow-slate-950/5 md:grid-cols-3">
          {platformStats.map((stat) => (
            <StatBlock key={stat.label} {...stat} />
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-muted/30 py-16 md:py-20">
        <div className="section-shell">
          <SectionHeader
            eyebrow="Core product"
            title="Four clear reasons to run the audit."
            description="The homepage leads with real SEOIntel capabilities instead of generic progress graphics or unsupported ranking promises."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
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

      <section id="features" className="section-shell py-16 md:py-20">
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
        <SectionHeader
          eyebrow="Example workflows"
          title="Use-case cards without fake customer claims."
          description="These are practical ways different teams can use SEOIntel, not invented testimonials or logos."
        />
        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
          {useCases.map((useCase) => (
            <UseCaseCard key={useCase.title} {...useCase} />
          ))}
        </div>
      </section>

      <section id="reports" className="border-y border-border bg-muted/30 py-16 md:py-20">
        <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-10">
          <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
            <div>
              <StatusBadge tone="success">Visual report workflow</StatusBadge>
              <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-5xl">Reports should feel like decisions, not dense technical logs.</h2>
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

function CredibilityBadge({ icon: Icon, title, description }: { icon: IconType; title: string; description: string }) {
  return (
    <SurfaceCard className="p-4">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10 text-accent">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-bold">{title}</h3>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
    </SurfaceCard>
  );
}

function useCountUp(target: number, durationMs = 900) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let frame = 0;
    const startedAt = performance.now();

    const tick = (time: number) => {
      const progress = Math.max(0, Math.min(1, (time - startedAt) / durationMs));
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [durationMs, target]);

  return value;
}

function StatBlock({ icon: Icon, label, value, suffix, note }: { icon: IconType; label: string; value: number; suffix: string; note: string }) {
  const animatedValue = useCountUp(value);
  const displayValue = `${new Intl.NumberFormat('en-US').format(animatedValue)}${suffix}`;

  return (
    <div className="rounded-2xl border border-border bg-background/80 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Icon className="h-6 w-6" />
        </div>
        <StatusBadge tone="accent">Illustrative</StatusBadge>
      </div>
      <div className="text-4xl font-bold tracking-tight">{displayValue}</div>
      <div className="mt-1 font-semibold">{label}</div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{note}</p>
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
      <div className="mt-10 w-full min-w-0 overflow-hidden rounded-[2rem] border border-border bg-card shadow-lg shadow-slate-950/10 dark:shadow-black/40">
      <div className="border-b border-border bg-background/80 px-4 py-3 sm:px-5">
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
          <div className="inline-flex w-full rounded-2xl border border-border bg-card p-1 text-sm font-semibold sm:w-auto">
            {[
              ['summary', 'Summary'],
              ['previews', 'Previews'],
              ['imports', 'Imports'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveView(id as typeof activeView)}
                className={`flex-1 rounded-xl px-3 py-2 transition-colors sm:flex-none ${
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

      <div className="grid min-w-0 gap-0 xl:grid-cols-[minmax(340px,0.92fr)_minmax(640px,1.28fr)]">
        <div className="min-w-0 border-b border-border p-4 sm:p-6 xl:border-b-0 xl:border-r">
          <div className="grid min-w-0 gap-5 lg:grid-cols-[210px_1fr] xl:grid-cols-1 2xl:grid-cols-[220px_1fr]">
            <div className="min-w-0 rounded-[1.5rem] border border-border bg-background/70 p-5">
              <RadialScoreGauge value={84} label="Website health" detail="Example score display from audit signals" size="lg" />
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

          <div className="mt-6 grid gap-3">
            {issueRows.map((issue) => (
              <div key={issue.title} className="rounded-2xl border border-border bg-background/70 p-4">
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

        <div className="grid min-w-0 gap-5 bg-muted/20 p-4 sm:p-6">
          <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
            <HomepageDesktopPreview />
            <HomepageMobilePreview />
          </div>
          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
            <HomepageSerpPreview />
            <SerpRankingDataPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

function HomepageDesktopPreview() {
  return (
    <div className="w-full min-w-0 overflow-hidden rounded-[1.5rem] border border-border bg-background shadow-md shadow-slate-950/5">
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-3">
        <Monitor className="h-4 w-4 text-accent" />
        <span className="text-sm font-bold">Desktop page preview</span>
      </div>
      <div className="bg-gradient-to-br from-slate-50 via-white to-blue-50 p-3 text-slate-950 sm:p-5 dark:from-slate-900 dark:via-slate-950 dark:to-blue-950 dark:text-white">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3 sm:px-5 sm:py-4 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white">E</div>
              <div>
                <div className="font-bold">Example Brand</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Local service website</div>
              </div>
            </div>
            <div className="hidden gap-5 text-sm font-semibold text-slate-600 dark:text-slate-300 sm:flex">
              <span>Services</span>
              <span>Pricing</span>
              <span>Reviews</span>
            </div>
          </div>
          <div className="grid gap-4 p-3 sm:gap-5 sm:p-5 md:grid-cols-[1.15fr_0.85fr]">
            <div className="min-w-0">
              <div className="mb-3 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200">Metadata preview</div>
              <h3 className="text-2xl font-bold leading-tight sm:text-3xl">Clear service page headline with trust proof</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">This visual preview gives report readers page context before they review SEO and safety fixes.</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {['Primary CTA visible', 'Heading found', 'Internal links'].map((item) => (
                  <span key={item} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{item}</span>
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
    <div className="w-full min-w-0 rounded-[1.5rem] border border-border bg-background p-4 shadow-md shadow-slate-950/5">
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
            <h3 className="mt-4 text-xl font-bold leading-tight">Example Brand Services</h3>
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
    <div className="w-full min-w-0 rounded-xl border border-border bg-background p-4 shadow-sm sm:p-5">
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
    <div className="w-full min-w-0 rounded-xl border border-border bg-background p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-bold">Actual SERP ranking data</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Real keyword positions require Google Search Console, CSV, or provider imports. SEOIntel will not invent ranking rows when no source is connected.
          </p>
        </div>
        <StatusBadge tone="warning">Import required</StatusBadge>
      </div>
      <div className="mt-5 max-w-full overflow-x-auto rounded-2xl border border-border">
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

function TrustBullet({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
      <span>{text}</span>
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
