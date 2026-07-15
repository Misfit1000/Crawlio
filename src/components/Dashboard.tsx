import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  FileText,
  Gauge,
  History,
  Layers,
  Lock,
  Rocket,
  Search,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getAuthHeaders } from '../lib/api/auth-headers';
import { API_ROUTES } from '../lib/api/routes';
import { readAuditHistory, scoreTrendForUrl, type AuditHistoryEntry } from '../lib/audit/client-insights';
import { groupRecommendations, scoreToGrade } from '../lib/audit/report-insights';
import { safeJsonFetch } from '../lib/http/safe-json';
import { isCompletedAuditStatus } from '../lib/audit/audit-time';
import {
  AuditGrade,
  CategoryGradeCard,
  EmptyState,
  MetricCard,
  ProgressBar,
  SeverityDistribution,
  SitePreviewSection,
  SparklineChart,
  StatusBadge,
  SurfaceCard,
} from './ui/visual-system';
import { PageHeader } from './ui/page-system';

interface DashboardProps {
  onOpenSeoAudit?: () => void;
  onOpenSecurityAudit?: () => void;
  onOpenReports?: () => void;
  onOpenImports?: () => void;
}

function selectReport(entry: AuditHistoryEntry, onOpenReports?: () => void) {
  window.localStorage.setItem('crawlio_selected_report_id', entry.auditId);
  onOpenReports?.();
}

function formatDate(value?: string | null) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
}

