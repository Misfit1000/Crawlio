import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, FileCheck2, Image, Link2, SearchCheck, ShieldCheck } from 'lucide-react';
import type { BlogPost, BlogPostInput, BlogSource } from '../../lib/blog/types';
import { StatusBadge } from '../ui/visual-system';

function currentDraftReadiness(draft: BlogPostInput) {
  const text = String(draft.contentHtml || '')
    .replace(/<\/(?:p|h[1-6]|li|blockquote|pre|div|section)>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const wordCount = text ? text.split(/\s+/).length : 0;
  const links = [...String(draft.contentHtml || '').matchAll(/<a\b[^>]*\bhref=(?:"([^"]*)"|'([^']*)')[^>]*>/gi)]
    .map((match) => String(match[1] || match[2] || ''));
  const internalLinks = links.filter((href) => /^\/(?!\/)/.test(href));
  const sources = draft.sources || [];
  const completeSources = sources.filter((source) => /^https?:\/\//i.test(source.url) && source.title.trim() && source.publisher.trim());
  const linkedSources = completeSources.filter((source) => links.includes(source.url));
  const checks = [
    { id: 'useful-substance', label: 'Article contains enough useful substance', passed: wordCount >= 500, detail: `${wordCount} words found; at least 500 are required.` },
    { id: 'sources', label: 'Required research sources are recorded', passed: completeSources.length > 0, detail: `${completeSources.length} complete research source ${completeSources.length === 1 ? 'record' : 'records'} found; at least one is required.` },
    { id: 'source-links', label: 'Every stored source is hyperlinked', passed: completeSources.length > 0 && linkedSources.length === completeSources.length, detail: `${linkedSources.length} of ${completeSources.length} source URLs are linked in the article body.` },
    { id: 'internal-links', label: 'At least two internal links are crawlable', passed: internalLinks.length >= 2, detail: `${internalLinks.length} internal ${internalLinks.length === 1 ? 'link' : 'links'} found; at least two are required.` },
  ];
  return { wordCount, checks };
}

function statusTone(value: string | undefined) {
  if (value === 'passed' || value === 'not_required') return 'success' as const;
  if (value === 'blocked' || value === 'failed') return 'danger' as const;
  return 'warning' as const;
}

export default function BlogEditorialReviewPanel({ post, draft }: { post?: BlogPost; draft: BlogPostInput }) {
  const [selectedClaim, setSelectedClaim] = useState<{ claim: string; source: BlogSource } | null>(null);
  const [selectedWarning, setSelectedWarning] = useState('');
  const sources = draft.sources || [];
  const liveReadiness = useMemo(() => currentDraftReadiness(draft), [draft]);
  const failedChecks = liveReadiness.checks.filter((item) => !item.passed);
  const internalLinkCheck = liveReadiness.checks.find((item) => item.id === 'internal-links');
  const externalLinkCheck = liveReadiness.checks.find((item) => item.id === 'source-links');
  const qualityStatus = failedChecks.length ? 'blocked' : 'passed';
  const sourceStatus = sources.length > 0 && sources.every((source) => source.citationStatus === 'verified') ? 'passed' : draft.sourceStatus || 'pending';
  const checks = useMemo(() => [
    ['Quality gates', qualityStatus, FileCheck2], ['Source verification', sourceStatus, SearchCheck],
    ['Originality', draft.originalityStatus || 'pending', ShieldCheck], ['Internal links', internalLinkCheck?.passed ? 'passed' : 'needs_review', Link2],
    ['External references', externalLinkCheck?.passed ? 'passed' : 'needs_review', ExternalLink], ['Image licence', draft.ogImageUrl ? draft.imageStatus || 'pending' : 'not_required', Image],
    ['Static HTML', draft.prerenderStatus || 'pending', FileCheck2], ['Sitemap and RSS', draft.status === 'published' && !String(draft.robotsDirective || '').includes('noindex') ? 'passed' : 'not_required', CheckCircle2],
  ] as const, [draft, externalLinkCheck?.passed, internalLinkCheck?.passed, qualityStatus, sourceStatus]);
  const warnings = draft.qualityResults?.warnings || [];
  return <aside className="h-fit rounded-lg border border-border bg-muted/20 p-4 2xl:sticky 2xl:top-24" aria-label="Editorial validation">
    <h4 className="font-semibold text-foreground">Publication readiness</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">These checks update from the article currently in the editor, including unsaved changes.</p>
    <div className="mt-4 flex items-center justify-between border-b border-border pb-3 text-sm">
      <span className="text-muted-foreground">Article length</span>
      <span className="font-semibold text-foreground">{liveReadiness.wordCount} words</span>
    </div>
    {failedChecks.length > 0 ? <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
      <p className="text-sm font-semibold text-foreground">{failedChecks.length} required {failedChecks.length === 1 ? 'fix' : 'fixes'} before publishing</p>
      <ul className="mt-2 space-y-2">
        {failedChecks.map((item) => <li key={item.id} className="flex gap-2 text-xs leading-5 text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span><strong className="font-semibold text-foreground">{item.label}.</strong> {item.detail}</span>
        </li>)}
      </ul>
    </div> : <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm text-emerald-800 dark:text-emerald-200">
      <CheckCircle2 className="h-4 w-4 shrink-0" /> Content requirements are ready.
    </div>}
    <div className="mt-4 space-y-2">{checks.map(([label, value, Icon]) => <div key={label} className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"><span className="flex items-center gap-2 text-sm text-foreground"><Icon className="h-4 w-4 text-muted-foreground" /> {label}</span><StatusBadge tone={statusTone(String(value))}>{String(value).replaceAll('_', ' ')}</StatusBadge></div>)}</div>
    <div className="mt-5"><h5 className="text-sm font-semibold text-foreground">Claims and sources</h5><div className="mt-2 space-y-2">{sources.flatMap((source) => (source.supportedClaims || []).map((claim) => <button key={`${source.url}-${claim}`} type="button" onClick={() => setSelectedClaim({ claim, source })} className="w-full rounded-md border border-border bg-card p-3 text-left text-xs leading-5 hover:border-accent"><span className="line-clamp-2 text-foreground">{claim}</span><span className="mt-1 block text-muted-foreground">{source.publisher}</span></button>))}{!sources.some((source) => source.supportedClaims?.length) && <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">No claim records attached yet.</p>}</div></div>
    {selectedClaim && <div className="mt-3 rounded-md border border-accent/25 bg-accent/5 p-3 text-xs"><p className="font-semibold text-foreground">{selectedClaim.claim}</p><a href={selectedClaim.source.url} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-1 break-all text-accent">{selectedClaim.source.title}<ExternalLink className="h-3 w-3" /></a><p className="mt-1 text-muted-foreground">{selectedClaim.source.citationStatus || 'needs review'} · {selectedClaim.source.publishedAt ? new Date(selectedClaim.source.publishedAt).toLocaleDateString() : 'Source date unavailable'}</p></div>}
    <div className="mt-5"><h5 className="text-sm font-semibold text-foreground">Originality review</h5><div className="mt-2 space-y-2">{warnings.map((warning) => <button key={warning} type="button" onClick={() => setSelectedWarning(warning)} className="flex w-full gap-2 rounded-md border border-amber-500/25 bg-amber-500/5 p-3 text-left text-xs leading-5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><span>{warning}</span></button>)}{!warnings.length && <p className="text-xs text-muted-foreground">No originality warning is recorded.</p>}</div>{selectedWarning && <p className="mt-2 rounded-md bg-card p-3 text-xs leading-5 text-muted-foreground">Affected text requires a manual comparison with its attached source. Recommended action: rewrite from verified evidence or remove repeated wording. {selectedWarning}</p>}</div>
    {post?.imageVariants?.length ? <div className="mt-5"><h5 className="text-sm font-semibold text-foreground">Responsive image variants</h5><div className="mt-2 grid grid-cols-2 gap-2">{post.imageVariants.map((variant) => <div key={`${variant.width}-${variant.format}`} className="rounded-md border border-border bg-card p-2 text-xs"><p className="font-semibold">{variant.width} × {variant.height}</p><p className="text-muted-foreground">{variant.format.toUpperCase()} · {Math.max(1, Math.round(variant.fileSize / 1024))} KB</p></div>)}</div><p className="mt-2 break-all text-xs text-muted-foreground">Source: {post.ogImageUrl}<br />Attribution: {post.ogImageAttribution || 'Not required or not supplied'}</p></div> : null}
  </aside>;
}
