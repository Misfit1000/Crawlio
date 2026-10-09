import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BarChart3, FileText, Gauge, History, Layers, Rocket, Search, ShieldCheck, Upload } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { readAuditHistory, scoreTrendForUrl, type AuditHistoryEntry } from '../lib/audit/client-insights';
import { groupRecommendations, scoreToGrade } from '../lib/audit/report-insights';
import { isCompletedAuditStatus } from '../lib/audit/audit-time';
import { AuditGrade, CategoryGradeCard, SeverityDistribution, SitePreviewSection, SparklineChart, StatusBadge } from './ui/visual-system';
import { PageHeader } from './ui/page-system';
import ProjectCockpit from './projects/ProjectCockpit';
import { Link } from '../app/router';

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
  const [history, setHistory] = useState<AuditHistoryEntry[]>([]);
  const [importState, setImportState] = useState({ search: false, rankings: false });

  useEffect(() => {
    setHistory(readAuditHistory());
    setImportState({
      search: Boolean(window.localStorage.getItem('seo_gsc_data')),
      rankings: Boolean(window.localStorage.getItem('seo_keyword_data')),
    });
  }, []);

  const limits = user?.auditEntitlements;
  const plan = user?.plan || 'free';
  const dailyLimit = Number(limits?.dailyAudits ?? (plan === 'free' ? 3 : 25));
  const monthlyLimit = Number(limits?.monthlyAudits ?? (plan === 'free' ? 30 : 500));
  const dailyUsed = Number(user?.auditQuotaUsedDaily ?? 0);
  const monthlyUsed = Number(user?.auditQuotaUsedMonthly ?? 0);
  const latest = history[0] || null;
  const completed = isCompletedAuditStatus(latest?.status);
  const latestScore = completed ? latest?.score ?? null : null;
  const latestPreview = latest?.pageSummaries.find(page => page.title || page.metaDescription) || latest?.pageSummaries[0];
  const recommendations = useMemo(() => groupRecommendations(latest?.topIssues || []).slice(0, 4), [latest]);
  const trend = useMemo(() => latest ? scoreTrendForUrl(latest.normalizedUrl, history) : [], [history, latest]);
  const latestScores = latest?.scores;

  return <div className="min-w-0 w-full space-y-6 animate-rise [&_.rounded-xl]:rounded-lg">
    <PageHeader icon={Gauge} title="Dashboard" actions={<button type="button" className="trust-button" onClick={props.onOpenSeoAudit}><Search className="h-4 w-4" />New audit</button>} />
    {user ? <ProjectCockpit onStartAudit={props.onOpenSeoAudit || (() => undefined)} onOpenReports={props.onOpenReports || (() => undefined)} /> : <section aria-labelledby="current-website-title" className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0"><h2 id="current-website-title" className="break-words text-xl font-semibold">{latest?.hostname || 'Your first website audit'}</h2>{latest && <p className="mt-1 text-xs text-muted-foreground">Last run {formatDate(latest.updatedAt)}</p>}</div>
        {latest && <StatusBadge tone={completed ? 'success' : latest.status === 'failed' ? 'danger' : 'warning'}>{latest.status.replace(/_/g, ' ')}</StatusBadge>}
      </div>
      <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,.6fr)_minmax(0,1fr)]">
        {latest && <AuditGrade compact score={latestScore} detail={!completed ? `No final score: audit ${latest.status}` : latest.scoreSource === 'final_report' ? 'Final audit engine score' : 'Final score unavailable'} />}
        <div className="min-w-0"><h3 className="text-sm font-semibold">Next action</h3><p className="mt-1 break-words text-sm text-muted-foreground">{latest ? completed ? recommendations[0]?.title || 'Review the report and its page evidence.' : 'Open the latest audit to check its progress or failure.' : 'Run an audit to measure website health and find your first fixes.'}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={latest ? () => selectReport(latest, props.onOpenReports) : props.onOpenSeoAudit} className="trust-button">{latest ? 'Open latest report' : 'Start first audit'}<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>{latest && <button type="button" onClick={props.onOpenSeoAudit} className="quiet-button"><Rocket className="h-4 w-4" aria-hidden="true" />Run again</button>}</div></div>
      </div>
      {latest && <dl className="grid grid-cols-3 gap-3 border-t border-border pt-3">{[['Pages checked', latest.pagesCrawled], ['Open fixes', latest.issuesFound], ['Saved audits', history.length]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd></div>)}</dl>}
    </section>}

    <section aria-labelledby="usage-title" className="dashboard-usage">
      <div className="flex items-center gap-2"><h2 id="usage-title" className="text-sm font-semibold">Usage</h2><StatusBadge>{plan === 'paid' ? 'Plus' : plan === 'agency' ? 'Pro' : plan} plan</StatusBadge></div>
      <div className="usage-item"><meter aria-label="Daily audit usage" min={0} max={Math.max(1,dailyLimit)} value={dailyUsed} /><span className="text-sm"><strong>{dailyUsed}/{dailyLimit.toLocaleString()}</strong> today</span></div>
      <div className="usage-item"><meter aria-label="Monthly audit usage" min={0} max={Math.max(1,monthlyLimit)} value={monthlyUsed} /><span className="text-sm"><strong>{monthlyUsed}/{monthlyLimit.toLocaleString()}</strong> this month</span></div>
      <Link to="/app/settings#scan-preferences" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">Plan access <ArrowRight className="ml-2 h-4 w-4" /></Link>
    </section>

    <section aria-label="Quick actions" className="flex flex-wrap gap-2">
      {[
        { label: 'Passive security review', icon: ShieldCheck, action: props.onOpenSecurityAudit },
        { label: 'Import data', icon: Upload, action: props.onOpenImports },
        { label: 'Reports', icon: FileText, action: props.onOpenReports },
      ].map(item => <button key={item.label} type="button" onClick={item.action} className="quiet-button min-h-11"><item.icon className="h-4 w-4" aria-hidden="true" />{item.label}</button>)}
    </section>

    <section aria-label="Saved audit details">
      <div className="min-w-0 space-y-6">
        {completed && latest && <section aria-labelledby="latest-health-title" className="space-y-3">
          <h2 id="latest-health-title" className="text-lg font-semibold">Latest saved audit health</h2>
          <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,.65fr)]">
            {latest.scoreSource === 'final_report' && latestScores ? <div className="grid min-w-0 gap-x-8 sm:grid-cols-2">
              <CategoryGradeCard label="On-page SEO" score={latestScores.seo} description="Content and metadata findings." icon={<Search className="h-4 w-4" />} />
              <CategoryGradeCard label="Technical SEO" score={latestScores.technical} description="Technical delivery findings." icon={<Gauge className="h-4 w-4" />} />
              <CategoryGradeCard label="Crawlability" score={latestScores.crawlability} description="Search engine access signals." icon={<Layers className="h-4 w-4" />} />
              <CategoryGradeCard label="Performance" score={latestScores.performance} description="Observed response and size signals." icon={<BarChart3 className="h-4 w-4" />} />
              <CategoryGradeCard label="Passive Security Review" score={latestScores.security} description="Non-invasive browser protection checks." icon={<ShieldCheck className="h-4 w-4" />} />
              <CategoryGradeCard label="Accessibility signals" score={latestScores.accessibility} description="Automated HTML observations, not certification." icon={<Layers className="h-4 w-4" />} />
              <CategoryGradeCard label="Mobile usability" score={null} description="Not scored by the current audit engine." icon={<Layers className="h-4 w-4" />} />
            </div> : <p className="text-sm text-muted-foreground">Section grades are not stored. Open the completed report for final category scores.</p>}
            <div className="min-w-0"><h3 className="mb-3 text-base font-semibold">Fix priority</h3><SeverityDistribution critical={latest.criticalCount} high={latest.highCount} medium={latest.mediumCount} low={latest.lowCount} /></div>
          </div>
        </section>}

        {latestPreview && latest && <SitePreviewSection url={latestPreview.url || latest.normalizedUrl} hostname={latest.hostname} title={latestPreview.title} description={latestPreview.metaDescription} h1={latestPreview.h1} canonicalUrl={latestPreview.canonicalUrl} siteName={latestPreview.siteName} faviconUrl={latestPreview.faviconUrl} openGraphImage={latestPreview.openGraphImage} screenshotUrl={latestPreview.screenshotUrl} themeColor={latestPreview.themeColor} />}

        <section aria-labelledby="recent-audits-title" className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="recent-audits-title" className="text-lg font-semibold">Recent audits</h2><p className="mt-1 text-xs text-muted-foreground">Saved in this browser.</p></div><button type="button" onClick={props.onOpenReports} className="quiet-button min-h-11">All reports</button></div>
          {history.length ? <div className="max-w-full overflow-x-auto" role="region" aria-label="Recent audits" tabIndex={0}>
            <table className="suite-table min-w-[760px]">
              <caption className="sr-only">Recent website audits with grade, page coverage, finding count, status, and last update.</caption>
              <thead><tr>{['Website', 'Grade', 'Pages', 'Fixes', 'Status', 'Updated', 'Action'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
              <tbody>{history.slice(0, 8).map(entry => <tr key={entry.auditId}>
                <td className="max-w-[280px] truncate font-semibold">{entry.normalizedUrl}</td>
                <td className="font-semibold tabular-nums">{isCompletedAuditStatus(entry.status) && entry.score != null ? <>{scoreToGrade(entry.score) || '--'} <span className="text-xs text-muted-foreground">{Math.round(entry.score)}</span></> : '--'}</td>
                <td className="tabular-nums">{entry.pagesCrawled}</td><td className="tabular-nums">{entry.issuesFound}</td>
                <td><StatusBadge tone={isCompletedAuditStatus(entry.status) ? 'success' : entry.status === 'failed' ? 'danger' : 'warning'}>{entry.status.replace(/_/g, ' ')}</StatusBadge></td>
                <td className="text-muted-foreground">{new Date(entry.updatedAt).toLocaleDateString()}</td>
                <td><button type="button" onClick={() => selectReport(entry, props.onOpenReports)} className="min-h-11 text-sm font-semibold text-accent hover:underline">View report</button></td>
              </tr>)}</tbody>
            </table>
          </div> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><History className="h-4 w-4" aria-hidden="true" />No audits saved yet.</p>}
        </section>

        <div className="grid min-w-0 gap-6 lg:grid-cols-2">
          <section className="min-w-0"><h2 className="text-lg font-semibold">Top fixes</h2>{recommendations.length ? <ol className="mt-3 divide-y divide-border">{recommendations.map((item, index) => <li key={item.id} className="flex min-w-0 gap-3 py-3"><span className="shrink-0 text-sm font-semibold tabular-nums">{index + 1}</span><div className="min-w-0"><div className="break-words text-sm font-semibold">{item.title}</div><div className="mt-1 text-xs text-muted-foreground">{item.affectedCount || 'Site-wide'} affected page{item.affectedCount === 1 ? '' : 's'} | {item.severity}</div></div></li>)}</ol> : <p className="mt-3 text-sm text-muted-foreground">Open a report to load detailed findings.</p>}</section>
          <section className="min-w-0"><h2 className="text-lg font-semibold">Imported data</h2><div className="mt-3 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">Search performance</span><StatusBadge tone={importState.search ? 'success' : 'neutral'}>{importState.search ? 'Imported' : 'Import data'}</StatusBadge></div><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">Keyword positions</span><StatusBadge tone={importState.rankings ? 'success' : 'neutral'}>{importState.rankings ? 'Imported' : 'Provider required'}</StatusBadge></div><button type="button" onClick={props.onOpenImports} className="quiet-button min-h-11"><Upload className="h-4 w-4" aria-hidden="true" />Manage imports</button></div></section>
        </div>
        {trend.length > 1 && <SparklineChart values={trend.map(entry => entry.score)} label="Score trend" valueLabel={`${Math.round(trend[trend.length - 1].score)}/100`} />}
      </div>
    </section>
  </div>;
}