export default function Dashboard(props: DashboardProps) {
  const { user } = useAuth();
  const [planData, setPlanData] = useState<any | null>(null);
  const [history, setHistory] = useState<AuditHistoryEntry[]>([]);
  const [importState, setImportState] = useState({ search: false, rankings: false });
  const upgradeUrl = import.meta.env.VITE_UPGRADE_URL;

  useEffect(() => {
    setHistory(readAuditHistory());
    setImportState({
      search: Boolean(window.localStorage.getItem('seo_gsc_data')),
      rankings: Boolean(window.localStorage.getItem('seo_keyword_data')),
    });
  }, []);

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
  const latest = history[0] || null;
  const latestScore = isCompletedAuditStatus(latest?.status) ? latest?.score ?? null : null;
  const latestGrade = scoreToGrade(latestScore);
  const latestPreview = latest?.pageSummaries.find((page) => page.title || page.metaDescription) || latest?.pageSummaries[0];
  const recommendations = useMemo(() => groupRecommendations(latest?.topIssues || []).slice(0, 4), [latest]);
  const trend = useMemo(() => latest ? scoreTrendForUrl(latest.normalizedUrl, history) : [], [history, latest]);
  const latestScores = latest?.scores;

  return (
    <div className="w-full space-y-8 animate-rise">
      <PageHeader
        eyebrow="Workspace overview"
        icon={Gauge}
        title="Website audit workspace"
        description="Review current plan usage, measured website health, recent audit history, and the next fixes that deserve attention."
        actions={<button type="button" onClick={props.onOpenSeoAudit} className="trust-button"><Rocket className="h-4 w-4" /> Start new audit</button>}
      />
      <SurfaceCard className="p-0">
        <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <div className="p-6 md:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={plan === 'free' ? 'warning' : 'success'}>{plan} plan</StatusBadge>
              <StatusBadge tone="accent">{plan === 'free' ? 'Quick audits' : 'Full audits'}</StatusBadge>
            </div>
            <h2 className="mt-5 max-w-3xl text-2xl font-semibold leading-tight md:text-3xl">Audit results and next actions in one place</h2>
            <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">
              Run a live website scan, review the highest-priority fixes, and return to measured results without mixing in unsupported ranking or backlink data.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={props.onOpenSeoAudit} className="trust-button">
                <Rocket className="h-4 w-4" /> Start website audit
              </button>
              <button type="button" onClick={props.onOpenImports} className="quiet-button">
                <Upload className="h-4 w-4" /> Import search data
              </button>
            </div>
          </div>
          <div className="border-t border-border bg-muted/30 p-6 md:p-8 lg:border-l lg:border-t-0">
            {latest ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-muted-foreground">Latest audit</div>
                    <div className="mt-1 truncate font-semibold">{latest.hostname || latest.normalizedUrl}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{formatDate(latest.updatedAt)}</div>
                  </div>
                  <StatusBadge tone={isCompletedAuditStatus(latest.status) ? 'success' : latest.status === 'failed' ? 'danger' : 'warning'}>{latest.status.replace(/_/g, ' ')}</StatusBadge>
                </div>
                <AuditGrade
                  score={latestScore}
                  detail={!isCompletedAuditStatus(latest.status) ? `No final score: audit ${latest.status}` : latest.scoreSource === 'final_report' ? 'Final audit engine score' : 'Final score unavailable'}
                />
                <button type="button" onClick={() => selectReport(latest, props.onOpenReports)} className="quiet-button w-full">
                  Open full report <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <EmptyState
                icon={Gauge}
                title="No audit results yet"
                description="Run a website audit to populate this workspace with measured scores, findings, and page evidence."
                action={<button type="button" onClick={props.onOpenSeoAudit} className="trust-button">Start first audit</button>}
              />
            )}
          </div>
        </div>
      </SurfaceCard>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Latest grade"
          value={latestGrade || '--'}
          detail={latestScore != null ? `${Math.round(latestScore)}/100 final score` : latest ? `Latest audit ${latest.status}; score unavailable` : 'No audit completed'}
          icon={<Gauge className="h-5 w-5" />}
          tone={latest?.score != null && latest.score >= 80 ? 'green' : latest ? 'yellow' : 'accent'}
        />
        <MetricCard label="Pages checked" value={latest?.pagesCrawled ?? '--'} detail={latest?.pageLimit ? `Audit limit: ${latest.pageLimit}` : latest ? 'Stored page summaries' : 'No page data stored'} icon={<Layers className="h-5 w-5" />} />
        <MetricCard label="Open fixes" value={latest?.issuesFound ?? '--'} detail={latest ? `${latest.criticalCount} fix now, ${latest.highCount} high priority` : 'No findings stored'} icon={<AlertTriangle className="h-5 w-5" />} tone={latest?.criticalCount ? 'red' : latest ? 'yellow' : 'accent'} />
        <MetricCard label="Saved audits" value={history.length || '--'} detail={history.length ? `${new Set(history.map((entry) => entry.normalizedUrl)).size} audited site(s)` : 'History is stored in this browser'} icon={<History className="h-5 w-5" />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <SurfaceCard className="p-5 md:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Plan usage</h2>
              <p className="mt-1 text-sm text-muted-foreground">Actual audit usage and limits from your current plan.</p>
            </div>
            {plan === 'free' && (
              <a
                href={upgradeUrl || '#'}
                onClick={(event) => {
                  if (!upgradeUrl) {
                    event.preventDefault();
                    window.alert('Paid plans are not connected yet. Contact the administrator to change your plan.');
                  }
                }}
                className="quiet-button"
              >
                <Lock className="h-4 w-4" /> Plan options
              </a>
            )}
          </div>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <ProgressBar label={`Daily audits: ${dailyUsed}/${dailyLimit}`} value={(dailyUsed / Math.max(1, dailyLimit)) * 100} tone="accent" />
            <ProgressBar label={`Monthly audits: ${monthlyUsed}/${monthlyLimit}`} value={(monthlyUsed / Math.max(1, monthlyLimit)) * 100} tone="green" />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-muted/25 p-4">
              <div className="text-sm text-muted-foreground">Remaining today</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{dailyRemaining}</div>
            </div>
            <div className="rounded-xl border border-border bg-muted/25 p-4">
              <div className="text-sm text-muted-foreground">Remaining this month</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{monthlyRemaining}</div>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-5 md:p-6">
          <h2 className="text-xl font-semibold">Quick actions</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choose what you want to do next.</p>
          <div className="mt-5 grid gap-2">
            {[
              { label: 'Run website audit', detail: 'SEO, technical, crawl, and page checks', icon: Search, action: props.onOpenSeoAudit },
              { label: 'Passive Security Review', detail: 'HTTPS and browser protection observations', icon: ShieldCheck, action: props.onOpenSecurityAudit },
              { label: 'Import real data', detail: 'Search and ranking data from your files', icon: Upload, action: props.onOpenImports },
              { label: 'Open reports', detail: 'History, evidence, and exports', icon: FileText, action: props.onOpenReports },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.label} type="button" onClick={item.action} className="flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.label}</span><span className="block truncate text-xs text-muted-foreground">{item.detail}</span></span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </SurfaceCard>
      </div>

      {isCompletedAuditStatus(latest?.status) && (
        <section className="space-y-5" aria-labelledby="latest-health-title">
          <div>
            <h2 id="latest-health-title" className="text-2xl font-semibold">Latest audit health</h2>
            <p className="mt-1 text-sm text-muted-foreground">Final section grades appear only when the audit engine supplied them.</p>
          </div>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
            <SurfaceCard className="p-5 md:p-6">
              {latest.scoreSource === 'final_report' && latestScores ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <CategoryGradeCard label="On-page SEO" score={latestScores.seo} description="Content and metadata findings." icon={<Search className="h-4 w-4" />} />
                  <CategoryGradeCard label="Technical SEO" score={latestScores.technical} description="Technical delivery findings." icon={<Gauge className="h-4 w-4" />} />
                  <CategoryGradeCard label="Crawlability" score={latestScores.crawlability} description="Search engine access signals." icon={<Layers className="h-4 w-4" />} />
                  <CategoryGradeCard label="Performance" score={latestScores.performance} description="Observed response and size signals." icon={<BarChart3 className="h-4 w-4" />} />
                  <CategoryGradeCard label="Passive Security Review" score={latestScores.security} description="Non-invasive browser protection checks." icon={<ShieldCheck className="h-4 w-4" />} />
                  <CategoryGradeCard label="Mobile usability" score={null} description="Not scored by the current audit engine." icon={<Layers className="h-4 w-4" />} />
                </div>
              ) : (
                <EmptyState icon={BarChart3} title="Section grades are not stored" description="Open or rerun a completed audit to save final category scores from the audit engine. No category values are estimated here." />
              )}
            </SurfaceCard>
            <SurfaceCard className="p-5 md:p-6">
              <h3 className="text-lg font-semibold">Fix priority</h3>
              <p className="mb-5 mt-1 text-sm text-muted-foreground">Measured issue counts from the latest audit.</p>
              <SeverityDistribution critical={latest.criticalCount} high={latest.highCount} medium={latest.mediumCount} low={latest.lowCount} />
            </SurfaceCard>
          </div>
        </section>
      )}

      {latestPreview && latest && (
        <SitePreviewSection
          url={latestPreview.url || latest.normalizedUrl}
          hostname={latest.hostname}
          title={latestPreview.title}
          description={latestPreview.metaDescription}
          h1={latestPreview.h1}
          canonicalUrl={latestPreview.canonicalUrl}
          siteName={latestPreview.siteName}
          faviconUrl={latestPreview.faviconUrl}
          openGraphImage={latestPreview.openGraphImage}
          screenshotUrl={latestPreview.screenshotUrl}
          themeColor={latestPreview.themeColor}
        />
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <SurfaceCard className="p-0">
          <div className="flex items-center justify-between gap-4 border-b border-border p-5 md:p-6">
            <div>
              <h2 className="text-xl font-semibold">Recent audits</h2>
              <p className="mt-1 text-sm text-muted-foreground">Reports saved in this browser.</p>
            </div>
            <button type="button" onClick={props.onOpenReports} className="quiet-button">All reports</button>
          </div>
          {history.length ? (
            <div className="overflow-x-auto">
              <table className="suite-table min-w-[760px]">
                <thead><tr><th>Website</th><th>Grade</th><th>Pages</th><th>Fixes</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead>
                <tbody>
                  {history.slice(0, 8).map((entry) => (
                    <tr key={entry.auditId}>
                      <td className="max-w-[280px] truncate font-semibold">{entry.normalizedUrl}</td>
                      <td className="font-semibold tabular-nums">{isCompletedAuditStatus(entry.status) && entry.score != null ? <>{scoreToGrade(entry.score) || '--'} <span className="text-xs text-muted-foreground">{Math.round(entry.score)}</span></> : '--'}</td>
                      <td className="tabular-nums">{entry.pagesCrawled}</td>
                      <td className="tabular-nums">{entry.issuesFound}</td>
                      <td><StatusBadge tone={isCompletedAuditStatus(entry.status) ? 'success' : entry.status === 'failed' ? 'danger' : 'warning'}>{entry.status.replace(/_/g, ' ')}</StatusBadge></td>
                      <td className="text-muted-foreground">{new Date(entry.updatedAt).toLocaleDateString()}</td>
                      <td><button type="button" onClick={() => selectReport(entry, props.onOpenReports)} className="text-sm font-semibold text-accent hover:underline">View report</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-5 md:p-6"><EmptyState icon={History} title="Audit history is empty" description="Completed and in-progress audits will appear here after you start a website audit." /></div>
          )}
        </SurfaceCard>

        <div className="space-y-6">
          <SurfaceCard className="p-5 md:p-6">
            <h2 className="text-xl font-semibold">Top fixes</h2>
            <p className="mt-1 text-sm text-muted-foreground">Highest-priority grouped findings from the latest stored audit.</p>
            {recommendations.length ? (
              <ol className="mt-5 divide-y divide-border">
                {recommendations.map((item, index) => (
                  <li key={item.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold tabular-nums">{index + 1}</span>
                    <div className="min-w-0"><div className="text-sm font-semibold">{item.title}</div><div className="mt-1 text-xs text-muted-foreground">{item.affectedCount || 'Site-wide'} affected page{item.affectedCount === 1 ? '' : 's'} | {item.severity}</div></div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="mt-5 text-sm leading-6 text-muted-foreground">No detailed findings are stored in browser history. Open the full report to load current evidence.</div>
            )}
          </SurfaceCard>

          <SurfaceCard className="p-5 md:p-6">
            <h2 className="text-xl font-semibold">Imported data</h2>
            <p className="mt-1 text-sm text-muted-foreground">Crawlio never substitutes demo rankings or traffic for missing provider data.</p>
            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">Search performance</span><StatusBadge tone={importState.search ? 'success' : 'warning'}>{importState.search ? 'Imported' : 'Import data'}</StatusBadge></div>
              <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">Keyword positions</span><StatusBadge tone={importState.rankings ? 'success' : 'warning'}>{importState.rankings ? 'Imported' : 'Provider required'}</StatusBadge></div>
              <button type="button" onClick={props.onOpenImports} className="quiet-button mt-2 w-full"><Upload className="h-4 w-4" /> Manage imports</button>
            </div>
          </SurfaceCard>

          {trend.length > 1 && (
            <SparklineChart values={trend.map((entry) => entry.score)} label="Score trend" valueLabel={`${Math.round(trend[trend.length - 1].score)}/100`} />
          )}
        </div>
      </div>
    </div>
  );
}
