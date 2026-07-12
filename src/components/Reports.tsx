import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Clipboard,
  Download,
  FileJson,
  FileText,
  FileSpreadsheet,
  Globe2,
  History,
  Layers,
  Link2,
  Loader2,
  MonitorSmartphone,
  Printer,
  Search,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react';
import { API_ROUTES } from '../lib/api/routes';
import { getAuditAccessHeaders } from '../lib/api/auth-headers';
import {
  buildHistoryEntry,
  buildIssueInsight,
  readAuditHistory,
  upsertAuditHistory,
  type AuditHistoryEntry,
} from '../lib/audit/client-insights';
import {
  REPORT_SECTIONS,
  extractReportScores,
  formatBytes,
  formatMilliseconds,
  groupRecommendations,
  observedPageMetrics,
  scoreToGrade,
  type RecommendationGroup,
  type ReportSectionId,
} from '../lib/audit/report-insights';
import type { AuditHistoryPage, ResourceAuditIssue, ResourceAuditLiveData, ResourceAuditPage } from '../lib/audit/resource-types';
import { downloadAuditExport } from '../lib/http/download';
import { safeJsonFetch } from '../lib/http/safe-json';
import {
  AuditGrade,
  CategoryGradeCard,
  EmptyState,
  FindingRow,
  MetricCard,
  SeverityDistribution,
  SitePreviewSection,
  StatusBadge,
  StickyReportNavigation,
  SurfaceCard,
} from './ui/visual-system';
import { PageHeader } from './ui/page-system';

type ApiEnvelope<T> = { success: boolean; data: T; error?: string };
type PageStatusFilter = 'all' | '2xx' | '3xx' | '4xx' | '5xx';
type PageSort = 'issues' | 'url' | 'status' | 'response' | 'size';

interface ReportsProps {
  onStartAudit?: () => void;
  initialSection?: string;
}

const PAGE_SIZE = 15;

function reportViewCopy(initialSection?: string) {
  const views: Record<string, { eyebrow: string; title: string; description: string }> = {
    'report-history': { eyebrow: 'Audit history', title: 'Audit history and comparisons', description: 'Review real stored audit runs by website, date, mode, status, pages, and measured score.' },
    'report-on-page': { eyebrow: 'SEO findings', title: 'On-page SEO findings', description: 'Review stored metadata, headings, content, image, and social-preview findings with affected-page evidence.' },
    'report-technical': { eyebrow: 'Technical SEO', title: 'Technical SEO evidence', description: 'Inspect measured status, redirect, delivery, preferred URL, and technical page findings from the selected audit.' },
    'report-crawlability': { eyebrow: 'Crawlability', title: 'Crawlability and indexing', description: 'Review discovered pages, search-engine access, preferred URL signals, and page-level crawl evidence.' },
    'report-performance': { eyebrow: 'Performance', title: 'Performance observations', description: 'Inspect audit-time response and HTML payload observations without mislabeling them as Core Web Vitals.' },
    'report-pages': { eyebrow: 'Page explorer', title: 'Audited pages', description: 'Search, filter, sort, and inspect the actual page summaries stored by the audit engine.' },
  };
  return initialSection && views[initialSection]
    ? views[initialSection]
    : { eyebrow: 'Reports', title: 'Professional audit report', description: 'Start with the executive result, work through prioritized recommendations, then open technical evidence only when needed.' };
}

function formatDate(value?: string | null) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
}

function whyThisMatters(section: ReportSectionId) {
  const copy: Record<ReportSectionId, string> = {
    'on-page': 'Clear page content and metadata help search engines and people understand what the page offers.',
    technical: 'Reliable technical delivery helps search engines fetch pages and helps users reach the intended content.',
    crawlability: 'Search engine access and preferred URL signals affect whether the right pages can be discovered and indexed.',
    'internal-links': 'Internal links help users navigate and help search engines discover and understand page relationships.',
    performance: 'Large pages and slow server responses can delay navigation and make crawling less efficient.',
    mobile: 'Mobile-readiness signals affect how comfortably visitors can use the page on narrow screens.',
    security: 'Browser protection settings reduce avoidable client-side risk. SEOIntel records observations only and does not attempt exploitation.',
    'structured-data': 'Structured and social metadata can improve how public page information is interpreted and previewed.',
  };
  return copy[section];
}

