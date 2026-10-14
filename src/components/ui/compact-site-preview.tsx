import { useEffect, useRef, useState } from 'react';
import { ExternalLink, ImageOff, Loader2, Maximize2, Monitor, RefreshCw, Smartphone, X } from 'lucide-react';
import { safePreviewMediaUrl, type AuditPreviewKind } from '../../lib/audit/preview-model';
import { useSitePreview } from '../../lib/preview/use-site-preview';

export interface CompactPreviewProps {
  auditId?: string; shareToken?: string;
  url?: string | null; title?: string | null; description?: string | null; h1?: string | null;
  siteName?: string | null; hostname?: string | null; canonicalUrl?: string | null;
  faviconUrl?: string | null; openGraphImage?: string | null; screenshotUrl?: string | null;
  mobileScreenshotUrl?: string | null; themeColor?: string | null;
}

export function PreviewUnavailableState({ url, message = 'A real screenshot is not available. Audit findings are unaffected.' }: { url?: string | null; message?: string }) {
  const href = safePreviewMediaUrl(url);
  return <div className="flex min-h-56 flex-col items-center justify-center gap-3 bg-muted/20 px-6 py-10 text-center">
    <ImageOff className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
    <p className="max-w-sm text-sm leading-6 text-muted-foreground">{message}</p>
    {href && <a href={href} target="_blank" rel="noreferrer noopener" className="quiet-button">Open site <ExternalLink className="h-4 w-4" /></a>}
  </div>;
}

type LegacyPreview = { props: CompactPreviewProps; kind: AuditPreviewKind; mediaUrl: string | null };
export function DesktopHomepagePreview({ props, kind, mediaUrl }: LegacyPreview) {
  return kind === 'screenshot' && safePreviewMediaUrl(mediaUrl)
    ? <img src={mediaUrl!} alt={`Desktop screenshot of ${props.hostname || props.url || 'the audited page'}`} width="1440" height="900" className="h-auto w-full" loading="lazy" referrerPolicy="no-referrer" />
    : <PreviewUnavailableState url={props.url} />;
}
export function MobileHomepagePreview({ props }: LegacyPreview) {
  const source = safePreviewMediaUrl(props.mobileScreenshotUrl);
  return source ? <img src={source} alt={`Mobile screenshot of ${props.hostname || props.url || 'the audited page'}`} width="390" height="844" className="mx-auto h-auto w-full max-w-[390px]" loading="lazy" referrerPolicy="no-referrer" />
    : <PreviewUnavailableState url={props.url} message="A separate mobile screenshot has not been captured." />;
}

const FAILURE_LABELS: Record<string, string> = {
  PREVIEW_NOT_CONFIGURED: 'Screenshot capture is not configured yet.',
  SENSITIVE_URL: 'URLs containing access tokens or credentials are not captured.',
  ROBOTS_BLOCKED: 'The website does not allow Crawlio to capture this page.',
  DAILY_BROWSER_ALLOWANCE: 'The free daily screenshot allowance has been reached. Audits remain available.',
  CAPTURE_EXPIRED: 'This screenshot has expired. Refresh to request a current capture.',
};

