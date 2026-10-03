import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BarChart3, Clock3, FileDown, History, LayoutDashboard, Loader2, RefreshCw, Share2, StopCircle, Wifi, WifiOff } from 'lucide-react';
import { Link } from '../../app/router';
import { auditWorkspacePath } from '../../app/routes';
import type { AuditMode, ResourceAuditLiveData, ResourceAuditPage } from '../../lib/audit/resource-types';
import type { LiveAuditConnectionState } from '../../lib/audit/live-supabase-client';
import { getAuditModeLabel } from '../../lib/audit/audit-config';
import { isAuditQueuedTooLong } from '../../lib/audit/queued-worker-warning';
import { API_ROUTES } from '../../lib/api/routes';
import { getAuditAccessHeaders } from '../../lib/api/auth-headers';
import { safeJsonFetch } from '../../lib/http/safe-json';
import { inflightRead } from '../../lib/http/inflight-read';
import { formatAuditElapsed, isCompletedAuditStatus, isTerminalAuditStatus } from '../../lib/audit/audit-time';
import { createEmptyAuditLiveData, isFinalReportPending, mergeAuditLiveData, waitForPersistedFinalReport } from '../../lib/audit/audit-lifecycle';
import { customerSafeDiagnosticText } from '../../lib/audit/audit-failures';
import { deriveAuditLivePresentation } from '../../lib/audit/audit-live-presentation';
import { getAuditLiveScore } from '../../lib/audit/audit-live-score';
import { describeCrawlCompletion } from '../../lib/audit/audit-coverage';
import { downloadAuditExport } from '../../lib/http/download';
import { SparklineChart, StatusBadge, SurfaceCard } from '../ui/visual-system';
import { Notice } from '../ui/page-system';
import { readAuditHistory, scoreTrendForUrl, upsertAuditHistory, type ChecklistStatus } from '../../lib/audit/client-insights';
import { AuditExecutiveSummary, type AuditCategoryScore } from './AuditExecutiveSummary';
import { AuditOverview } from './AuditOverview';
import { AuditActivityFeed } from './AuditActivityPanel';
import { AuditWorkspaceModes, useAuditWorkspaceMode } from './AuditWorkspaceModes';
import { AuditPagesTable, PageEvidenceDrawer } from './PageEvidenceDrawer';
import FindingWorkspace from './FindingWorkspace';
import PaginatedAuditEvidence from './PaginatedAuditEvidence';
import { AuditReportReadyNote, AuditTerminalState } from './AuditTerminalState';
import { useFindingWorkflow } from './useFindingWorkflow';
import { useAuditEntitlements } from '../../hooks/useAuditEntitlements';

interface Props {
  auditId: string;
  initialSnapshot?: ResourceAuditLiveData;
  onRerun?: (url: string, mode: AuditMode) => void | Promise<void>;
  onOpenWorkspace?: () => void;
}

async function loadStoredAuditSnapshot(auditId: string, signal?: AbortSignal) {
  const url = API_ROUTES.auditResult(auditId);
  const headers = await getAuditAccessHeaders();
  const response = await inflightRead(url, headers, requestSignal => safeJsonFetch<any>(url, { headers, signal: requestSignal }), signal);
  if (!response.success) throw new Error((response as any).error || 'Audit result is unavailable.');
  return (response.data.data || response.data) as ResourceAuditLiveData;
}

function tierLabel(tier?: string, mode?: string) {
  const prefix = tier === 'admin' ? 'Admin' : tier === 'agency' ? 'Pro' : tier === 'paid' ? 'Plus' : 'Free';
  const auditType = mode === 'deep' ? 'Deep audit' : mode === 'standard' ? 'Standard audit' : 'Quick audit';
  return `${prefix} ${auditType}`;
}

function statusLabel(status?: string) {
  if (status === 'queued') return 'Waiting to start';
  if (status === 'running') return 'Checking your site';
  if (status === 'completed') return 'Report ready';
  if (status === 'completed_with_warnings') return 'Report ready with warnings';
  if (status === 'failed') return 'Needs attention';
  if (status === 'cancelled') return 'Stopped';
  if (status === 'abandoned') return 'Stopped after recovery attempts';
  return status || 'Loading';
}