function severityCounts(data: ResourceAuditLiveData | null, fallback: AuditHistoryEntry | null) {
  const audit = data?.audit;
  return {
    critical: audit?.criticalCount ?? fallback?.criticalCount ?? 0,
    high: audit?.highCount ?? fallback?.highCount ?? 0,
    medium: audit?.mediumCount ?? fallback?.mediumCount ?? 0,
    low: audit?.lowCount ?? fallback?.lowCount ?? 0,
  };
}

function groupRepresentative(group: RecommendationGroup, issues: ResourceAuditIssue[]) {
  return issues.find((issue) => issue.title === group.title && issue.category === group.category) || null;
}

function matchesStatus(page: ResourceAuditPage, filter: PageStatusFilter) {
  if (filter === 'all') return true;
  return Math.floor(page.statusCode / 100) === Number(filter[0]);
}

function safeCsvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadLocalCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) throw new Error('No imported rows are available for this export.');
  const headers = Object.keys(rows[0]);
  const csv = [headers.map(safeCsvCell).join(','), ...rows.map((row) => headers.map((header) => safeCsvCell(row[header])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function Reports({ onStartAudit, initialSection }: ReportsProps) {
  const initialSectionHandled = useRef(false);
  const viewCopy = reportViewCopy(initialSection);
  const [history, setHistory] = useState<AuditHistoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ResourceAuditLiveData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pageQuery, setPageQuery] = useState('');
  const [pageStatus, setPageStatus] = useState<PageStatusFilter>('all');
  const [pageSort, setPageSort] = useState<PageSort>('issues');
  const [pageNumber, setPageNumber] = useState(1);

  useEffect(() => {
    let active = true;
    const requestedId = window.localStorage.getItem('seointel_selected_report_id');
    getAuditAccessHeaders()
      .then((headers) => safeJsonFetch<any>(`${API_ROUTES.auditHistory}?limit=100`, { headers }))
      .then((response) => {
        if (!active || !response.success) throw new Error((response as any).error || 'Stored audit history is unavailable.');
        const page = (response.data.data || response.data) as AuditHistoryPage;
        const entries = page.items
          .map((item) => buildHistoryEntry({ audit: item.audit, latestEvents: [], latestPages: item.finalReport?.pages || [], latestIssues: item.finalReport?.topIssues || [], finalReport: item.finalReport }))
          .filter((entry): entry is AuditHistoryEntry => Boolean(entry));
        setHistory(entries);
        setSelectedId(entries.some((entry) => entry.auditId === requestedId) ? requestedId : entries[0]?.auditId || null);
      })
      .catch(() => {
        if (!active) return;
        const cached = readAuditHistory();
        setHistory(cached);
        setSelectedId(cached.some((entry) => entry.auditId === requestedId) ? requestedId : cached[0]?.auditId || null);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!initialSection || initialSectionHandled.current || reportLoading || !history.length || !selectedId) return;
    initialSectionHandled.current = true;
    window.setTimeout(() => document.getElementById(initialSection)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }, [history.length, initialSection, reportLoading, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setReportData(null);
      setReportError(null);
      return;
    }

    let active = true;
    setReportLoading(true);
    setReportError(null);
    setReportData(null);
    window.localStorage.setItem('seointel_selected_report_id', selectedId);

    getAuditAccessHeaders()
      .then((headers) => safeJsonFetch<ApiEnvelope<ResourceAuditLiveData>>(API_ROUTES.auditResult(selectedId), { headers }))
      .then((response) => {
        if (!active) return;
        if ('error' in response) throw new Error(response.error);
        if (!response.data.success || !response.data.data?.audit) throw new Error(response.data.error || 'Audit report data is unavailable.');
        setReportData(response.data.data);
        upsertAuditHistory(response.data.data);
        const nextEntry = buildHistoryEntry(response.data.data);
        if (nextEntry) setHistory((current) => [nextEntry, ...current.filter((entry) => entry.auditId !== nextEntry.auditId)]);
      })
      .catch((error) => {
        if (active) setReportError(error instanceof Error ? error.message : 'Could not load this audit report.');
      })
      .finally(() => {
        if (active) setReportLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedId]);

  useEffect(() => {
    setPageNumber(1);
  }, [pageQuery, pageStatus, pageSort, selectedId]);

  const selectedHistory = history.find((entry) => entry.auditId === selectedId) || null;
  const groupedSites = useMemo(() => new Set(history.map((entry) => entry.normalizedUrl)).size, [history]);
  const scores = useMemo(() => extractReportScores(reportData?.finalReport?.scores), [reportData]);
  const overallScore = scores.overall ?? (selectedHistory?.status === 'completed' ? selectedHistory.score : null);
  const scoreIsFinal = scores.overall != null;
  const issues = reportData?.latestIssues || selectedHistory?.topIssues || [];
  const pages = reportData?.latestPages || [];
  const recommendations = useMemo(() => groupRecommendations(issues), [issues]);
  const counts = severityCounts(reportData, selectedHistory);
  const pageMetrics = useMemo(() => observedPageMetrics(pages), [pages]);
  const firstPage = pages.find((page) => page.title || page.metaDescription) || pages[0] || null;

  const sectionGroups = useMemo(() => {
    const result = new Map<ReportSectionId, RecommendationGroup[]>();
    REPORT_SECTIONS.forEach((section) => result.set(section.id, []));
    recommendations.forEach((recommendation) => result.get(recommendation.section)?.push(recommendation));
    return result;
  }, [recommendations]);

  const filteredPages = useMemo(() => {
    const query = pageQuery.trim().toLowerCase();
    return pages
      .filter((page) => matchesStatus(page, pageStatus))
      .filter((page) => !query || `${page.url} ${page.title} ${page.statusCode}`.toLowerCase().includes(query))
      .sort((left, right) => {
        if (pageSort === 'url') return left.url.localeCompare(right.url);
        if (pageSort === 'status') return right.statusCode - left.statusCode;
        if (pageSort === 'response') return right.responseTimeMs - left.responseTimeMs;
        if (pageSort === 'size') return right.pageSizeBytes - left.pageSizeBytes;
        return right.issueCount - left.issueCount;
      });
  }, [pageQuery, pageSort, pageStatus, pages]);

  const totalPages = Math.max(1, Math.ceil(filteredPages.length / PAGE_SIZE));
  const visiblePages = filteredPages.slice((pageNumber - 1) * PAGE_SIZE, pageNumber * PAGE_SIZE);

  const showMessage = (value: string) => {
    setMessage(value);
    window.setTimeout(() => setMessage(null), 4000);
  };

  const handleAuditExport = async (format: 'json' | 'issues.csv' | 'pages.csv' | 'pdf') => {
    if (!selectedId) return showMessage('Select an audit before exporting.');
    setActionLoading(format);
    try {
      await downloadAuditExport(selectedId, format);
      showMessage(`${format === 'pdf' ? 'PDF report' : format.toUpperCase()} downloaded.`);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleImportedExport = (type: 'search' | 'keywords') => {
    setActionLoading(type);
    try {
      const raw = window.localStorage.getItem(type === 'search' ? 'seo_gsc_data' : 'seo_keyword_data');
      const rows = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(rows)) throw new Error('Imported data is not in a supported format.');
      downloadLocalCsv(`seointel-${type}-export.csv`, rows);
      showMessage(`${type === 'search' ? 'Search' : 'Keyword'} data downloaded.`);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Imported data export failed.');
    } finally {
      setActionLoading(null);
    }
  };

  const copyReportLink = async () => {
    if (!selectedId) return showMessage('Select an audit before copying a report link.');
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/audit/live/${selectedId}`);
      showMessage('Report link copied. Access still follows the current audit permissions.');
    } catch {
      showMessage('Copy failed. Open the audit and copy its browser URL.');
    }
  };

  if (!history.length) {
    return (
      <div className="w-full space-y-8 animate-rise">
        <PageHeader eyebrow={viewCopy.eyebrow} icon={FileText} title={viewCopy.title} description="Run a website audit to populate this workspace with measured scores, prioritized fixes, page evidence, and export-ready summaries." />
        <SurfaceCard className="p-5 md:p-8">
          <EmptyState
            icon={History}
            title="No audit reports yet"
            description="Run a website audit to create a report. SEOIntel will not fill this workspace with sample rankings, traffic, backlinks, or made-up scores."
            action={onStartAudit ? <button type="button" onClick={onStartAudit} className="trust-button">Start website audit</button> : undefined}
          />
        </SurfaceCard>
      </div>
    );
  }

  return (
    <div className="w-full space-y-8 animate-rise">
      <PageHeader
        eyebrow={viewCopy.eyebrow}
        icon={FileText}
        title={viewCopy.title}
        description={viewCopy.description}
        actions={selectedHistory ? <StatusBadge tone={selectedHistory.status === 'completed' ? 'success' : 'warning'}>{selectedHistory.status}</StatusBadge> : undefined}
      />

      <div id="report-history" className="scroll-mt-28">
      <SurfaceCard className="p-0">
        <div className="grid lg:grid-cols-[minmax(300px,0.7fr)_minmax(0,1.3fr)]">
          <div className="border-b border-border p-5 md:p-6 lg:border-b-0 lg:border-r">
            <label htmlFor="report-audit" className="text-sm font-semibold">Report to review</label>
            <select id="report-audit" value={selectedId || ''} onChange={(event) => setSelectedId(event.target.value)} className="suite-input mt-2">
              {history.map((entry) => <option key={entry.auditId} value={entry.auditId}>{entry.hostname || entry.normalizedUrl} - {new Date(entry.updatedAt).toLocaleDateString()}</option>)}
            </select>
            <div className="mt-5 space-y-2 text-sm">
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Website</span><span className="max-w-[65%] truncate font-semibold">{reportData?.audit?.normalizedUrl || selectedHistory?.normalizedUrl}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Audit type</span><span className="font-semibold">{reportData?.audit?.effectiveMode || selectedHistory?.mode || 'Not stored'}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Ended</span><span className="text-right font-semibold">{formatDate(reportData?.audit?.completedAt || reportData?.audit?.cancelledAt || selectedHistory?.completedAt || selectedHistory?.updatedAt)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Saved audits</span><span className="font-semibold tabular-nums">{history.length} across {groupedSites} site(s)</span></div>
            </div>
          </div>
          <div className="p-5 md:p-6">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <AuditGrade score={overallScore} detail={scoreIsFinal ? 'Final audit engine score' : selectedHistory?.status === 'completed' ? 'Estimated from stored issue counts; final score unavailable' : `No final score: audit ${selectedHistory?.status || 'not completed'}`} />
              <div className="flex flex-wrap gap-2 no-print">
                <button type="button" onClick={copyReportLink} className="quiet-button"><Share2 className="h-4 w-4" /> Copy link</button>
                <button type="button" onClick={() => window.print()} className="quiet-button"><Printer className="h-4 w-4" /> Print</button>
                <button type="button" onClick={() => handleAuditExport('pdf')} disabled={Boolean(actionLoading) || selectedHistory?.status !== 'completed'} className="trust-button">
                  {actionLoading === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF
                </button>
              </div>
            </div>
            {message && <div role="status" className="mt-5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><Clipboard className="mr-2 inline h-4 w-4" />{message}</div>}
          </div>
        </div>
      </SurfaceCard>
      </div>

      {reportLoading && <SurfaceCard className="flex items-center gap-3 p-6 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin text-accent" /> Loading stored audit evidence...</SurfaceCard>}
      {reportError && <SurfaceCard className="border-red-500/25 p-5"><div className="flex gap-3 text-red-700 dark:text-red-300"><AlertTriangle className="h-5 w-5 shrink-0" /><div><div className="font-semibold">Full report data could not be loaded</div><p className="mt-1 text-sm">{reportError}</p><p className="mt-2 text-xs text-muted-foreground">The browser history summary remains visible, but no missing section data is being invented.</p></div></div></SurfaceCard>}

      <StickyReportNavigation items={[
        { id: 'report-summary', label: 'Summary' },
        { id: 'recommendations', label: 'Top fixes', count: recommendations.length },
        ...REPORT_SECTIONS.map((section) => ({ id: `report-${section.id}`, label: section.label, count: sectionGroups.get(section.id)?.length || 0 })),
        { id: 'report-pages', label: 'Pages', count: pages.length },
        { id: 'report-exports', label: 'Exports' },
      ]} />

      <section id="report-summary" className="scroll-mt-32 space-y-5" aria-labelledby="report-summary-title">
        <div>
          <h2 id="report-summary-title" className="text-2xl font-semibold">Executive summary</h2>
          <p className="mt-1 text-sm text-muted-foreground">The audit result and its measured categories, before technical detail.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Overall grade" value={scoreToGrade(overallScore) || '--'} detail={overallScore == null ? 'Not measured' : `${Math.round(overallScore)}/100 ${scoreIsFinal ? 'final score' : 'stored estimate'}`} icon={<BarChart3 className="h-5 w-5" />} tone={overallScore != null && overallScore >= 80 ? 'green' : 'yellow'} />
          <MetricCard label="Pages checked" value={reportData?.audit?.pagesCrawled ?? selectedHistory?.pagesCrawled ?? '--'} detail={reportData?.audit ? `${reportData.audit.pagesDiscovered} discovered` : 'Stored audit summary'} icon={<Layers className="h-5 w-5" />} />
          <MetricCard label="Fix now" value={counts.critical} detail={`${counts.high} high-priority finding(s)`} icon={<AlertTriangle className="h-5 w-5" />} tone={counts.critical ? 'red' : counts.high ? 'yellow' : 'green'} />
          <MetricCard label="Observed pages" value={pages.length || '--'} detail={pages.length ? `${pageMetrics.errorPages} returned an error status` : 'Page details unavailable'} icon={<Globe2 className="h-5 w-5" />} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <SurfaceCard className="p-5 md:p-6">
            <h3 className="text-lg font-semibold">Section grades</h3>
            <p className="mt-1 text-sm text-muted-foreground">A-F uses A: 90-100, B: 80-89, C: 70-79, D: 60-69, E: 50-59, F: below 50.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <CategoryGradeCard label="On-page SEO" score={scores.seo} description="Metadata and page content." icon={<Search className="h-4 w-4" />} />
              <CategoryGradeCard label="Technical SEO" score={scores.technical} description="Technical delivery checks." icon={<Wrench className="h-4 w-4" />} />
              <CategoryGradeCard label="Crawlability" score={scores.crawlability} description="Discovery and index signals." icon={<Globe2 className="h-4 w-4" />} />
              <CategoryGradeCard label="Performance" score={scores.performance} description="Observed response and size signals." icon={<BarChart3 className="h-4 w-4" />} />
              <CategoryGradeCard label="Passive Security Review" score={scores.security} description="Non-invasive public observations." icon={<ShieldCheck className="h-4 w-4" />} />
              <CategoryGradeCard label="Mobile usability" score={null} description="Not scored by this audit." icon={<MonitorSmartphone className="h-4 w-4" />} />
            </div>
          </SurfaceCard>
          <SurfaceCard className="p-5 md:p-6">
            <h3 className="text-lg font-semibold">Fix priority</h3>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">Issue counts recorded by the audit engine.</p>
            <SeverityDistribution critical={counts.critical} high={counts.high} medium={counts.medium} low={counts.low} />
          </SurfaceCard>
        </div>

        {reportData?.finalReport?.summary && <SurfaceCard className="p-5 md:p-6"><h3 className="text-lg font-semibold">Audit engine summary</h3><p className="mt-2 max-w-5xl text-sm leading-7 text-muted-foreground">{reportData.finalReport.summary}</p></SurfaceCard>}
      </section>

      {firstPage && reportData?.audit && (
        <SitePreviewSection
          url={firstPage.url || reportData.audit.normalizedUrl}
          hostname={reportData.audit.hostname}
          title={firstPage.title}
          description={firstPage.metaDescription}
          h1={firstPage.h1}
          canonicalUrl={firstPage.canonicalUrl}
          siteName={firstPage.siteName}
          faviconUrl={firstPage.faviconUrl}
          openGraphImage={firstPage.openGraphImage}
          screenshotUrl={firstPage.screenshotUrl}
          themeColor={firstPage.themeColor}
        />
      )}

      <section id="recommendations" className="scroll-mt-32 space-y-5" aria-labelledby="recommendations-title">
        <div>
          <h2 id="recommendations-title" className="text-2xl font-semibold">Top fixes first</h2>
          <p className="mt-1 text-sm text-muted-foreground">Repeated findings are grouped by issue type and ordered by priority and affected pages.</p>
        </div>
        {recommendations.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {recommendations.slice(0, 5).map((group) => {
              const representative = groupRepresentative(group, issues);
              const insight = representative ? buildIssueInsight(representative) : null;
              return <FindingRow key={group.id} severity={group.severity} category={group.category} title={group.title} description={group.description} whyItMatters={insight?.whyItMatters || whyThisMatters(group.section)} recommendation={group.recommendation} evidence={group.evidence} affectedUrls={group.affectedUrls} />;
            })}
          </div>
        ) : (
          <SurfaceCard className="p-5"><EmptyState icon={Wrench} title="No stored recommendations" description={reportData ? 'The audit did not store recommendation rows for this result.' : 'Load the report to view its measured recommendations.'} /></SurfaceCard>
        )}
      </section>

      {REPORT_SECTIONS.map((section) => {
        const sectionFindings = sectionGroups.get(section.id) || [];
        return (
          <section key={section.id} id={`report-${section.id}`} className="scroll-mt-32 space-y-5" aria-labelledby={`report-${section.id}-title`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id={`report-${section.id}-title`} className="text-2xl font-semibold">{section.label}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
              </div>
              {section.id === 'security' && <StatusBadge tone="accent">Passive observations only</StatusBadge>}
              {section.id === 'mobile' && <StatusBadge tone="warning">Not scored</StatusBadge>}
            </div>

            {section.id === 'performance' && (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Average response" value={formatMilliseconds(pageMetrics.averageResponseMs)} detail="Observed during this audit" icon={<BarChart3 className="h-5 w-5" />} />
                <MetricCard label="95th percentile" value={formatMilliseconds(pageMetrics.p95ResponseMs)} detail="Observed server response" icon={<SlidersHorizontal className="h-5 w-5" />} />
                <MetricCard label="Average page size" value={formatBytes(pageMetrics.averagePageBytes)} detail="Downloaded HTML response" icon={<FileJson className="h-5 w-5" />} />
                <MetricCard label="Total downloaded" value={formatBytes(pageMetrics.totalPageBytes)} detail="Across stored page rows" icon={<Download className="h-5 w-5" />} />
              </div>
            )}

            {section.id === 'performance' && <p className="rounded-lg border border-border bg-muted/25 p-3 text-xs leading-5 text-muted-foreground">These are audit-time response and payload observations, not Google Core Web Vitals field data.</p>}
            {section.id === 'mobile' && <p className="rounded-lg border border-border bg-muted/25 p-3 text-xs leading-5 text-muted-foreground">The current worker does not produce a mobile usability score or field-device metrics. Any collected viewport findings are listed below; otherwise this section remains explicitly unmeasured.</p>}
            {section.id === 'security' && <p className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs leading-5 text-muted-foreground">SEOIntel checks public HTTPS and browser protection signals only. It does not scan ports, submit attack payloads, brute-force credentials, or attempt exploitation.</p>}

            {sectionFindings.length ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {sectionFindings.map((group) => {
                  const representative = groupRepresentative(group, issues);
                  const insight = representative ? buildIssueInsight(representative) : null;
                  return <FindingRow key={group.id} severity={group.severity} category={group.category} title={group.title} description={group.description} whyItMatters={insight?.whyItMatters || whyThisMatters(group.section)} recommendation={group.recommendation} evidence={group.evidence} affectedUrls={group.affectedUrls} />;
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-muted/20 p-5 text-sm text-muted-foreground">No findings were stored in this report section. This does not substitute for data the audit did not collect.</div>
            )}
          </section>
        );
      })}

      <section id="report-pages" className="scroll-mt-32 space-y-5" aria-labelledby="report-pages-title">
        <div>
          <h2 id="report-pages-title" className="text-2xl font-semibold">Pages checked</h2>
          <p className="mt-1 text-sm text-muted-foreground">Search, filter, and sort the actual page summaries stored by the audit engine.</p>
        </div>
        <SurfaceCard className="p-0">
          <div className="grid gap-3 border-b border-border p-4 md:grid-cols-[minmax(220px,1fr)_160px_180px] md:p-5">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <span className="sr-only">Search pages</span>
              <input value={pageQuery} onChange={(event) => setPageQuery(event.target.value)} placeholder="Search URL, title, or status" className="suite-input pl-10" />
            </label>
            <label><span className="sr-only">Filter status codes</span><select value={pageStatus} onChange={(event) => setPageStatus(event.target.value as PageStatusFilter)} className="suite-input"><option value="all">All status codes</option><option value="2xx">2xx success</option><option value="3xx">3xx redirects</option><option value="4xx">4xx errors</option><option value="5xx">5xx errors</option></select></label>
            <label><span className="sr-only">Sort pages</span><select value={pageSort} onChange={(event) => setPageSort(event.target.value as PageSort)} className="suite-input"><option value="issues">Most fixes</option><option value="response">Slowest response</option><option value="size">Largest response</option><option value="status">Highest status code</option><option value="url">URL A-Z</option></select></label>
          </div>

          {pages.length ? (
            <>
              <div className="overflow-x-auto">
                <table className="suite-table min-w-[900px]">
                  <thead><tr><th>Page</th><th>Status</th><th>Response</th><th>HTML size</th><th>Depth</th><th>Fixes</th></tr></thead>
                  <tbody>
                    {visiblePages.map((page) => (
                      <tr key={page.id || page.url}>
                        <td className="max-w-[430px]"><div className="truncate font-semibold" title={page.url}>{page.title || page.url}</div>{page.title && <div className="mt-1 truncate text-xs text-muted-foreground" title={page.url}>{page.url}</div>}</td>
                        <td><StatusBadge tone={page.statusCode <= 0 || page.statusCode >= 400 ? 'danger' : page.statusCode >= 300 ? 'warning' : 'success'}>{page.statusCode || 'No response'}</StatusBadge></td>
                        <td className="tabular-nums">{formatMilliseconds(page.responseTimeMs)}</td>
                        <td className="tabular-nums">{formatBytes(page.pageSizeBytes)}</td>
                        <td className="tabular-nums">{page.crawlDepth}</td>
                        <td className="font-semibold tabular-nums">{page.issueCount}</td>
                      </tr>
                    ))}
                    {!visiblePages.length && <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">No pages match these filters.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-3 border-t border-border p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="text-muted-foreground">Showing {visiblePages.length} of {filteredPages.length} matching page(s)</div>
                <div className="flex items-center gap-2">
                  <button type="button" disabled={pageNumber <= 1} onClick={() => setPageNumber((value) => Math.max(1, value - 1))} className="quiet-button px-3 py-2">Previous</button>
                  <span className="px-2 text-sm tabular-nums">{pageNumber} / {totalPages}</span>
                  <button type="button" disabled={pageNumber >= totalPages} onClick={() => setPageNumber((value) => Math.min(totalPages, value + 1))} className="quiet-button px-3 py-2">Next</button>
                </div>
              </div>
            </>
          ) : (
            <div className="p-5 md:p-6"><EmptyState icon={Globe2} title="Page evidence unavailable" description={reportError ? 'The report request failed, so no page rows are being displayed.' : 'This audit did not store page summary rows.'} /></div>
          )}
        </SurfaceCard>
      </section>

      <section id="report-exports" className="scroll-mt-32 space-y-5" aria-labelledby="report-exports-title">
        <div>
          <h2 id="report-exports-title" className="text-2xl font-semibold">Exports and delivery</h2>
          <p className="mt-1 text-sm text-muted-foreground">Download only stored audit or imported data. Exporting never reruns the crawler.</p>
        </div>
        <SurfaceCard className="p-5 md:p-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div>
              <div className="flex items-center gap-3"><FileJson className="h-5 w-5 text-accent" /><h3 className="font-semibold">Audit data</h3></div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Stored report, findings, and page rows for technical workflows.</p>
              <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => handleAuditExport('json')} disabled={Boolean(actionLoading)} className="quiet-button px-3 py-2">JSON</button><button type="button" onClick={() => handleAuditExport('issues.csv')} disabled={Boolean(actionLoading)} className="quiet-button px-3 py-2">Fixes CSV</button><button type="button" onClick={() => handleAuditExport('pages.csv')} disabled={Boolean(actionLoading)} className="quiet-button px-3 py-2">Pages CSV</button></div>
            </div>
            <div>
              <div className="flex items-center gap-3"><FileSpreadsheet className="h-5 w-5 text-emerald-600" /><h3 className="font-semibold">Imported data</h3></div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">User-provided search and keyword rows; no provider values are fabricated.</p>
              <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => handleImportedExport('search')} disabled={Boolean(actionLoading)} className="quiet-button px-3 py-2">Search CSV</button><button type="button" onClick={() => handleImportedExport('keywords')} disabled={Boolean(actionLoading)} className="quiet-button px-3 py-2">Keywords CSV</button></div>
            </div>
            <div>
              <div className="flex items-center gap-3"><Printer className="h-5 w-5 text-indigo-600" /><h3 className="font-semibold">Client report</h3></div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Structured PDF for entitled completed audits, or the browser print layout.</p>
              <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => handleAuditExport('pdf')} disabled={Boolean(actionLoading) || selectedHistory?.status !== 'completed'} className="trust-button px-3 py-2">PDF</button><button type="button" onClick={() => window.print()} className="quiet-button px-3 py-2">Print</button></div>
            </div>
          </div>
        </SurfaceCard>
      </section>

      {reportData && (
        <details className="rounded-xl border border-border bg-card">
          <summary className="cursor-pointer px-5 py-4 font-semibold">Raw audit details</summary>
          <div className="border-t border-border p-5">
            <p className="mb-3 text-xs leading-5 text-muted-foreground">Structured audit records only. SEOIntel does not store complete raw HTML in this report.</p>
            <pre className="max-h-[480px] overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">{JSON.stringify({ audit: reportData.audit, scores: reportData.finalReport?.scores, events: reportData.latestEvents, pages: reportData.latestPages, issues: reportData.latestIssues }, null, 2)}</pre>
          </div>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t border-border py-5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" /> Report links use audit IDs and current access controls.</span>
        <span>Rankings, backlinks, search volume, traffic, and field Core Web Vitals require a real import or provider.</span>
      </div>
    </div>
  );
}
