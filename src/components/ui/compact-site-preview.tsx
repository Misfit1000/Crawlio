import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Globe2, ImageOff, Monitor, Smartphone } from 'lucide-react';
import { resolveAuditPreviewState, safePreviewMediaUrl, safePreviewThemeColor, type AuditPreviewKind } from '../../lib/audit/preview-model';

export interface CompactPreviewProps {
  url?: string | null;
  title?: string | null;
  description?: string | null;
  h1?: string | null;
  siteName?: string | null;
  hostname?: string | null;
  canonicalUrl?: string | null;
  faviconUrl?: string | null;
  openGraphImage?: string | null;
  screenshotUrl?: string | null;
  themeColor?: string | null;
}

function previewHost(url?: string | null, hostname?: string | null) {
  if (hostname) return hostname.replace(/^www\./, '');
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return String(url || '').replace(/^www\./, '');
  }
}

function previewUrl(url?: string | null, hostname?: string | null) {
  if (url) return url;
  return hostname ? `https://${hostname}` : '';
}

function displayTitle(props: CompactPreviewProps) {
  return props.h1?.trim() || props.title?.trim() || 'No page heading was collected';
}

function displayDescription(props: CompactPreviewProps) {
  return props.description?.trim() || 'No meta description was collected for this page.';
}

function previewLabel(kind: AuditPreviewKind) {
  if (kind === 'screenshot') return 'Screenshot';
  if (kind === 'open_graph') return 'Open Graph preview';
  if (kind === 'metadata') return 'Metadata preview';
  return 'Preview unavailable';
}

function InitialMark({ host, className = '' }: { host: string; className?: string }) {
  return <span className={`flex items-center justify-center bg-accent/10 font-semibold text-accent ${className}`}>{host.slice(0, 1).toUpperCase() || <Globe2 className="h-4 w-4" />}</span>;
}

