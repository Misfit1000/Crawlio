import React from 'react';
import { CheckCircle2, Globe, Monitor, Moon, Search, Smartphone, Sun, TrendingUp } from 'lucide-react';

type VisualIcon = React.ComponentType<{ className?: string }>;

export function SurfaceCard({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={`trust-card ${className}`}>{children}</section>;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && <div className="text-xs font-bold uppercase tracking-[0.18em] text-accent">{eyebrow}</div>}
        <h2 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">{title}</h2>
        {description && <p className="mt-2 max-w-3xl text-sm text-muted-foreground md:text-base">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const tones = {
    neutral: 'border-border bg-muted text-muted-foreground',
    success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    warning: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    danger: 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300',
    accent: 'border-accent/20 bg-accent/10 text-accent',
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function FeatureSuiteCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  status = 'Available',
  points = [],
  cta,
  muted = false,
}: {
  icon: VisualIcon;
  eyebrow?: string;
  title: string;
  description: string;
  status?: string;
  points?: string[];
  cta?: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <SurfaceCard className={`group flex h-full flex-col p-6 transition-transform duration-300 hover:-translate-y-1 ${muted ? 'opacity-90' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent transition-colors duration-300 group-hover:bg-accent group-hover:text-accent-foreground">
          <Icon className="h-6 w-6" />
        </div>
        <StatusBadge tone={muted ? 'warning' : 'accent'}>{status}</StatusBadge>
      </div>
      {eyebrow && <div className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-accent">{eyebrow}</div>}
      <h3 className="mt-2 text-xl font-bold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      {points.length > 0 && (
        <ul className="mt-5 space-y-2">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}
      {cta && <div className="mt-auto pt-5">{cta}</div>}
    </SurfaceCard>
  );
}

export function ToolCard({
  icon: Icon,
  title,
  description,
  label = 'Free tool',
  cta = 'Open tool',
  href,
  onClick,
  disabled = false,
}: {
  icon: VisualIcon;
  title: string;
  description: string;
  label?: string;
  cta?: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <Icon className="h-5 w-5" />
        </div>
        <span className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-semibold text-muted-foreground">{label}</span>
      </div>
      <h3 className="mt-5 text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      <span className="mt-5 inline-flex text-sm font-bold text-accent">{disabled ? 'Coming soon' : cta}</span>
    </>
  );

  if (href && !disabled) {
    return (
      <a href={href} className="trust-card group flex h-full flex-col p-5 transition-transform duration-300 hover:-translate-y-1 hover:border-accent/30">
        {body}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className="trust-card group flex h-full flex-col p-5 text-left transition-transform duration-300 hover:-translate-y-1 hover:border-accent/30 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {body}
    </button>
  );
}

export function UseCaseCard({
  icon: Icon,
  title,
  description,
  outcomes = [],
}: {
  icon: VisualIcon;
  title: string;
  description: string;
  outcomes?: string[];
}) {
  return (
    <SurfaceCard className="flex h-full flex-col p-6">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="text-xl font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      {outcomes.length > 0 && (
        <ul className="mt-5 space-y-2">
          {outcomes.map((outcome) => (
            <li key={outcome} className="flex items-start gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>{outcome}</span>
            </li>
          ))}
        </ul>
      )}
    </SurfaceCard>
  );
}

export function PricingCard({
  title,
  price,
  description,
  features,
  featured = false,
  cta,
  note,
}: {
  title: string;
  price: string;
  description: string;
  features: string[];
  featured?: boolean;
  cta?: React.ReactNode;
  note?: string;
}) {
  return (
    <SurfaceCard className={`flex h-full flex-col p-6 ${featured ? 'border-accent bg-accent/10 shadow-blue-600/10' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        {featured && <StatusBadge tone="accent">Popular</StatusBadge>}
      </div>
      <div className="mt-6 text-4xl font-bold tracking-tight">{price}</div>
      <ul className="mt-6 space-y-3">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {cta && <div className="mt-auto pt-6">{cta}</div>}
      {note && <p className="mt-4 text-xs leading-5 text-muted-foreground">{note}</p>}
    </SurfaceCard>
  );
}

export function MegaMenuPanel({
  columns,
}: {
  columns: Array<{
    title: string;
    links: Array<{ label: string; href: string; description?: string }>;
  }>;
}) {
  return (
    <div className="grid gap-4 rounded-3xl border border-border bg-card/95 p-5 shadow-2xl shadow-slate-950/10 backdrop-blur-xl md:grid-cols-2 lg:grid-cols-3">
      {columns.map((column) => (
        <div key={column.title}>
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-accent">{column.title}</div>
          <div className="space-y-2">
            {column.links.map((link) => (
              <a key={`${column.title}-${link.label}-${link.href}`} href={link.href} className="block rounded-2xl border border-transparent p-3 transition-colors hover:border-border hover:bg-muted/50">
                <div className="font-semibold">{link.label}</div>
                {link.description && <div className="mt-1 text-xs leading-5 text-muted-foreground">{link.description}</div>}
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProgressBar({
  value,
  label,
  tone = 'accent',
}: {
  value: number;
  label?: string;
  tone?: 'accent' | 'green' | 'yellow' | 'red';
}) {
  const safeValue = Math.max(0, Math.min(100, value || 0));
  const colors = {
    accent: 'bg-accent',
    green: 'bg-emerald-500',
    yellow: 'bg-amber-500',
    red: 'bg-red-500',
  };
  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>{label}</span>
          <span className="text-foreground">{Math.round(safeValue)}%</span>
        </div>
      )}
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${colors[tone]} transition-all duration-700 ease-out`} style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  icon,
  tone = 'accent',
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  icon?: React.ReactNode;
  tone?: 'accent' | 'green' | 'yellow' | 'red' | 'blue';
}) {
  const tones = {
    accent: 'bg-accent/10 text-accent',
    green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    yellow: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    red: 'bg-red-500/10 text-red-700 dark:text-red-300',
    blue: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  };
  return (
    <SurfaceCard className="group p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-muted-foreground">{label}</div>
          <div className="mt-1 text-3xl font-bold">{value}</div>
          {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
        </div>
        {icon && <div className={`rounded-2xl p-3 ${tones[tone]} transition-transform duration-300 group-hover:scale-105`}>{icon}</div>}
      </div>
    </SurfaceCard>
  );
}

export function BarList({
  items,
}: {
  items: Array<{ label: string; value: number; tone?: 'accent' | 'green' | 'yellow' | 'red' }>;
}) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <ProgressBar key={item.label} label={item.label} value={item.value} tone={item.tone || 'accent'} />
      ))}
    </div>
  );
}

export function SeverityStack({
  critical,
  high,
  medium,
  low,
}: {
  critical: number;
  high: number;
  medium: number;
  low: number;
}) {
  const total = Math.max(1, critical + high + medium + low);
  const parts = [
    { label: 'Fix now', value: critical, className: 'bg-red-500' },
    { label: 'High priority', value: high, className: 'bg-orange-500' },
    { label: 'Review soon', value: medium, className: 'bg-amber-500' },
    { label: 'Nice to fix', value: low, className: 'bg-sky-500' },
  ];
  return (
    <div className="space-y-3">
      <div className="flex h-4 overflow-hidden rounded-full bg-muted">
        {parts.map((part) => (
          <div key={part.label} className={`${part.className} transition-all duration-700`} style={{ width: `${(part.value / total) * 100}%` }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
        {parts.map((part) => (
          <div key={part.label} className="rounded-lg border border-border bg-muted/30 p-2">
            <div className="font-semibold">{part.value}</div>
            <div className="text-muted-foreground">{part.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SitePreviewCard({
  url,
  title,
  description,
  hostname,
}: {
  url?: string | null;
  title?: string | null;
  description?: string | null;
  hostname?: string | null;
}) {
  const displayUrl = url || hostname || 'Waiting for URL';
  const host = previewHost(displayUrl, hostname);
  return (
    <SurfaceCard className="overflow-hidden">
      <div className="h-24 bg-gradient-to-br from-accent/20 via-sky-500/10 to-emerald-500/15" />
      <div className="p-5">
        <div className="-mt-11 mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
          <BrandInitialMark host={host} className="h-8 w-8 rounded" />
        </div>
        <div className="text-xs font-bold uppercase tracking-[0.16em] text-accent">{host || 'Website preview'}</div>
        <h3 className="mt-2 line-clamp-2 text-xl font-bold">{title || 'Site preview updates as pages are scanned'}</h3>
        <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
          {description || 'SEOIntel shows page details, scan progress, and fixes without storing raw page HTML.'}
        </p>
        <div className="mt-4 break-all rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">{displayUrl}</div>
      </div>
    </SurfaceCard>
  );
}

function previewHost(url?: string | null, hostname?: string | null) {
  if (hostname) return hostname;
  try {
    return url ? new URL(url).hostname : 'example.com';
  } catch {
    return url || 'example.com';
  }
}

function previewUrl(url?: string | null, hostname?: string | null) {
  if (url) return url;
  return hostname ? `https://${hostname}` : 'https://example.com';
}

function brandInitial(host: string) {
  return host.replace(/^www\./, '').slice(0, 1).toUpperCase() || 'S';
}

function BrandInitialMark({ host, className = '' }: { host: string; className?: string }) {
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br from-accent/15 via-sky-500/10 to-emerald-500/15 font-bold text-accent ${className}`}>
      {brandInitial(host)}
    </div>
  );
}

export function DesktopSitePreviewCard({
  url,
  title,
  description,
  hostname,
}: {
  url?: string | null;
  title?: string | null;
  description?: string | null;
  hostname?: string | null;
}) {
  const host = previewHost(url, hostname);
  const displayUrl = previewUrl(url, host);
  const brand = host.replace(/^www\./, '');
  const pageTitle = title || `${brand} homepage`;
  const desc = description || 'Metadata-based homepage preview generated from public page details without storing raw HTML.';
  return (
    <SurfaceCard className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-red-400" />
        <span className="h-3 w-3 rounded-full bg-amber-400" />
        <span className="h-3 w-3 rounded-full bg-emerald-400" />
        <div className="ml-3 flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
          <Globe className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{displayUrl}</span>
        </div>
      </div>
      <div className="bg-gradient-to-br from-accent/10 via-background to-emerald-500/10 p-5">
        <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-xl">
          <div className="border-b border-border bg-card/95 px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <BrandInitialMark host={host} className="h-10 w-10 rounded-xl border border-border bg-background" />
                <div className="min-w-0">
                  <div className="truncate font-bold">{brand}</div>
                  <div className="truncate text-xs text-muted-foreground">Website preview</div>
                </div>
              </div>
              <div className="hidden items-center gap-4 text-xs font-semibold text-muted-foreground md:flex">
                <span>Overview</span>
                <span>Services</span>
                <span>Contact</span>
              </div>
            </div>
          </div>
          <div className="grid min-h-72 gap-5 p-6 md:grid-cols-[1.1fr_0.9fr]">
            <div className="flex flex-col justify-center">
              <div className="mb-3 inline-flex w-fit rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-bold text-accent">Preview from scanned page data</div>
              <h3 className="line-clamp-3 text-3xl font-bold leading-tight">{pageTitle}</h3>
              <p className="mt-4 line-clamp-4 text-sm leading-6 text-muted-foreground">{desc}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {['Search preview', 'Mobile page', 'Browser safety'].map((item) => (
                  <span key={item} className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground">{item}</span>
                ))}
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <span className="rounded-xl bg-accent px-4 py-2 text-xs font-bold text-accent-foreground">View report</span>
                <span className="rounded-xl border border-border bg-card px-4 py-2 text-xs font-bold text-muted-foreground">Top fixes</span>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="rounded-xl bg-gradient-to-br from-accent/20 via-sky-500/10 to-emerald-500/20 p-5">
                <div className="mb-10 flex items-center justify-between">
                  <BrandInitialMark host={host} className="h-12 w-12 rounded-2xl border border-white/50 bg-white text-lg shadow-sm" />
                  <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-slate-700">Live preview</span>
                </div>
                <div className="rounded-2xl bg-white/90 p-4 text-slate-900 shadow-sm">
                  <div className="text-xs font-bold uppercase tracking-wide text-blue-700">{brand}</div>
                  <div className="mt-2 line-clamp-2 text-lg font-bold">{pageTitle}</div>
                  <div className="mt-3 line-clamp-2 text-xs leading-5 text-slate-600">{desc}</div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                {['Title', 'Description', 'Icon'].map((item) => (
                  <div key={item} className="rounded-xl border border-border bg-background p-2">
                    <CheckCircle2 className="mx-auto mb-1 h-4 w-4 text-emerald-600" />
                    <div className="font-semibold">{item}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}

export function MobileSitePreviewCard({
  url,
  title,
  description,
  hostname,
}: {
  url?: string | null;
  title?: string | null;
  description?: string | null;
  hostname?: string | null;
}) {
  const host = previewHost(url, hostname);
  const brand = host.replace(/^www\./, '');
  const pageTitle = title || `${brand} homepage`;
  const desc = description || 'Live page preview from scan data.';
  return (
    <SurfaceCard className="p-5">
      <div className="mx-auto w-full max-w-[250px] rounded-[2rem] border-[10px] border-slate-950 bg-slate-950 p-1 shadow-2xl dark:border-slate-900 dark:bg-slate-900">
        <div className="overflow-hidden rounded-[1.35rem] bg-background">
          <div className="relative flex items-center justify-between border-b border-border bg-card px-3 py-3">
            <div className="absolute left-1/2 top-2 h-1.5 w-14 -translate-x-1/2 rounded-full bg-slate-900/80" />
            <BrandInitialMark host={host} className="mt-2 h-8 w-8 rounded-xl border border-border bg-background text-sm" />
            <div className="mt-2 truncate text-xs font-bold">{brand}</div>
            <div className="mt-2 h-8 w-8 rounded-xl border border-border bg-muted" />
          </div>
          <div className="bg-gradient-to-br from-accent/10 to-emerald-500/10 p-4">
            <div className="mb-4 rounded-2xl border border-border bg-card p-3">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-2xl font-bold text-accent shadow-sm">
                {brandInitial(host)}
              </div>
              <h3 className="line-clamp-3 text-xl font-bold leading-tight">{pageTitle}</h3>
              <p className="mt-2 line-clamp-4 text-xs leading-5 text-muted-foreground">{desc}</p>
              <button type="button" className="mt-4 w-full rounded-xl bg-accent px-3 py-2 text-xs font-bold text-accent-foreground">View report</button>
            </div>
            <div className="grid gap-2">
              {['Search preview ready', 'Mobile layout checked', 'Top fixes sorted'].map((item) => (
                <div key={item} className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground">{item}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}

export function SerpPreviewCard({
  url,
  title,
  description,
  canonicalUrl,
}: {
  url?: string | null;
  title?: string | null;
  description?: string | null;
  canonicalUrl?: string | null;
}) {
  const displayUrl = canonicalUrl || previewUrl(url);
  const host = previewHost(displayUrl);
  const serpTitle = title || `${host.replace(/^www\./, '')} - SEO preview`;
  const serpDescription = description || 'Search result preview appears as soon as the page title and description are available from the scan.';
  const titleGood = serpTitle.length >= 30 && serpTitle.length <= 60;
  const descGood = serpDescription.length >= 120 && serpDescription.length <= 160;
  return (
    <SurfaceCard className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Search className="h-5 w-5 text-accent" />
        <h3 className="text-lg font-bold">Google-style preview</h3>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-sm dark:bg-white">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100">
            <BrandInitialMark host={host} className="h-5 w-5 rounded text-xs" />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-slate-900">{host.replace(/^www\./, '')}</div>
            <div className="truncate text-xs text-slate-600">{displayUrl.replace(/^https?:\/\//, '').replace(/\//g, ' > ')}</div>
          </div>
        </div>
        <div className="mt-3 line-clamp-2 text-xl text-blue-700">{serpTitle}</div>
        <p className="mt-1 line-clamp-3 text-sm leading-6 text-slate-600">{serpDescription}</p>
      </div>
      <div className="mt-4 grid gap-2 text-xs md:grid-cols-2">
        <span className={`rounded-full border px-3 py-2 font-semibold ${titleGood ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700' : 'border-amber-500/20 bg-amber-500/10 text-amber-700'}`}>
          Title {serpTitle.length} chars {titleGood ? 'good' : 'review'}
        </span>
        <span className={`rounded-full border px-3 py-2 font-semibold ${descGood ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700' : 'border-amber-500/20 bg-amber-500/10 text-amber-700'}`}>
          Description {serpDescription.length} chars {descGood ? 'good' : 'review'}
        </span>
      </div>
    </SurfaceCard>
  );
}

export function SitePreviewSection({
  url,
  title,
  description,
  hostname,
  canonicalUrl,
}: {
  url?: string | null;
  title?: string | null;
  description?: string | null;
  hostname?: string | null;
  canonicalUrl?: string | null;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-accent">Website preview</div>
          <h2 className="text-2xl font-bold">Desktop, mobile, and Google-style previews</h2>
          <p className="mt-1 text-sm text-muted-foreground">Generated from public page details and scan results. No raw HTML is stored.</p>
        </div>
        <div className="flex gap-2 text-xs font-semibold text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1"><Monitor className="h-3.5 w-3.5" /> Desktop</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1"><Smartphone className="h-3.5 w-3.5" /> Mobile</span>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <DesktopSitePreviewCard url={url} title={title} description={description} hostname={hostname} />
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-1">
          <MobileSitePreviewCard url={url} title={title} description={description} hostname={hostname} />
          <SerpPreviewCard url={url} title={title} description={description} canonicalUrl={canonicalUrl} />
        </div>
      </div>
    </section>
  );
}

export function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: 'dark' | 'light';
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="group inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card/90 px-2 text-sm font-semibold shadow-sm transition-all duration-300 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
    >
      <span className={`flex h-7 w-7 items-center justify-center rounded-full transition-all duration-300 ${theme === 'dark' ? 'translate-x-7 bg-accent text-accent-foreground' : 'translate-x-0 bg-amber-400 text-slate-950'}`}>
        {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </span>
      <span className="sr-only">{theme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
    </button>
  );
}

export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}

export function BrandMark() {
  return (
    <div className="flex items-center gap-2 font-bold tracking-tight text-foreground">
      <div className="rounded-xl bg-accent p-2 text-accent-foreground shadow-sm shadow-accent/20">
        <TrendingUp className="h-5 w-5" />
      </div>
      <span className="text-xl">SEO<span className="text-accent">Intel</span></span>
    </div>
  );
}
