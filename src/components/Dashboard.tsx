import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, FileText, Gauge, Layers, Lock, Rocket, Search, ShieldCheck, Upload } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { API_ROUTES } from '../lib/api/routes';
import { getAuthHeaders } from '../lib/api/auth-headers';
import { safeJsonFetch } from '../lib/http/safe-json';
import { CategoryScoreBar, MetricCard, ProgressBar, RadialScoreGauge, SeverityDistribution, SitePreviewSection, StatusBadge, SurfaceCard } from './ui/visual-system';

export default function Dashboard(props: any) {
  const { user } = useAuth();
  const [planData, setPlanData] = useState<any | null>(null);
  const upgradeUrl = import.meta.env.VITE_UPGRADE_URL;

  useEffect(() => {
    let active = true;
    if (!user) {
      setPlanData(null);
      return;
    }
    getAuthHeaders()
      .then((headers) => safeJsonFetch<any>(API_ROUTES.meProfile, { headers }))
      .then((response) => {
        if (active && response.success) setPlanData(response.data.data || response.data);
      })
      .catch(() => {
        if (active) setPlanData(null);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const profile = planData?.profile || user;
  const limits = planData?.limits;
  const plan = profile?.plan || 'free';
  const dailyLimit = Number(limits?.dailyAudits ?? (plan === 'free' ? 3 : 25));
  const monthlyLimit = Number(limits?.monthlyAudits ?? (plan === 'free' ? 30 : 500));
  const dailyUsed = Number(profile?.auditQuotaUsedDaily ?? 0);
  const monthlyUsed = Number(profile?.auditQuotaUsedMonthly ?? 0);
  const dailyRemaining = Math.max(0, dailyLimit - dailyUsed);
  const monthlyRemaining = Math.max(0, monthlyLimit - monthlyUsed);
  const searchedUrl = String(props.keyword || '').trim();

  const categoryScores = [
    { label: 'SEO', value: 84, tone: 'green' as const },
    { label: 'Website health', value: 76, tone: 'accent' as const },
    { label: 'Speed signals', value: 68, tone: 'yellow' as const },
    { label: 'Browser safety', value: 88, tone: 'green' as const },
    { label: 'Google access', value: 79, tone: 'accent' as const },
    { label: 'Mobile experience', value: 72, tone: 'accent' as const },
    { label: 'Social previews', value: 61, tone: 'yellow' as const },
  ];

  return (
    <div className="w-full space-y-8 animate-rise">
      <SurfaceCard className="overflow-hidden p-0">
        <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="p-6 md:p-8">
            <div className="suite-chip mb-4 text-accent">Website command center</div>
            <h1 className="text-3xl font-black tracking-tight md:text-5xl">Know what to fix first, then prove it with real audit data.</h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
              Run live audits, understand site health at a glance, import real search data, and move from scan results to prioritized fixes without paid APIs.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button className="quiet-button">
                <Upload className="h-4 w-4" /> Import Data
              </button>
              <button onClick={() => props.onOpenSeoAudit?.()} className="trust-button">
                <Rocket className="h-4 w-4" /> Start audit
              </button>
            </div>
          </div>
          <div className="border-t border-border bg-gradient-to-br from-accent/10 via-card to-emerald-500/10 p-6 md:p-8 lg:border-l lg:border-t-0">
            <div className="grid gap-3">
              {categoryScores.slice(0, 4).map((item) => (
                <CategoryScoreBar key={item.label} label={item.label} value={item.value} tone={item.tone} />
              ))}
            </div>
          </div>
        </div>
      </SurfaceCard>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Overall health" value="84" detail="Demo benchmark from latest audit" icon={<Gauge className="h-6 w-6" />} tone="green" />
        <MetricCard label="Pages scanned" value="7 / 25" detail="Full audit sample" icon={<Layers className="h-6 w-6" />} tone="accent" />
        <MetricCard label="Open fixes" value="29" detail="3 urgent, 6 high priority" icon={<AlertTriangle className="h-6 w-6" />} tone="yellow" />
        <MetricCard label="Browser safety" value="A-" detail="Non-invasive checks" icon={<ShieldCheck className="h-6 w-6" />} tone="green" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
        <SurfaceCard className="p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={plan === 'free' ? 'warning' : 'success'}>{plan.toUpperCase()} PLAN</StatusBadge>
                <StatusBadge tone="accent">{plan === 'free' ? 'Quick audit enabled' : 'Full audit enabled'}</StatusBadge>
              </div>
              <h3 className="mt-4 text-2xl font-bold">
                {plan === 'free' ? 'Free quick audit is active' : 'Full audit workspace is active'}
              </h3>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {plan === 'free'
                  ? 'Free users get one active quick audit, 5 scanned pages, passive browser safety checks, and exportable JSON/CSV data.'
                  : 'Paid, agency, and admin users get larger scans, faster starts, more pages, and richer report exports.'}
              </p>
            </div>
            {plan === 'free' && (
              <a
                href={upgradeUrl || '#'}
                onClick={(event) => {
                  if (!upgradeUrl) {
                    event.preventDefault();
                    alert('Paid plans are coming soon. Contact admin to upgrade.');
                  }
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2 font-semibold transition-colors hover:bg-muted"
              >
                <Lock className="h-4 w-4" /> Upgrade
              </a>
            )}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <ProgressBar label={`Daily audits used: ${dailyUsed}/${dailyLimit}`} value={(dailyUsed / Math.max(1, dailyLimit)) * 100} tone="accent" />
            <ProgressBar label={`Monthly audits used: ${monthlyUsed}/${monthlyLimit}`} value={(monthlyUsed / Math.max(1, monthlyLimit)) * 100} tone="green" />
          </div>
          <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <div className="text-muted-foreground">Remaining today</div>
              <div className="text-2xl font-bold">{dailyRemaining}</div>
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <div className="text-muted-foreground">Remaining this month</div>
              <div className="text-2xl font-bold">{monthlyRemaining}</div>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-6">
          <h3 className="text-xl font-bold">Fast actions</h3>
          <p className="mt-1 text-sm text-muted-foreground">Start the right check without sorting through settings.</p>
          <div className="mt-5 grid gap-3">
            <button onClick={() => props.onOpenSeoAudit?.()} className="flex items-center justify-between rounded-2xl border border-border bg-background p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-muted active:scale-[0.99]">
              <span><span className="block font-bold">Check SEO visibility</span><span className="text-sm text-muted-foreground">Titles, descriptions, Google access, links, and search previews.</span></span>
              <Search className="h-5 w-5 text-accent" />
            </button>
            <button onClick={() => props.onOpenSecurityAudit?.()} className="flex items-center justify-between rounded-2xl border border-border bg-background p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-muted active:scale-[0.99]">
              <span><span className="block font-bold">Check browser safety</span><span className="text-sm text-muted-foreground">HTTPS and public browser protection settings.</span></span>
              <ShieldCheck className="h-5 w-5 text-green-600" />
            </button>
          </div>
        </SurfaceCard>
      </div>

      <SitePreviewSection
        url={searchedUrl || 'https://example.com'}
        hostname={searchedUrl || 'example.com'}
        title={searchedUrl ? `Ready to audit ${searchedUrl}` : 'Example homepage audit preview'}
        description="Desktop, mobile, and Google-style previews make reports easier to understand before users read the details."
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <SurfaceCard className="p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold">Health summary</h3>
              <p className="text-sm text-muted-foreground">Readable bars explain what needs attention first.</p>
            </div>
            <Activity className="h-5 w-5 text-accent" />
          </div>
          <div className="grid gap-5 lg:grid-cols-[0.42fr_0.58fr]">
            <div className="flex items-center justify-center rounded-3xl border border-border bg-background/70 p-5">
              <RadialScoreGauge value={84} label="Latest health score" detail="Sample latest-audit dashboard view" />
            </div>
            <div className="grid gap-3">
              {categoryScores.slice(0, 5).map((item) => (
                <CategoryScoreBar key={item.label} label={item.label} value={item.value} tone={item.tone} />
              ))}
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-6">
          <div className="mb-5">
            <h3 className="text-xl font-bold">Fix priority</h3>
            <p className="text-sm text-muted-foreground">Urgent and high-priority items stay visible.</p>
          </div>
          <SeverityDistribution critical={3} high={6} medium={12} low={8} />
          <button onClick={() => props.onOpenSeoAudit?.()} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 font-semibold text-accent-foreground transition-colors hover:bg-accent/90">
            Open live audit <ArrowRight className="h-4 w-4" />
          </button>
        </SurfaceCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {[
          { title: 'Live SEO audit', text: 'See scan progress, pages checked, fixes found, and export-ready reports.', icon: Search },
          { title: 'Browser safety checks', text: 'Review HTTPS, browser protection settings, cookies, and exposed file signals.', icon: ShieldCheck },
          { title: 'Reports and briefs', text: 'Turn scan findings into client-ready exports and next actions.', icon: FileText },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <SurfaceCard key={item.title} className="p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                <Icon className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold">{item.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{item.text}</p>
            </SurfaceCard>
          );
        })}
      </div>
    </div>
  );
}