function PreviewLogo({ host, faviconUrl, className = '' }: { host: string; faviconUrl?: string | null; className?: string }) {
  const source = safePreviewMediaUrl(faviconUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  if (!source || failed) return <InitialMark host={host} className={className} />;
  return <img src={source} alt="" className={`bg-white object-contain ${className}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function PreviewStateBadge({ kind }: { kind: AuditPreviewKind }) {
  return <span className="inline-flex items-center rounded-full border border-border bg-card/95 px-2.5 py-1 text-[11px] font-semibold text-foreground shadow-sm">{previewLabel(kind)}</span>;
}

export function PreviewUnavailableState({ url }: { url?: string | null }) {
  return (
    <div className="flex min-h-56 items-center justify-center rounded-lg border border-dashed border-border bg-muted/25 p-6 text-center">
      <div className="max-w-sm"><ImageOff className="mx-auto h-7 w-7 text-muted-foreground" /><h3 className="mt-3 text-base font-semibold">Preview unavailable</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">No genuine screenshot or usable page metadata was collected. The audit findings remain available.</p>{url && <a href={url} target="_blank" rel="noreferrer noopener" className="quiet-button mt-4 px-3 py-2 text-xs">Open actual site <ExternalLink className="h-3.5 w-3.5" /></a>}</div>
    </div>
  );
}

export function DesktopHomepagePreview({ props, kind, mediaUrl }: { props: CompactPreviewProps; kind: AuditPreviewKind; mediaUrl: string | null }) {
  const host = previewHost(props.url, props.hostname);
  const address = previewUrl(props.url, props.hostname);
  const accent = safePreviewThemeColor(props.themeColor) || 'var(--accent)';
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm" aria-label={`${previewLabel(kind)} desktop composition`}>
      <div className="flex h-9 items-center gap-1.5 border-b border-border bg-muted/45 px-3"><span className="h-2 w-2 rounded-full bg-red-400" /><span className="h-2 w-2 rounded-full bg-amber-400" /><span className="h-2 w-2 rounded-full bg-emerald-400" /><div className="ml-2 min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2.5 py-1 text-[10px] text-muted-foreground">{address || 'Page URL unavailable'}</div></div>
      <div className="relative h-[270px] overflow-hidden bg-background">
        {kind === 'screenshot' && mediaUrl ? <img src={mediaUrl} alt={`Actual screenshot collected for ${host}`} className="h-full w-full object-cover object-top" loading="lazy" referrerPolicy="no-referrer" /> : <>
          {kind === 'open_graph' && mediaUrl && <img src={mediaUrl} alt={`${props.siteName || host} Open Graph image`} className="absolute inset-0 h-full w-full object-cover opacity-25" loading="lazy" referrerPolicy="no-referrer" />}
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/95 to-background/60" />
          <div className="relative flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border/70 bg-card/75 px-4 py-3 backdrop-blur-sm"><div className="flex min-w-0 items-center gap-2.5"><PreviewLogo host={host} faviconUrl={props.faviconUrl} className="h-8 w-8 shrink-0 rounded-md border border-border" /><div className="min-w-0"><div className="truncate text-sm font-semibold">{props.siteName || host || 'Website'}</div><div className="truncate text-[10px] text-muted-foreground">Collected homepage metadata</div></div></div><PreviewStateBadge kind={kind} /></div>
            <div className="flex flex-1 items-center px-5 py-4 sm:max-w-[72%]"><div><div className="mb-3 h-1 w-10 rounded-full" style={{ backgroundColor: accent }} /><h3 className="line-clamp-3 text-xl font-semibold leading-tight sm:text-2xl">{displayTitle(props)}</h3><p className="mt-3 line-clamp-3 text-xs leading-5 text-muted-foreground sm:text-sm">{displayDescription(props)}</p><div className="mt-4 flex flex-wrap gap-2 text-[10px] text-muted-foreground">{props.title && <span className="rounded-full border border-border bg-card/90 px-2.5 py-1">Title collected</span>}{props.h1 && <span className="rounded-full border border-border bg-card/90 px-2.5 py-1">H1 collected</span>}{props.canonicalUrl && <span className="rounded-full border border-border bg-card/90 px-2.5 py-1">Preferred URL collected</span>}</div></div></div>
          </div>
        </>}
      </div>
    </div>
  );
}

export function MobileHomepagePreview({ props, kind, mediaUrl }: { props: CompactPreviewProps; kind: AuditPreviewKind; mediaUrl: string | null }) {
  const host = previewHost(props.url, props.hostname);
  return (
    <div className="w-[132px] rounded-[1.35rem] border-[6px] border-slate-950 bg-slate-950 p-0.5 shadow-sm dark:border-slate-900" aria-label={`${previewLabel(kind)} mobile composition`}>
      <div className="h-[238px] overflow-hidden rounded-[0.95rem] bg-background">
        <div className="mx-auto mt-1 h-1 w-10 rounded-full bg-slate-700" />
        {kind === 'screenshot' && mediaUrl ? <img src={mediaUrl} alt={`Actual mobile crop from the screenshot for ${host}`} className="mt-1 h-[230px] w-full object-cover object-top" loading="lazy" referrerPolicy="no-referrer" /> : <div className="p-2.5"><div className="flex items-center gap-1.5 border-b border-border pb-2"><PreviewLogo host={host} faviconUrl={props.faviconUrl} className="h-6 w-6 rounded-md border border-border" /><span className="min-w-0 flex-1 truncate text-[9px] font-semibold">{props.siteName || host || 'Website'}</span></div>{kind === 'open_graph' && mediaUrl && <img src={mediaUrl} alt="" className="mt-2 h-16 w-full rounded-md object-cover" loading="lazy" referrerPolicy="no-referrer" />}<div className="mt-3 h-0.5 w-6 rounded-full bg-accent" /><div className="mt-2 line-clamp-3 text-[11px] font-semibold leading-4">{displayTitle(props)}</div><p className="mt-2 line-clamp-4 text-[8px] leading-3 text-muted-foreground">{displayDescription(props)}</p><div className="mt-3"><PreviewStateBadge kind={kind} /></div></div>}
      </div>
    </div>
  );
}

export function CompactWebsitePreview(props: CompactPreviewProps) {
  const initialState = useMemo(() => resolveAuditPreviewState(props), [props.url, props.hostname, props.title, props.description, props.h1, props.siteName, props.screenshotUrl, props.openGraphImage]);
  const [failedMedia, setFailedMedia] = useState<string | null>(null);
  useEffect(() => setFailedMedia(null), [initialState.mediaUrl]);
  const state = initialState.mediaUrl && failedMedia === initialState.mediaUrl
    ? resolveAuditPreviewState({ ...props, screenshotUrl: null, openGraphImage: initialState.kind === 'open_graph' ? null : props.openGraphImage })
    : initialState;

  if (state.kind === 'unavailable') return <PreviewUnavailableState url={props.url} />;
  return (
    <div className="relative mx-auto w-full max-w-[620px] pb-14 pr-0 sm:pb-6 sm:pr-16">
      <div onErrorCapture={() => state.mediaUrl && setFailedMedia(state.mediaUrl)}><DesktopHomepagePreview props={props} kind={state.kind} mediaUrl={state.mediaUrl} /></div>
      <div className="absolute bottom-0 right-3 sm:-right-1 sm:bottom-0"><MobileHomepagePreview props={props} kind={state.kind} mediaUrl={state.mediaUrl} /></div>
    </div>
  );
}
