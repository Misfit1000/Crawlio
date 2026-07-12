import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock, Clipboard, FileDown, Filter, Loader2, RefreshCw, Radio, Share2, ShieldAlert, StopCircle, Wifi, WifiOff } from 'lucide-react';
import type { ResourceAuditLiveData } from '../../lib/audit/resource-types';
import type { LiveAuditConnectionState } from '../../lib/audit/live-supabase-client';
import { getAuditModeLabel } from '../../lib/audit/audit-config';
import { isAuditQueuedTooLong } from '../../lib/audit/queued-worker-warning';
import { API_ROUTES } from '../../lib/api/routes';
import { getAuditAccessHeaders } from '../../lib/api/auth-headers';
import { safeJsonFetch } from '../../lib/http/safe-json';
import { formatAuditElapsed, isTerminalAuditStatus } from '../../lib/audit/audit-time';
import { downloadAuditExport } from '../../lib/http/download';
import { AuditStageTimeline, CategoryScoreBar, MetricBarChart, MetricCard, ProgressBar, RadialScoreGauge, SeverityDistribution, SitePreviewSection, SparklineChart, StatusBadge, SurfaceCard } from '../ui/visual-system';
import { Notice, PageHeader, Panel } from '../ui/page-system';
import {
  buildHistoryEntry,
  buildIssueInsight,
  checklistCompletion,
  compareAuditIssues,
  crawlDepthDistribution,
  findPreviousAudit,
  issueBucket,
  issueSignature,
  pageHealthBuckets,
  readAuditHistory,
  readChecklist,
  scoreTrendForUrl,
  upsertAuditHistory,
  writeChecklist,
  type AuditHistoryEntry,
  type ChecklistStatus,
  type IssueBucket,
} from '../../lib/audit/client-insights';