export function CompactWebsitePreview(props: CompactPreviewProps) {
  const container = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<'desktop' | 'mobile'>('desktop');
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const { preview, loading } = useSitePreview(container, props.auditId, props.shareToken, retry);
  const source = safePreviewMediaUrl(mode === 'desktop' ? preview?.desktop?.url || props.screenshotUrl : preview?.mobile?.url || props.mobileScreenshotUrl);
  const pending = loading || preview?.status === 'queued' || preview?.status === 'running';
  const label = pending ? 'Preparing preview' : preview?.status === 'quota_exhausted' ? 'Daily allowance reached'
    : preview?.status === 'blocked' ? 'Blocked' : source && source !== failedImage ? 'Captured' : 'Unavailable';
  const href = safePreviewMediaUrl(preview?.finalUrl || props.url);
  useEffect(() => { setFailedImage(null); }, [source]);
  useEffect(() => {
    if (expanded && !dialog.current?.open) dialog.current?.showModal();
    if (!expanded && dialog.current?.open) { dialog.current.close(); opener.current?.focus(); }
  }, [expanded]);
  return <div ref={container} className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
      <div className="flex gap-1" role="group" aria-label="Screenshot viewport">
        {([{ id: 'desktop', icon: Monitor, label: 'Desktop' }, { id: 'mobile', icon: Smartphone, label: 'Mobile' }] as const).map(item => <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => setMode(item.id)} className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium ${mode === item.id ? 'bg-accent/10 text-accent' : 'text-muted-foreground hover:bg-muted'}`}><item.icon className="h-4 w-4" />{item.label}</button>)}
      </div>
      <div className="flex items-center gap-1">
        <span className="mr-2 inline-flex items-center gap-2 text-xs text-muted-foreground" role="status">{pending && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />}{label}</span>
        {(props.auditId || props.shareToken) && <button type="button" title="Refresh preview" aria-label="Refresh preview" disabled={loading} className="quiet-button h-11 w-11 p-0" onClick={() => setRetry(value => value+1)}><RefreshCw className="h-4 w-4" /></button>}
        {source && source !== failedImage && <button ref={opener} type="button" title="Enlarge screenshot" aria-label="Enlarge screenshot" className="quiet-button h-11 w-11 p-0" onClick={() => setExpanded(true)}><Maximize2 className="h-4 w-4" /></button>}
      </div>
    </div>
    <div className={`flex min-h-56 items-start justify-center bg-muted/10 ${mode === 'mobile' ? 'py-4' : 'aspect-[8/5]'}`}>
      {source && source !== failedImage ? <img src={source} alt={`${mode === 'desktop' ? 'Desktop' : 'Mobile'} screenshot of ${props.hostname || props.url || 'the audited page'}`} width={mode === 'desktop' ? 1440 : 390} height={mode === 'desktop' ? 900 : 844} className={`h-auto w-full object-contain ${mode === 'mobile' ? 'max-w-[250px]' : ''}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedImage(source)} />
        : pending ? <div className="flex min-h-56 items-center gap-3 p-6 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />Capturing the public page</div>
        : <PreviewUnavailableState url={props.url} message={FAILURE_LABELS[preview?.failureCode || ''] || (preview?.status === 'quota_exhausted' ? FAILURE_LABELS.DAILY_BROWSER_ALLOWANCE : undefined)} />}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
      <span>{preview?.capturedAt ? `${preview.stale ? 'Previous capture' : 'Captured'} ${new Date(preview.capturedAt).toLocaleString()}` : 'Public page screenshot, not a browser performance test'}</span>
      {href && <a className="inline-flex min-h-8 min-w-0 items-center gap-1.5 text-accent" href={href} target="_blank" rel="noreferrer noopener"><span className="max-w-[300px] truncate">{preview?.finalUrl || props.hostname || 'Open site'}</span><ExternalLink className="h-3.5 w-3.5 shrink-0" /></a>}
    </div>
    <dialog ref={dialog} aria-label={`${mode} screenshot`} onCancel={() => setExpanded(false)} onClose={() => setExpanded(false)} className="max-h-[95dvh] w-[min(96vw,1480px)] overflow-auto rounded-lg border border-border bg-card p-0 text-foreground backdrop:bg-black/80">
      <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-4 py-2"><span className="text-sm font-medium">{mode === 'desktop' ? 'Desktop' : 'Mobile'} capture</span><button type="button" autoFocus className="quiet-button h-11 w-11 p-0" aria-label="Close screenshot" onClick={() => setExpanded(false)}><X className="h-4 w-4" /></button></div>
      {expanded && source && <img src={source} alt={`${mode} screenshot enlarged`} className={`mx-auto h-auto w-full ${mode === 'mobile' ? 'max-w-[390px]' : ''}`} referrerPolicy="no-referrer" />}
    </dialog>
  </div>;
}