function humanizeAuditText(value?: string | null) {
  const safeValue = customerSafeDiagnosticText(value);
  if (!safeValue) return '';
  return safeValue
    .replace(/audit worker/gi, 'audit engine')
    .replace(/\bworker\b/gi, 'audit engine')
    .replace(/crawler|crawling|crawled/gi, (match) => {
      if (match.toLowerCase() === 'crawled') return 'scanned';
      if (match.toLowerCase() === 'crawling') return 'scanning';
      return 'website scanner';
    })
    .replace(/crawlability/gi, 'Crawler access')
    .replace(/canonical/gi, 'preferred page URL')
    .replace(/indexability/gi, 'Indexing directives')
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

export function LiveAuditProgress({ auditId, initialSnapshot, onRerun, onOpenWorkspace }: Props) {
  const { exportsEnabled, pdfEnabled } = useAuditEntitlements();
  const [data, setData] = useState<ResourceAuditLiveData>(() => initialSnapshot || createEmptyAuditLiveData());
  const admission = useRef(initialSnapshot);
  admission.current = initialSnapshot;
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [connection, setConnection] = useState<LiveAuditConnectionState>({
    transport: 'websocket',
    status: 'connecting',
    message: 'Opening live audit connection.',
  });
  const [now, setNow] = useState(Date.now());
  const [isCancelling, setIsCancelling] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [isDownloadingJson, setIsDownloadingJson] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [loadRetryKey, setLoadRetryKey] = useState(0);
  const [reportRetryKey, setReportRetryKey] = useState(0);
  const [reportRetryExhausted, setReportRetryExhausted] = useState(false);
  const dataRef = useRef(data);
  const unsubscribeRef = useRef<() => void>(() => {});
  const audit = data.audit;
  const findingWorkflow = useFindingWorkflow(auditId, data.latestIssues);
  const checklist = findingWorkflow.statuses;
  const shouldRunClock = !audit || !isTerminalAuditStatus(audit.status);
  const reportPending = isFinalReportPending(data);

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();
    let renderFrame: number | undefined;
    const seed = loadRetryKey === 0 && admission.current?.audit?.id === auditId ? admission.current : undefined;
    dataRef.current = seed || createEmptyAuditLiveData();
    setData(dataRef.current);
    setError(null);
    setWarning(null);
    setReportRetryExhausted(false);
    setConnection({
      transport: 'websocket',
      status: 'connecting',
      message: 'Opening live audit connection.',
    });

    const closeUpdates = (message: string) => {
      unsubscribeRef.current();
      unsubscribeRef.current = () => {};
      if (isActive) setConnection({ transport: 'polling', status: 'closed', message, lastUpdateAt: Date.now() });
    };

    (seed ? Promise.resolve(seed) : loadStoredAuditSnapshot(auditId, controller.signal))
      .then(async (snapshot) => {
        if (!isActive) return;
        dataRef.current = snapshot;
        setData(snapshot);

        if (isTerminalAuditStatus(snapshot.audit?.status)) {
          closeUpdates(isFinalReportPending(snapshot) ? 'Checks finished. Loading the saved report.' : 'Stored audit result loaded.');
          return;
        }

        const { subscribeToAuditLiveData } = await import('../../lib/audit/live-supabase-client');
        if (!isActive) return;
        unsubscribeRef.current = subscribeToAuditLiveData(
          auditId,
          (nextData) => {
            if (!isActive) return;
            const merged = mergeAuditLiveData(dataRef.current, nextData);
            dataRef.current = merged;
            if (isTerminalAuditStatus(merged.audit?.status)) {
              if (renderFrame != null) cancelAnimationFrame(renderFrame);
              renderFrame = undefined;
              setData(merged);
              closeUpdates(isFinalReportPending(merged) ? 'Checks finished. Loading the saved report.' : 'Audit updates finished.');
            } else if (renderFrame == null) {
              renderFrame = requestAnimationFrame(() => {
                renderFrame = undefined;
                if (isActive) setData(dataRef.current);
              });
            }
          },
          (err) => isActive && setWarning(err.message),
          (nextConnection) => {
            if (!isActive) return;
            setConnection(nextConnection);
            if (nextConnection.status !== 'error') {
              setWarning(null);
            }
          },
          snapshot,
        );
      })
      .catch((err) => isActive && setError(err instanceof Error ? err.message : 'Failed to load this audit.'));

    return () => {
      isActive = false;
      controller.abort();
      if (renderFrame != null) cancelAnimationFrame(renderFrame);
      unsubscribeRef.current();
      unsubscribeRef.current = () => {};
    };
  }, [auditId, loadRetryKey]);

  useEffect(() => {
    if (!reportPending) return;
    let active = true;
    setReportRetryExhausted(false);

    waitForPersistedFinalReport(dataRef.current, () => loadStoredAuditSnapshot(auditId), {
      isActive: () => active,
      onSnapshot: (snapshot) => {
        if (!active) return;
        dataRef.current = snapshot;
        setData(snapshot);
      },
    }).then((result) => {
      if (active) setReportRetryExhausted(result.exhausted);
    });

    return () => {
      active = false;
    };
  }, [auditId, reportPending, reportRetryKey]);

  useEffect(() => {
    if (!shouldRunClock) return;
    let interval: number | undefined;
    const syncClock = () => {
      if (interval != null) window.clearInterval(interval);
      interval = undefined;
      if (document.hidden) return;
      setNow(Date.now());
      interval = window.setInterval(() => setNow(Date.now()), 1000);
    };
    syncClock();
    document.addEventListener('visibilitychange', syncClock);
    return () => {
      document.removeEventListener('visibilitychange', syncClock);
      if (interval != null) window.clearInterval(interval);
    };
  }, [shouldRunClock]);

  useEffect(() => {
    if (data.audit) {
      upsertAuditHistory(data);
    }
  }, [data]);

  const latestEvent = data.latestEvents[data.latestEvents.length - 1];
  const lastCheckedPage = useMemo(() => [...data.latestPages].reverse().find(page => page.fetchStatus === 'success') || data.latestPages.at(-1), [data.latestPages]);
  const livePresentation = useMemo(() => audit ? deriveAuditLivePresentation({
    audit,
    latestEvent,
    hasFinalReport: Boolean(data.finalReport),
    lastCheckedUrl: lastCheckedPage?.url,
    now,
  }) : null, [audit, data.finalReport, lastCheckedPage?.url, latestEvent, now]);

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

  const setChecklistStatus = useCallback((signature: string, status: ChecklistStatus) => {
    void findingWorkflow.update(signature, { status }).catch(() => undefined);
  }, [findingWorkflow.update]);

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
    const mode = audit?.effectiveMode || data.audit?.effectiveMode || 'quick';
    if (url && onRerun) onRerun(url, mode);
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


  const modes = useAuditWorkspaceMode();
  const viewFindings = useCallback(() => modes.setMode('findings'), [modes.setMode]);
  const [selectedPage, setSelectedPage] = useState<ResourceAuditPage | null>(null);
  const closePage = useCallback(() => setSelectedPage(null), []);
  const liveScore = useMemo(() => audit ? getAuditLiveScore({ audit, events: data.latestEvents, finalReport: data.finalReport }) : null, [audit, data.latestEvents, data.finalReport]);
  const categoryScores = useMemo(() => liveScore ? [
    { label: 'On-page SEO', value: liveScore.categoryScores.onPage ?? null },
    { label: 'Technical delivery', value: liveScore.categoryScores.technical ?? null },
    { label: 'Performance', value: liveScore.categoryScores.performance ?? null },
    { label: 'Passive security', value: liveScore.categoryScores.security ?? null },
    { label: 'Crawlability', value: liveScore.categoryScores.crawlability ?? null },
  ].filter((item): item is AuditCategoryScore => item.value != null) : [], [liveScore]);
  const coverageExplanation = useMemo(() => {
    if (!audit) return null;
    const finalCoverage = data.finalReport?.scores?.coverage as Record<string, unknown> | undefined;
    const coverage = [...data.latestEvents].reverse().find(event => event.type === 'crawl_coverage_completed')?.data as Record<string, unknown> | undefined;
    const stopReason = String(finalCoverage?.stopReason || coverage?.stopReason || '');
    return stopReason ? describeCrawlCompletion({ stopReason, pagesAnalysed: audit.pagesCrawled, pageLimit: audit.pageLimit }) : null;
  }, [audit, data.finalReport, data.latestEvents]);
  const scoreTrend = useMemo(() => audit ? scoreTrendForUrl(audit.normalizedUrl, readAuditHistory()) : [], [audit?.normalizedUrl, data.finalReport]);

  if (error && !audit) return <SurfaceCard className="p-5" role="alert"><Notice tone="danger" title="Audit unavailable">{humanizeAuditText(error)}</Notice><div className="mt-4 flex flex-wrap gap-2"><button type="button" className="trust-button" onClick={() => setLoadRetryKey(value => value + 1)}><RefreshCw className="h-4 w-4" />Try again</button><Link className="quiet-button" to="/app/audits/history"><History className="h-4 w-4" />Audit history</Link><Link className="quiet-button" to="/app"><LayoutDashboard className="h-4 w-4" />Dashboard</Link></div></SurfaceCard>;
  if (!audit || !liveScore) return <SurfaceCard className="flex items-center gap-3 p-5"><Loader2 className="h-5 w-5 animate-spin text-accent" /><span>Loading stored audit evidence...</span></SurfaceCard>;
  const terminal = isTerminalAuditStatus(audit.status);
  const workflowProps = { statuses: checklist, onStatusChange: setChecklistStatus, workflowRecords: findingWorkflow.records, workflowStorage: findingWorkflow.storage, workflowError: findingWorkflow.error, savingKeys: findingWorkflow.savingKeys, onWorkflowSave: findingWorkflow.update };
  return <div className="audit-customer-workspace w-full space-y-4">
    <header className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone={isCompletedAuditStatus(audit.status) ? 'success' : terminal ? 'danger' : 'accent'}>{statusLabel(audit.status)}</StatusBadge><span className="text-xs text-muted-foreground">{tierLabel(audit.processingTier, audit.effectiveMode || audit.mode)}</span></div><h1 className="mt-2 break-words text-2xl font-semibold">{audit.hostname}</h1><p className="mt-1 break-all text-xs text-muted-foreground">{audit.normalizedUrl}</p></div>
      <div className="flex flex-wrap gap-2">
        {data.finalReport && onOpenWorkspace && <button type="button" onClick={onOpenWorkspace} className="quiet-button min-h-9 px-3 py-1 text-xs"><BarChart3 className="h-4 w-4" />Detailed report</button>}
        {onRerun && terminal && <button type="button" onClick={rerunAudit} className="quiet-button min-h-9 px-3 py-1 text-xs"><RefreshCw className="h-4 w-4" />Rerun</button>}
        <button type="button" onClick={copyReportLink} className="quiet-button min-h-9 px-3 py-1 text-xs"><Share2 className="h-4 w-4" />Copy link</button>
        {data.finalReport && exportsEnabled && <button type="button" onClick={downloadJson} disabled={isDownloadingJson} className="quiet-button min-h-9 px-3 py-1 text-xs">{isDownloadingJson ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}JSON</button>}
        {data.finalReport && pdfEnabled && <button type="button" onClick={downloadPdf} disabled={isDownloadingPdf} className="quiet-button min-h-9 px-3 py-1 text-xs">{isDownloadingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}PDF</button>}
        {!terminal && <button type="button" onClick={cancelAudit} disabled={isCancelling} className="quiet-button min-h-9 px-3 py-1 text-xs text-[var(--danger)]">{isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <StopCircle className="h-4 w-4" />}Stop</button>}
      </div>
    </header>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5">{connection.status === 'error' ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}{terminal ? 'Stored audit' : formatLastUpdate(connection.lastUpdateAt, now)}</span><span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{formatAuditElapsed(audit, now)} elapsed</span>{!terminal && <span>{humanizeAuditText(audit.currentPhase)}</span>}</div>
    <AuditTerminalState audit={audit} reportPending={reportPending} reportRetrying={reportPending && !reportRetryExhausted} onRetryReport={() => setReportRetryKey(value => value + 1)} />
    <AuditReportReadyNote warning={audit.status === 'completed_with_warnings' && Boolean(data.finalReport)} />
    {error && <Notice tone="danger" title="Some audit data could not refresh">{humanizeAuditText(error)}</Notice>}
    {warning && !terminal && <Notice tone="warning">{humanizeAuditText(warning)}</Notice>}
    {(shareMessage || exportMessage) && <Notice tone={/copied|downloaded/.test(shareMessage || exportMessage || '') ? 'success' : 'danger'}>{shareMessage || exportMessage}</Notice>}
    {queuedTooLong && <Notice tone="warning" title="This audit is taking longer than usual to start">The audit engine may be waking up or finishing earlier work. Updates will resume automatically. Audit ID: {audit.id}</Notice>}
    <AuditWorkspaceModes mode={modes.mode} pathFor={modes.pathFor} />
    {modes.mode === 'overview' && <>
      <AuditExecutiveSummary audit={audit} score={liveScore.overallScore} scoreState={liveScore.scoreState} scoreLabel={liveScore.scoreState === 'final' ? 'Final score' : 'Live score'} scoreDetail={liveScore.scoreState === 'provisional' ? `Preliminary, from ${liveScore.pagesAnalysed} analysed pages` : 'Stored deterministic score'} categoryScores={categoryScores} progress={Math.max(0, Math.min(100, audit.progress || 0))} unavailableChecks={liveScore.unavailableCount} />
      {coverageExplanation && <p className="text-xs text-muted-foreground">{coverageExplanation}</p>}
      <AuditOverview data={data} onViewFindings={viewFindings} />
      <details className="border-y border-border py-3"><summary className="cursor-pointer text-sm font-semibold">Score history</summary><div className="max-w-xl pt-4"><SparklineChart values={scoreTrend.filter(entry => entry.score != null).map(entry => entry.score!)} label="Stored final scores" valueLabel={scoreTrend.at(-1)?.score == null ? 'No final score yet' : String(scoreTrend.at(-1)!.score)} /></div><Link className="quiet-button mt-3 min-h-9 text-xs" to={auditWorkspacePath(auditId)}>Compare stored audits</Link></details>
    </>}
    {modes.mode === 'findings' && <><nav className="flex flex-wrap gap-1 border-b border-border pb-2" aria-label="Detailed report categories">{(['seo', 'technical', 'crawlability', 'links', 'performance', 'accessibility', 'security'] as const).map(section => <Link key={section} to={auditWorkspacePath(auditId, section)} className="min-h-9 rounded-md px-3 py-2 text-xs capitalize text-muted-foreground hover:bg-muted">{section === 'seo' ? 'SEO' : section === 'security' ? 'Passive security' : section}</Link>)}</nav>{audit.processingVersion === 2 ? <PaginatedAuditEvidence auditId={auditId} kind="issues" {...workflowProps} /> : <FindingWorkspace auditId={auditId} issues={data.latestIssues} {...workflowProps} />}</>}
    {modes.mode === 'pages' && (audit.processingVersion === 2 ? <PaginatedAuditEvidence auditId={auditId} kind="pages" pageIssues={data.latestIssues} /> : <section><h2 className="mb-3 text-lg font-semibold">Pages checked</h2><AuditPagesTable pages={data.latestPages} onSelect={setSelectedPage} /><PageEvidenceDrawer page={selectedPage} issues={data.latestIssues} onClose={closePage} /></section>)}
    {modes.mode === 'activity' && <><div className="border-b border-border pb-4"><h2 className="text-sm font-semibold">{livePresentation?.heading}</h2><p className="mt-1 break-words text-sm text-muted-foreground">{livePresentation?.message}</p>{livePresentation?.target && <p className="mt-1 break-all text-xs text-muted-foreground">{livePresentation.target}</p>}</div><AuditActivityFeed events={data.latestEvents} /><details className="border-y border-border py-3"><summary className="cursor-pointer text-sm font-semibold">Audit details and queue state</summary><dl className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">{[['Audit ID', audit.id], ['Submitted input', audit.submittedInput], ['Cleaned URL', audit.normalizedUrl], ['Final URL', audit.finalUrl || 'Not recorded'], ['Audit mode', getAuditModeLabel(audit.mode)], ['Pages', `${audit.pagesCrawled} / ${audit.pageLimit}`], ['Current check', humanizeAuditText(audit.currentCheck)], ['Created', new Date(audit.createdAt).toLocaleString()], ['Plan', audit.plan || 'free']].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-all text-sm">{value}</dd></div>)}</dl>{audit.status === 'queued' && audit.estimatedWaitSeconds != null && <p className="mt-4 text-xs text-muted-foreground">Estimated start: {audit.estimatedWaitSeconds > 0 ? `about ${Math.max(1, Math.ceil(audit.estimatedWaitSeconds / 60))} minutes` : 'next available slot'}. Estimates may change.</p>}</details></>}
    {terminal && audit.processingTier === 'free' && <p className="text-xs text-muted-foreground">Standard audit access provides broader reachable-page coverage and extended export options.</p>}
  </div>;
}