interface Props {
  auditId: string;
  onComplete?: () => void;
  onRerun?: (url: string) => void | Promise<void>;
  onOpenWorkspace?: () => void;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function severityClass(severity: string) {
  if (severity === 'critical') return 'bg-red-500/10 text-red-500 border-red-500/20';
  if (severity === 'high') return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
  if (severity === 'medium') return 'bg-amber-500/10 text-amber-700 border-amber-500/20';
  return 'bg-muted text-muted-foreground border-border';
}

function priorityLabel(severity: string) {
  if (severity === 'critical') return 'fix now';
  if (severity === 'high') return 'high priority';
  if (severity === 'medium') return 'review soon';
  if (severity === 'low') return 'nice to fix';
  return severity || 'info';
}

function tierLabel(tier?: string) {
  if (tier === 'admin') return 'Admin deep audit';
  if (tier === 'agency') return 'Agency deep audit';
  if (tier === 'paid') return 'Full audit';
  return 'Free quick audit';
}

function statusLabel(status?: string) {
  if (status === 'queued') return 'Waiting to start';
  if (status === 'running') return 'Checking your site';
  if (status === 'completed') return 'Report ready';
  if (status === 'failed') return 'Needs attention';
  if (status === 'cancelled') return 'Stopped';
  return status || 'Loading';
}

function humanizeAuditText(value?: string | null) {
  if (!value) return '';
  return value
    .replace(/audit worker/gi, 'audit engine')
    .replace(/\bworker\b/gi, 'audit engine')
    .replace(/crawler|crawling|crawled/gi, (match) => {
      if (match.toLowerCase() === 'crawled') return 'scanned';
      if (match.toLowerCase() === 'crawling') return 'scanning';
      return 'website scanner';
    })
    .replace(/crawlability/gi, 'Google access')
    .replace(/canonical/gi, 'preferred page URL')
    .replace(/indexability/gi, 'Google indexing')
    .replace(/robots\.txt/gi, 'search engine access rules')
    .replace(/security headers/gi, 'browser protections')
    .replace(/HSTS|CSP|X-Frame-Options|X-Content-Type-Options/gi, 'browser protection setting')
    .replace(/SERP/gi, 'Google preview');
}

function formatLastUpdate(lastUpdateAt: number | undefined, now: number) {
  if (!lastUpdateAt) return 'waiting for first update';
  const seconds = Math.max(0, Math.floor((now - lastUpdateAt) / 1000));
  if (seconds < 2) return 'updated now';
  if (seconds < 60) return `updated ${seconds}s ago`;
  return `updated ${Math.floor(seconds / 60)}m ago`;
}

export function LiveAuditProgress({ auditId, onComplete, onRerun, onOpenWorkspace }: Props) {
  const [data, setData] = useState<ResourceAuditLiveData>({ audit: null, latestEvents: [], latestPages: [], latestIssues: [] });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [connection, setConnection] = useState<LiveAuditConnectionState>({
    transport: 'websocket',
    status: 'connecting',
    message: 'Opening live audit connection.',
  });
  const [now, setNow] = useState(Date.now());
  const [isCancelling, setIsCancelling] = useState(false);
  const [checklist, setChecklist] = useState<Record<string, ChecklistStatus>>({});
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [isDownloadingJson, setIsDownloadingJson] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const audit = data.audit;
  const shouldRunClock = !audit || !isTerminalAuditStatus(audit.status);

  useEffect(() => {
    let isActive = true;
    let unsubscribe = () => {};
    setWarning(null);
    setConnection({
      transport: 'websocket',
      status: 'connecting',
      message: 'Opening live audit connection.',
    });

    import('../../lib/audit/live-supabase-client')
      .then(({ subscribeToAuditLiveData }) => {
        if (!isActive) return;
        unsubscribe = subscribeToAuditLiveData(
          auditId,
          (nextData) => {
            setData(nextData);
            if (nextData.audit?.status === 'completed' || nextData.audit?.status === 'failed' || nextData.audit?.status === 'cancelled') {
              onComplete?.();
            }
          },
          (err) => setWarning(err.message),
          (nextConnection) => {
            setConnection(nextConnection);
            if (nextConnection.status !== 'error') {
              setWarning(null);
            }
          },
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load live audit client'));

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [auditId, onComplete]);

  useEffect(() => {
    if (!shouldRunClock) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [shouldRunClock]);

  useEffect(() => {
    setChecklist(readChecklist(auditId));
  }, [auditId]);

  useEffect(() => {
    if (data.audit) {
      upsertAuditHistory(data);
    }
  }, [data]);

  const latestEvent = data.latestEvents[data.latestEvents.length - 1];
  const currentWork = useMemo(() => {
    if (!audit) {
      return {
        phase: 'Connecting live updates',
        action: 'Loading audit snapshot',
        target: auditId,
        message: connection.message,
      };
    }

    if (audit.status === 'completed') {
      return {
        phase: 'Report ready',
        action: 'Final report is ready',
        target: audit.finalUrl || audit.normalizedUrl,
        message: humanizeAuditText(latestEvent?.message) || 'Audit completed.',
      };
    }

    if (audit.status === 'failed') {
      return {
        phase: 'Needs attention',
        action: audit.error || 'Audit failed',
        target: audit.currentUrl || audit.normalizedUrl,
        message: humanizeAuditText(latestEvent?.message || audit.error) || 'The audit engine stopped before completing this audit.',
      };
    }

    if (audit.status === 'cancelled') {
      return {
        phase: 'Stopped',
        action: 'Audit stopped',
        target: audit.currentUrl || audit.normalizedUrl,
        message: latestEvent?.message || 'The audit was cancelled.',
      };
    }

    return {
      phase: humanizeAuditText(audit.currentPhase || latestEvent?.phase) || 'Waiting to start',
      action: humanizeAuditText(audit.currentCheck || latestEvent?.checkTitle || latestEvent?.message) || 'Waiting for audit engine',
      target: audit.currentUrl || latestEvent?.currentUrl || latestEvent?.affectedUrl || audit.normalizedUrl,
      message: humanizeAuditText(latestEvent?.message) || (audit.status === 'queued' ? 'Waiting for the audit engine to start.' : 'The audit engine is updating live progress.'),
    };
  }, [audit, auditId, connection.message, latestEvent]);

  const queuedTooLong = useMemo(() => {
    return isAuditQueuedTooLong(audit, now);
  }, [audit, now]);

  const cancelAudit = async () => {
    setIsCancelling(true);
    try {
      const response = await safeJsonFetch(API_ROUTES.auditCancel(auditId), { method: 'POST', headers: await getAuditAccessHeaders() });
      if ('error' in response) throw new Error(response.error || 'Failed to cancel audit');
      const payload = response.data as { success?: boolean; error?: string };
      if (payload.success === false) throw new Error(payload.error || 'Failed to cancel audit');
      const cancelledAt = new Date().toISOString();
      setData((current) => current.audit ? {
        ...current,
        audit: {
          ...current.audit,
          status: 'cancelled',
          currentPhase: 'Cancelled',
          currentCheck: 'Audit stopped',
          cancelledAt,
          updatedAt: cancelledAt,
        },
      } : current);
    } catch (err: any) {
      setError(err.message || 'Failed to cancel audit');
    } finally {
      setIsCancelling(false);
    }
  };

  const setChecklistStatus = (signature: string, status: ChecklistStatus) => {
    const next = { ...checklist, [signature]: status };
    setChecklist(next);
    writeChecklist(auditId, next);
  };

  const copyReportLink = async () => {
    try {
      const url = `${window.location.origin}/audit/live/${auditId}`;
      await navigator.clipboard.writeText(url);
      setShareMessage('Report link copied.');
    } catch {
      setShareMessage('Copy failed. Use the browser address bar link.');
    } finally {
      window.setTimeout(() => setShareMessage(null), 2500);
    }
  };

  const rerunAudit = () => {
    const url = audit?.normalizedUrl || data.audit?.normalizedUrl;
    if (url && onRerun) onRerun(url);
  };

  const downloadPdf = async () => {
    setIsDownloadingPdf(true);
    setExportMessage(null);
    try {
      await downloadAuditExport(auditId, 'pdf');
      setExportMessage('PDF report downloaded.');
    } catch (downloadError) {
      setExportMessage(downloadError instanceof Error ? downloadError.message : 'PDF download failed.');
    } finally {
      setIsDownloadingPdf(false);
      window.setTimeout(() => setExportMessage(null), 4000);
    }
  };

  const downloadJson = async () => {
    setIsDownloadingJson(true);
    setExportMessage(null);
    try {
      await downloadAuditExport(auditId, 'json');
      setExportMessage('JSON report downloaded.');
    } catch (downloadError) {
      setExportMessage(downloadError instanceof Error ? downloadError.message : 'JSON download failed.');
    } finally {
      setIsDownloadingJson(false);
      window.setTimeout(() => setExportMessage(null), 4000);
    }
  };

  if (error) {
    return <Notice tone="danger" title="Live audit could not be loaded">{error}</Notice>;
  }

  if (!audit) {
    return (
      <Panel className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
            <div>
              <div className="font-medium text-foreground">Connecting to live audit updates...</div>
              <div className="text-sm break-all">Audit ID: {auditId}</div>
            </div>
          </div>
          <ConnectionBadge connection={connection} now={now} />
        </div>
        <CurrentWorkCard currentWork={currentWork} connection={connection} now={now} />
        {warning && (
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-700 text-sm">
            {warning}
          </div>
        )}
      </Panel>
    );
  }

  const progress = Math.max(0, Math.min(100, audit.progress || 0));
  const firstPage = data.latestPages.find((page) => page.title || page.metaDescription) || data.latestPages[0];
  const estimatedScore = Math.max(0, Math.min(100, 100 - audit.criticalCount * 12 - audit.highCount * 7 - audit.mediumCount * 3 - audit.lowCount));
  const reportScores = (data.finalReport?.scores || {}) as Record<string, unknown>;
  const scoreValue = (key: string) => {
    const rawValue = reportScores[key];
    if (rawValue == null || rawValue === '') return null;
    const value = Number(rawValue);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  };
  const finalOverallScore = scoreValue('overall');
  const overallScore = finalOverallScore ?? estimatedScore;
  const hasScoreEvidence = Boolean(data.finalReport) || audit.pagesCrawled > 0 || audit.issuesFound > 0;
  const categoryScoreCandidates: Array<{ label: string; value: number | null; tone: 'accent' | 'green' | 'yellow' | 'red' }> = [
    { label: 'On-page SEO', value: scoreValue('seo'), tone: 'green' },
    { label: 'Technical SEO', value: scoreValue('technical'), tone: 'accent' },
    { label: 'Performance observations', value: scoreValue('performance'), tone: 'yellow' },
    { label: 'Passive Security Review', value: scoreValue('security'), tone: 'green' },
    { label: 'Crawlability', value: scoreValue('crawlability'), tone: 'accent' },
  ];
  const categoryScores = data.finalReport
    ? categoryScoreCandidates.filter((item): item is typeof item & { value: number } => item.value != null)
    : [];
  const progressSeries = [
    0,
    ...data.latestEvents
      .map((event) => Number(event.progress))
      .filter((value) => Number.isFinite(value)),
    progress,
  ];
  const statusTone = audit.status === 'completed'
    ? 'success'
    : audit.status === 'failed' || audit.status === 'cancelled'
      ? 'danger'
      : audit.status === 'queued'
        ? 'warning'
        : 'accent';
  const historyEntry = buildHistoryEntry(data);
  const history = readAuditHistory();
  const previousAudit = findPreviousAudit(historyEntry, history);
  const comparison = compareAuditIssues(data.latestIssues, previousAudit, data.finalReport ? historyEntry?.score : null);
  const checklistSummary = checklistCompletion(data.latestIssues, checklist);
  const scoreTrend = scoreTrendForUrl(audit.normalizedUrl, history);
  const crawlDepth = crawlDepthDistribution(data.latestPages);
  const pageBuckets = pageHealthBuckets(data.latestPages);
  const elapsedTime = formatAuditElapsed(audit, now);

  return (
    <div className="w-full space-y-8 animate-rise" aria-live="polite">
      <PageHeader
        eyebrow="Live audit"
        icon={Radio}
        title="Audit workspace"
        description={audit.normalizedUrl}
        metadata={
          <>
            <StatusBadge tone={statusTone as any}>{statusLabel(audit.status)}</StatusBadge>
            <StatusBadge tone="accent">{tierLabel(audit.processingTier)}</StatusBadge>
            <ConnectionBadge connection={connection} now={now} />
          </>
        }
        actions={hasScoreEvidence ? (
          <RadialScoreGauge value={overallScore} label={data.finalReport ? 'Site health' : 'Estimated health'} detail={data.finalReport ? 'Final report score' : 'Updates from measured findings'} size="sm" />
        ) : (
          <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full border border-dashed border-border bg-card text-center"><div className="text-xl font-semibold">--</div><div className="mt-1 px-3 text-xs text-muted-foreground">Score pending</div></div>
        )}
      />
      <SurfaceCard className="overflow-hidden">
        <div className="grid-overlay relative p-5 md:p-8">
          <div className="absolute inset-0 -z-0 bg-gradient-to-br from-accent/10 via-transparent to-green-500/10" />
          <div className="relative z-10">
            <div className="space-y-6">
              <ProgressBar label={humanizeAuditText(audit.currentPhase) || statusLabel(audit.status)} value={progress} tone={audit.status === 'failed' ? 'red' : 'accent'} />
              <CurrentWorkCard currentWork={currentWork} connection={connection} now={now} />

              <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr_0.8fr]">
                <AuditStageTimeline progress={progress} status={audit.status} />
                <SparklineChart values={progressSeries} label="Progress over time" valueLabel={`${Math.round(progress)}%`} />
                <MetricBarChart items={[
                  { label: 'Fix now', value: audit.criticalCount, color: 'bg-red-500' },
                  { label: 'High', value: audit.highCount, color: 'bg-orange-500' },
                  { label: 'Review', value: audit.mediumCount, color: 'bg-amber-500' },
                  { label: 'Low', value: audit.lowCount, color: 'bg-sky-500' },
                ]} />
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Pages scanned" value={`${audit.pagesCrawled}/${audit.pageLimit}`} icon={<Clock className="h-5 w-5" />} />
                <MetricCard label="Fixes found" value={audit.issuesFound} icon={<AlertTriangle className="h-5 w-5" />} tone={audit.criticalCount ? 'red' : 'yellow'} />
                <MetricCard label="Urgent / high" value={`${audit.criticalCount}/${audit.highCount}`} icon={<ShieldAlert className="h-5 w-5" />} tone={audit.criticalCount ? 'red' : 'yellow'} />
                <MetricCard label="Time elapsed" value={elapsedTime} icon={<Activity className="h-5 w-5" />} tone="blue" />
              </div>
            </div>
          </div>
        </div>
      </SurfaceCard>

      <SitePreviewSection
        url={audit.currentUrl || audit.finalUrl || firstPage?.url || audit.normalizedUrl}
        hostname={audit.hostname}
        title={firstPage?.title}
        description={firstPage?.metaDescription}
        h1={firstPage?.h1}
        canonicalUrl={firstPage?.canonicalUrl}
        siteName={firstPage?.siteName}
        faviconUrl={firstPage?.faviconUrl}
        openGraphImage={firstPage?.openGraphImage}
        screenshotUrl={firstPage?.screenshotUrl}
        themeColor={firstPage?.themeColor}
      />

      <AuditWorkflowPanel
        auditId={auditId}
        auditUrl={audit.normalizedUrl}
        issues={data.latestIssues}
        pages={data.latestPages}
        checklist={checklist}
        checklistSummary={checklistSummary}
        comparison={comparison}
        previousAudit={previousAudit}
        scoreTrend={scoreTrend}
        crawlDepth={crawlDepth}
        pageBuckets={pageBuckets}
        shareMessage={shareMessage}
        onChecklistStatus={setChecklistStatus}
        onCopyReportLink={copyReportLink}
        onRerun={onRerun ? rerunAudit : undefined}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <SurfaceCard className="p-5 md:p-6">
          <div className="mb-5">
            <h3 className="text-xl font-bold">Health categories</h3>
            <p className="text-sm text-muted-foreground">Final section scores are shown only after the audit engine calculates them.</p>
          </div>
          {categoryScores.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {categoryScores.map((item) => (
                <CategoryScoreBar key={item.label} label={item.label} value={item.value} tone={item.tone} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/25 p-5 text-sm leading-6 text-muted-foreground">
              Section grades are not estimated while the audit is running. Live progress, pages checked, and measured findings remain available above.
            </div>
          )}
        </SurfaceCard>
        <SurfaceCard className="p-5 md:p-6">
          <div className="mb-5">
            <h3 className="text-xl font-bold">Fix priority</h3>
            <p className="text-sm text-muted-foreground">Urgent and high-priority findings stay visible before the report completes.</p>
          </div>
          <SeverityDistribution critical={audit.criticalCount} high={audit.highCount} medium={audit.mediumCount} low={audit.lowCount} />
        </SurfaceCard>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Site being checked</h2>
            <p className="text-muted-foreground break-all">{audit.normalizedUrl}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ConnectionBadge connection={connection} now={now} />
            {audit.status === 'completed' && onOpenWorkspace && (
              <button type="button" onClick={onOpenWorkspace} className="trust-button px-3 py-2 text-sm">
                <BarChart3 className="h-4 w-4" /> Open report workspace
              </button>
            )}
            {data.finalReport && (
              <button type="button" onClick={downloadJson} disabled={isDownloadingJson} className="quiet-button px-3 py-2 text-sm">
                {isDownloadingJson ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} JSON
              </button>
            )}
            {audit.status === 'completed' && audit.processingTier !== 'free' && (
              <button type="button" onClick={downloadPdf} disabled={isDownloadingPdf} className="trust-button px-3 py-2 text-sm">
                {isDownloadingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                {isDownloadingPdf ? 'Building PDF...' : 'Download PDF'}
              </button>
            )}
            {audit.status === 'completed' && audit.processingTier === 'free' && (
              <button type="button" disabled className="quiet-button px-3 py-2 text-sm" title="PDF reports are available with Full audits.">
                <FileDown className="h-4 w-4" /> PDF in Full
              </button>
            )}
            {audit.status === 'queued' || audit.status === 'running' ? (
              <button
                type="button"
                onClick={cancelAudit}
                disabled={isCancelling}
                className="px-3 py-2 rounded-lg border border-red-500/30 text-red-500 text-sm flex items-center gap-2 hover:bg-red-500/10 disabled:opacity-50"
              >
                {isCancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <StopCircle className="w-4 h-4" />}
                Stop Audit
              </button>
            ) : null}
          </div>
        </div>

        {exportMessage && (
          <div className={`mt-4 rounded-lg border p-3 text-sm font-medium ${exportMessage.includes('downloaded') ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700' : 'border-red-500/20 bg-red-500/10 text-red-700'}`}>
            {exportMessage}
          </div>
        )}

        <div className="mt-5 h-3 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-accent transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
          <span>{humanizeAuditText(audit.currentPhase) || statusLabel(audit.status)}</span>
          <span className="font-mono text-foreground">{Math.round(progress)}%</span>
        </div>

        <CurrentWorkCard currentWork={currentWork} connection={connection} now={now} />

        {warning && (
          <div className="mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-700 text-sm">
            {warning}
          </div>
        )}

        {queuedTooLong && (
          <div className="mt-4 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-800 text-sm space-y-3">
            <div className="font-semibold">The audit is waiting because no online audit engine has picked it up yet.</div>
            <ul className="list-disc pl-5 space-y-1">
              <li>Confirm the audit engine service is deployed and running.</li>
              <li>If using Render Free Web Service, it may be asleep until the health URL is pinged.</li>
              <li>Confirm the audit engine has <span className="font-mono">SUPABASE_URL</span>.</li>
              <li>Confirm the audit engine has <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span>.</li>
              <li>Confirm the audit engine and Vercel use the same Supabase project.</li>
              <li>Run <span className="font-mono">npm run check:worker</span> to verify heartbeat.</li>
              <li>Add an uptime monitor pinging <span className="font-mono">https://seointel-audit-worker.onrender.com/health</span> every 10 minutes.</li>
            </ul>
            <div className="grid gap-2 md:grid-cols-2">
              <Info label="Audit ID" value={audit.id} />
              <Info label="Submitted URL" value={audit.submittedInput} />
              <Info label="Cleaned URL" value={audit.normalizedUrl} />
              <Info label="Created" value={new Date(audit.createdAt).toLocaleString()} />
              <Info label="Current status" value={statusLabel(audit.status)} />
              <Info label="Current stage" value={humanizeAuditText(audit.currentPhase) || statusLabel(audit.status)} />
            </div>
          </div>
        )}

        <div className="mt-6 grid md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
          <Info label="Submitted input" value={audit.submittedInput} />
          <Info label="Cleaned URL" value={audit.normalizedUrl} />
          <Info label="Final URL" value={audit.finalUrl || 'Waiting for first fetch'} />
          <Info label="Hostname" value={audit.hostname} />
          <Info label="Audit mode" value={getAuditModeLabel(audit.mode)} />
          <Info label="Audit type" value={tierLabel(audit.processingTier)} />
          <Info label="Plan" value={audit.plan || 'free'} />
          <Info label="Status" value={statusLabel(audit.status)} />
          <Info label="Page being checked" value={audit.currentUrl || 'Waiting for audit engine'} />
          <Info label="Check running" value={humanizeAuditText(audit.currentCheck) || statusLabel(audit.status)} />
          <Info label="Pages" value={`${audit.pagesCrawled} / ${audit.pageLimit}`} />
          <Info label="Fixes found" value={String(audit.issuesFound)} />
          <Info label="Elapsed" value={elapsedTime} />
          <Info label="Passive Security Review" value="Non-invasive checks only" />
        </div>
      </div>

      {audit.status === 'completed' && audit.processingTier === 'free' && (
        <div className="bg-accent/10 border border-accent/20 rounded-xl p-4 text-sm">
          <div className="font-semibold text-foreground">Unlock a full 25-page audit, deeper checks, faster starts, and PDF reports.</div>
          <div className="text-muted-foreground mt-1">Free reports show quick SEO and passive security observations. Paid reports unlock the full audit categories.</div>
        </div>
      )}

      <div className="grid md:grid-cols-4 gap-4">
        <Metric icon={<Clock />} label="Pages scanned" value={`${audit.pagesCrawled}/${audit.pageLimit}`} />
        <Metric icon={<ShieldAlert />} label="Urgent/high" value={`${audit.criticalCount}/${audit.highCount}`} />
        <Metric icon={<AlertTriangle />} label="Fixes found" value={String(audit.issuesFound)} />
        <Metric icon={audit.status === 'completed' ? <CheckCircle2 /> : <Loader2 className="animate-spin" />} label="Status" value={statusLabel(audit.status)} />
      </div>

      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold">Pages checked</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">URL</th>
                <th className="text-left p-3">Response</th>
                <th className="text-left p-3">Size</th>
                <th className="text-left p-3">Title</th>
                <th className="text-left p-3">Words</th>
                <th className="text-left p-3">Page level</th>
                <th className="text-left p-3">Fixes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.latestPages.length === 0 ? (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No pages scanned yet.</td></tr>
              ) : data.latestPages.map((page) => (
                <tr key={page.id}>
                  <td className="p-3 font-mono">{page.statusCode}</td>
                  <td className="p-3 break-all max-w-md">{page.url}</td>
                  <td className="p-3">{page.responseTimeMs}ms</td>
                  <td className="p-3">{formatBytes(page.pageSizeBytes)}</td>
                  <td className="p-3 max-w-xs truncate">{page.title || 'Missing'}</td>
                  <td className="p-3">{page.wordCount}</td>
                  <td className="p-3">{page.crawlDepth}</td>
                  <td className="p-3">{page.issueCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6">
        <section className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold">Activity timeline</h3>
          </div>
          <div className="divide-y divide-border max-h-[520px] overflow-y-auto">
            {data.latestEvents.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">Waiting for audit engine...</div>
            ) : data.latestEvents.map((event) => (
              <div key={event.id} className="p-3 flex gap-3 text-sm">
                <span className="text-muted-foreground font-mono shrink-0">{new Date(event.timestamp).toLocaleTimeString()}</span>
                <div>
                  <div className="font-medium">{humanizeAuditText(event.type.replace(/_/g, ' '))}</div>
                  <div className="text-muted-foreground break-all">{humanizeAuditText(event.message) || event.affectedUrl || event.currentUrl}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function ConnectionBadge({ connection, now }: { connection: LiveAuditConnectionState; now: number }) {
  const isWebSocket = connection.transport === 'websocket';
  const isHealthy = connection.status === 'connected' || connection.status === 'polling';
  const isConnecting = connection.status === 'connecting' || connection.status === 'reconnecting';
  const Icon = isWebSocket ? Wifi : isHealthy ? Radio : WifiOff;
  const label = isWebSocket
    ? connection.status === 'connected'
      ? 'Live updates on'
      : connection.status === 'connecting'
        ? 'Connecting updates'
        : connection.status === 'reconnecting'
          ? 'Reconnecting updates'
          : 'Live update issue'
    : 'Auto refresh mode';

  const colorClass = isHealthy
    ? 'border-green-500/20 bg-green-500/10 text-green-700'
    : isConnecting
      ? 'border-blue-500/20 bg-blue-500/10 text-blue-700'
      : 'border-yellow-500/20 bg-yellow-500/10 text-yellow-700';

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${colorClass}`} title={humanizeAuditText(connection.message)}>
      <div className="flex items-center gap-2 font-medium whitespace-nowrap">
        <Icon className="w-4 h-4" />
        {label}
      </div>
      <div className="mt-0.5 text-[11px] opacity-80">{formatLastUpdate(connection.lastUpdateAt, now)}</div>
    </div>
  );
}

function CurrentWorkCard({
  currentWork,
  connection,
  now,
}: {
  currentWork: { phase: string; action: string; target: string; message: string };
  connection: LiveAuditConnectionState;
  now: number;
}) {
  return (
    <div className="mt-5 rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <Activity className="w-4 h-4 text-accent" />
          Checking now
        </div>
        <div className="text-xs text-muted-foreground">{formatLastUpdate(connection.lastUpdateAt, now)}</div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3 text-sm">
        <Info label="Stage" value={currentWork.phase} />
        <Info label="Now checking" value={currentWork.action} />
        <Info label="Page or URL" value={currentWork.target || 'Waiting for audit engine'} />
      </div>
      <div className="mt-3 rounded-lg border border-border bg-background/70 p-3 text-sm text-muted-foreground break-all">
        {currentWork.message}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 min-w-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium break-all">{value}</div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
      <div className="text-accent [&>svg]:w-5 [&>svg]:h-5">{icon}</div>
      <div>
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="font-semibold capitalize">{value}</div>
      </div>
    </div>
  );
}

function AuditWorkflowPanel({
  auditId,
  auditUrl,
  issues,
  pages,
  checklist,
  checklistSummary,
  comparison,
  previousAudit,
  scoreTrend,
  crawlDepth,
  pageBuckets,
  shareMessage,
  onChecklistStatus,
  onCopyReportLink,
  onRerun,
}: {
  auditId: string;
  auditUrl: string;
  issues: ResourceAuditLiveData['latestIssues'];
  pages: ResourceAuditLiveData['latestPages'];
  checklist: Record<string, ChecklistStatus>;
  checklistSummary: { actionable: number; fixed: number; ignored: number; percent: number };
  comparison: ReturnType<typeof compareAuditIssues>;
  previousAudit: AuditHistoryEntry | null;
  scoreTrend: AuditHistoryEntry[];
  crawlDepth: Array<{ label: string; value: number }>;
  pageBuckets: Array<{ label: string; value: number }>;
  shareMessage: string | null;
  onChecklistStatus: (signature: string, status: ChecklistStatus) => void;
  onCopyReportLink: () => void;
  onRerun?: () => void;
}) {
  const [bucketFilter, setBucketFilter] = useState<IssueBucket>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const filteredIssues = issues
    .filter((issue) => bucketFilter === 'all' || issueBucket(issue) === bucketFilter)
    .filter((issue) => priorityFilter === 'all' || issue.severity === priorityFilter)
    .sort((a, b) => priorityOrder[a.severity] - priorityOrder[b.severity])
    .slice(0, 12);
  const latestScore = scoreTrend[scoreTrend.length - 1]?.score ?? null;
  const maxDepthCount = Math.max(1, ...crawlDepth.map((item) => item.value), ...pageBuckets.map((item) => item.value));

  return (
    <SurfaceCard className="p-5 md:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="suite-chip mb-3 text-accent">Top fixes first</div>
          <h2 className="text-2xl font-bold md:text-3xl">Fix workflow for this audit</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Review the most important findings, mark fix progress, compare against the last completed audit for this URL, and share a client-ready report link.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onCopyReportLink} className="quiet-button">
            <Share2 className="h-4 w-4" /> Share report
          </button>
          {onRerun && (
            <button type="button" onClick={onRerun} className="trust-button">
              <RefreshCw className="h-4 w-4" /> Rerun audit
            </button>
          )}
        </div>
      </div>

      {shareMessage && (
        <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          <Clipboard className="mr-2 inline h-4 w-4" />
          {shareMessage}
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Checklist progress" value={`${checklistSummary.percent}%`} detail={`${checklistSummary.fixed} fixed, ${checklistSummary.ignored} ignored`} icon={<CheckCircle2 className="h-6 w-6" />} tone="green" />
        <MetricCard label="New issues" value={comparison.newIssues.length} detail={previousAudit ? 'Compared with previous audit' : 'No previous audit yet'} icon={<AlertTriangle className="h-6 w-6" />} tone={comparison.newIssues.length ? 'yellow' : 'green'} />
        <MetricCard label="Fixed since last audit" value={comparison.fixedCount} detail={previousAudit ? `Previous score ${previousAudit.score}` : 'Comparison starts after rerun'} icon={<Activity className="h-6 w-6" />} tone="accent" />
        <MetricCard label="Score change" value={comparison.scoreDelta === null ? '-' : `${comparison.scoreDelta > 0 ? '+' : ''}${comparison.scoreDelta}`} detail={latestScore === null ? auditId : `Current score ${latestScore}`} icon={<Radio className="h-6 w-6" />} tone={comparison.scoreDelta && comparison.scoreDelta < 0 ? 'red' : 'green'} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 font-bold">
              <Filter className="h-4 w-4 text-accent" />
              Filter fixes
            </div>
            <div className="flex flex-wrap gap-2">
              {(['all', 'seo', 'technical', 'security'] as IssueBucket[]).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setBucketFilter(filter)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold capitalize ${bucketFilter === filter ? 'border-accent bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}
                >
                  {filter === 'seo' ? 'SEO' : filter}
                </button>
              ))}
              {(['all', 'critical', 'high', 'medium', 'low'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setPriorityFilter(filter)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold capitalize ${priorityFilter === filter ? 'border-accent bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}
                >
                  {filter === 'all' ? 'All priorities' : priorityLabel(filter)}
                </button>
              ))}
            </div>
          </div>

          {filteredIssues.length === 0 ? (
            <div className="rounded-2xl border border-border bg-muted/30 p-6 text-center text-muted-foreground">
              No fixes match the selected filters.
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredIssues.map((issue) => {
                const signature = issueSignature(issue);
                const status = checklist[signature] || 'not_started';
                const insight = buildIssueInsight(issue);
                return (
                  <article key={issue.id} className="rounded-2xl border border-border bg-background/70 p-4 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="mb-2 flex flex-wrap gap-2">
                          <span className={`text-xs px-2 py-1 rounded-md border capitalize ${severityClass(issue.severity)}`}>{priorityLabel(issue.severity)}</span>
                          <StatusBadge tone="accent">{issueBucket(issue) === 'seo' ? 'SEO' : issueBucket(issue)}</StatusBadge>
                          <StatusBadge tone={status === 'fixed' ? 'success' : status === 'ignored' ? 'warning' : status === 'in_progress' ? 'accent' : 'neutral'}>
                            {status.replace(/_/g, ' ')}
                          </StatusBadge>
                        </div>
                        <h3 className="text-lg font-bold">{issue.title}</h3>
                        <p className="mt-1 break-all text-xs text-muted-foreground">{issue.affectedUrl}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(['not_started', 'in_progress', 'fixed', 'ignored'] as ChecklistStatus[]).map((nextStatus) => (
                          <button
                            key={nextStatus}
                            type="button"
                            onClick={() => onChecklistStatus(signature, nextStatus)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${status === nextStatus ? 'border-accent bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}
                          >
                            {nextStatus.replace(/_/g, ' ')}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <PlainEnglishBlock title="What happened" text={humanizeAuditText(insight.whatHappened)} />
                      <PlainEnglishBlock title="Why it matters" text={insight.whyItMatters} />
                      <PlainEnglishBlock title="How to fix it" text={humanizeAuditText(insight.howToFix)} />
                      <PlainEnglishBlock title="Technical details" text={humanizeAuditText(insight.technicalDetails)} />
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <InsightChart title="Score trend" emptyText="Rerun this audit to build a trend." items={scoreTrend.map((entry) => ({ label: new Date(entry.updatedAt).toLocaleDateString(), value: entry.score }))} maxValue={100} />
          <InsightChart title="Crawl depth" emptyText="Pages appear as the audit engine scans." items={crawlDepth} maxValue={maxDepthCount} />
          <InsightChart title="Page health map" emptyText="Page health appears after scans finish." items={pageBuckets} maxValue={maxDepthCount} />
          <div className="rounded-2xl border border-border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
            <div className="font-bold text-foreground">Project grouping</div>
            <p className="mt-1">
              This audit is grouped by URL now. The stored audit model already supports project IDs, so the next backend pass can attach these reports to saved projects without changing the worker flow.
            </p>
            <p className="mt-2 break-all text-xs">Current URL: {auditUrl}</p>
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}

function PlainEnglishBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-3">
      <div className="text-xs font-semibold text-muted-foreground">{title}</div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{text || 'No detail available yet.'}</p>
    </div>
  );
}

function InsightChart({
  title,
  items,
  emptyText,
  maxValue,
}: {
  title: string;
  items: Array<{ label: string; value: number }>;
  emptyText: string;
  maxValue: number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-background/70 p-4">
      <h3 className="font-bold">{title}</h3>
      <div className="mt-4 grid gap-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : items.map((item) => (
          <div key={`${title}-${item.label}`} className="grid grid-cols-[92px_1fr_44px] items-center gap-3 text-sm">
            <div className="truncate text-xs font-semibold text-muted-foreground">{item.label}</div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-500" style={{ width: `${Math.max(4, Math.min(100, (item.value / Math.max(1, maxValue)) * 100))}%` }} />
            </div>
            <div className="text-right text-xs font-semibold">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
