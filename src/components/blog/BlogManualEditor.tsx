import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, ExternalLink, FileCheck2, Globe2, Loader2, Plus, RotateCcw, Save, Trash2, WandSparkles, XCircle } from 'lucide-react';
import {
  archiveAdminBlogPost, deleteAdminBlogEditorDraft, getAdminBlogEditorDraft, importAdminBlogImage,
  inspectAdminBlogSource, preflightAdminBlogDraft, saveAdminBlogEditorDraft, saveAdminBlogPost,
} from '../../lib/blog/client';
import { blogEditorHasMeaningfulChanges, blogEditorWordCount, buildBlogReadiness, deriveAutomaticBlogFields, type BlogAutosaveStatus, type BlogEditorStep } from '../../lib/blog/editor-experience';
import { createBlogSlug } from '../../lib/blog/slug';
import type { BlogPost, BlogPostInput, BlogPostStatus, BlogSource } from '../../lib/blog/types';
import { Notice, Panel, FormField } from '../ui/page-system';
import { StatusBadge } from '../ui/visual-system';
import BlogEditorialReviewPanel from './BlogEditorialReviewPanel';
import BlogSectionRevisionPanel from './BlogSectionRevisionPanel';
import RichTextEditor from './RichTextEditor';

type Draft = BlogPostInput & {
  title: string; slug: string; excerpt: string; tagline: string; summary: string; contentHtml: string;
  focusKeyword: string; tags: string[]; seoTitle: string; metaDescription: string; canonicalUrl: string;
  ogImageUrl: string; status: BlogPostStatus; publishedAt: string;
};

const EMPTY_DRAFT: Draft = {
  title: '', slug: '', excerpt: '', tagline: '', summary: '', contentHtml: '<p></p>', focusKeyword: '', tags: [],
  seoTitle: '', metaDescription: '', canonicalUrl: '', ogImageUrl: '', status: 'draft', publishedAt: '',
  origin: 'admin_manual', articleType: 'evergreen_guide', topicCluster: '', fixtureTest: false, sources: [],
};

const AUTOMATIC_FIELDS = ['slug', 'excerpt', 'tagline', 'summary', 'focusKeyword', 'tags', 'topicCluster', 'seoTitle', 'metaDescription'] as const;

function fromPost(post?: BlogPost): Draft {
  if (!post) return { ...EMPTY_DRAFT };
  return {
    title: post.title, slug: post.slug, excerpt: post.excerpt, tagline: post.tagline, summary: post.summary,
    contentHtml: post.contentHtml, focusKeyword: post.focusKeyword, tags: post.tags, seoTitle: post.seoTitle,
    metaDescription: post.metaDescription, canonicalUrl: post.canonicalUrl, ogImageUrl: post.ogImageUrl,
    ogImageAlt: post.ogImageAlt, ogImageAttribution: post.ogImageAttribution, imageVariants: post.imageVariants,
    status: post.status, origin: post.origin, articleType: post.articleType, topicCluster: post.topicCluster,
    sources: post.sources, relatedArticles: post.relatedArticles, qualityStatus: post.qualityStatus,
    qualityResults: post.qualityResults, originalityStatus: post.originalityStatus, sourceStatus: post.sourceStatus,
    prerenderStatus: post.prerenderStatus, imageStatus: post.imageStatus,
    publishedAt: (post.scheduledAt || post.publishedAt) ? String(post.scheduledAt || post.publishedAt).slice(0, 16) : '', fixtureTest: post.fixtureTest,
  };
}

function saveLabel(status: BlogAutosaveStatus) {
  return { idle: 'Not saved yet', saving: 'Saving', saved: 'Saved', offline: 'Offline copy saved', failed: 'Save failed' }[status];
}

function sanitizePreviewHtml(value: string) {
  const document = new DOMParser().parseFromString(String(value || ''), 'text/html');
  document.querySelectorAll('script,style,iframe,object,embed,template,form').forEach((element) => element.remove());
  const allowed = new Set(['P', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'U', 'S', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'BR', 'A']);
  [...document.body.querySelectorAll('*')].reverse().forEach((element) => {
    if (!allowed.has(element.tagName)) { element.replaceWith(...element.childNodes); return; }
    [...element.attributes].forEach((attribute) => {
      if (element.tagName !== 'A' || !['href', 'title'].includes(attribute.name)) element.removeAttribute(attribute.name);
    });
    if (element.tagName === 'A') {
      const href = element.getAttribute('href') || '';
      if (!/^(https?:\/\/|mailto:|\/)/i.test(href)) element.removeAttribute('href');
      element.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return document.body.innerHTML;
}

function AutoField({ label, field, overridden, onReset, children }: { label: string; field: string; overridden: boolean; onReset: (field: string) => void; children: React.ReactNode }) {
  return <FormField label={<span className="flex items-center gap-2">{label}<StatusBadge tone={overridden ? 'neutral' : 'accent'}>{overridden ? 'Custom' : 'Auto'}</StatusBadge></span>}>
    <div>{children}{overridden && <button type="button" onClick={() => onReset(field)} className="mt-2 flex items-center gap-1 text-xs font-semibold text-accent"><RotateCcw className="h-3 w-3" /> Reset to automatic</button>}</div>
  </FormField>;
}

export default function BlogManualEditor({ post, onClose, onSaved, onArchived }: { post?: BlogPost; onClose: () => void; onSaved: (post: BlogPost) => void; onArchived: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => fromPost(post));
  const [step, setStep] = useState<BlogEditorStep>('write');
  const [overrides, setOverrides] = useState<string[]>(() => post ? AUTOMATIC_FIELDS.filter((field) => {
    const value = (post as any)[field];
    return Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim());
  }) : []);
  const [autosave, setAutosave] = useState<BlogAutosaveStatus>('idle');
  const versionRef = useRef<number | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [editorialReviewed, setEditorialReviewed] = useState(false);
  const [recovery, setRecovery] = useState<Record<string, unknown> | null>(null);
  const [headingPreview, setHeadingPreview] = useState<{ previousContentHtml: string; contentHtml: string; headings: string[] } | null>(null);
  const [headingUndo, setHeadingUndo] = useState<string | null>(null);
  const [autoFixedIds, setAutoFixedIds] = useState<string[]>([]);
  const [imageImport, setImageImport] = useState({ sourceUrl: '', creator: '', publisher: '', licence: '', altText: '' });
  const clientDraftIdRef = useRef(post ? `article-${post.id}` : `new-${crypto.randomUUID()}`);
  const lastServerSaveRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const suppressFinalSaveRef = useRef(false);
  const dirtyRef = useRef(false);
  const latestBufferRef = useRef({ draft, step, overrides });
  latestBufferRef.current = { draft, step, overrides };
  const localKey = `crawlio_blog_editor:${clientDraftIdRef.current}`;
  const wordCount = useMemo(() => blogEditorWordCount(draft.contentHtml), [draft.contentHtml]);
  const readiness = useMemo(() => buildBlogReadiness(draft), [draft]);
  const previewHtml = useMemo(() => sanitizePreviewHtml(draft.contentHtml), [draft.contentHtml]);
  const unresolved = readiness.filter((item) => !item.passed && item.severity === 'required');

  const update = <K extends keyof Draft>(key: K, value: Draft[K], manual = true) => {
    dirtyRef.current = true;
    suppressFinalSaveRef.current = false;
    setDraft((current) => ({ ...current, [key]: value }));
    if (manual && AUTOMATIC_FIELDS.includes(key as any)) setOverrides((current) => [...new Set([...current, String(key)])]);
    setEditorialReviewed(false);
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const automatic = deriveAutomaticBlogFields(draft);
      setDraft((current) => {
        const next = { ...current } as any;
        let changed = false;
        Object.entries(automatic).forEach(([key, value]) => {
          if (overrides.includes(key)) return;
          if (JSON.stringify((next as any)[key]) !== JSON.stringify(value)) { (next as any)[key] = value; changed = true; }
        });
        return changed ? next : current;
      });
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [draft.title, draft.contentHtml, overrides]);

  useEffect(() => {
    let cancelled = false;
    const recover = async () => {
      try {
        const local = localStorage.getItem(localKey);
        const server = await getAdminBlogEditorDraft(clientDraftIdRef.current, post?.id);
        const localPayload = local ? JSON.parse(local) : null;
        const serverPayload = server.draft?.payload || null;
        const localTime = Date.parse(String(localPayload?.editorLocalSavedAt || '')) || 0;
        const serverTime = Date.parse(String(server.draft?.updatedAt || '')) || 0;
        const payload = localTime > serverTime ? localPayload : serverPayload || localPayload;
        if (!cancelled && payload && blogEditorHasMeaningfulChanges(payload as BlogPostInput)) {
          setRecovery(payload);
          const nextVersion = server.draft?.version || null;
          versionRef.current = nextVersion;
        }
      } catch {}
    };
    void recover();
    return () => { cancelled = true; };
  }, [localKey, post?.id]);

  const saveBuffer = async (snapshot = draft, currentStep = step) => {
    if (!dirtyRef.current) return;
    const payload = { ...snapshot, editorStep: currentStep, automaticOverrides: overrides, editorLocalSavedAt: new Date().toISOString() };
    try { localStorage.setItem(localKey, JSON.stringify(payload)); } catch { setAutosave('failed'); }
    if (!blogEditorHasMeaningfulChanges(snapshot)) return;
    const operation = saveChainRef.current.catch(() => undefined).then(async () => {
      setAutosave(navigator.onLine ? 'saving' : 'offline');
      if (!navigator.onLine) return;
      try {
        const result = await saveAdminBlogEditorDraft({ clientDraftId: clientDraftIdRef.current, articleId: post?.id || null, payload, expectedVersion: versionRef.current, basePostUpdatedAt: post?.updatedAt || null });
        versionRef.current = result.draft.version; lastServerSaveRef.current = Date.now(); setAutosave('saved');
      } catch (requestError) {
        setAutosave('failed'); setError(requestError instanceof Error ? requestError.message : 'Autosave failed. Your browser copy is still available.');
      }
    });
    saveChainRef.current = operation;
    await operation;
  };

  useEffect(() => {
    if (!dirtyRef.current) return;
    try { localStorage.setItem(localKey, JSON.stringify({ ...draft, editorStep: step, automaticOverrides: overrides, editorLocalSavedAt: new Date().toISOString() })); } catch { setAutosave('failed'); }
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const delay = Math.max(3_000, 15_000 - (Date.now() - lastServerSaveRef.current));
    timerRef.current = window.setTimeout(() => void saveBuffer(), delay);
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, [draft, step, overrides]);

  useEffect(() => () => {
    if (suppressFinalSaveRef.current || !dirtyRef.current) return;
    const latest = latestBufferRef.current;
    if (!blogEditorHasMeaningfulChanges(latest.draft)) return;
    const payload = { ...latest.draft, editorStep: latest.step, automaticOverrides: latest.overrides, editorLocalSavedAt: new Date().toISOString() };
    try { localStorage.setItem(localKey, JSON.stringify(payload)); } catch {}
    if (navigator.onLine) void saveChainRef.current.catch(() => undefined).then(() => saveAdminBlogEditorDraft({
      clientDraftId: clientDraftIdRef.current, articleId: post?.id || null, payload,
      expectedVersion: versionRef.current, basePostUpdatedAt: post?.updatedAt || null,
    })).catch(() => undefined);
  }, [localKey, post?.id, post?.updatedAt]);

  const flushScheduledSave = () => { if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; } };
  const move = async (next: BlogEditorStep) => { flushScheduledSave(); await saveBuffer(draft, next); setStep(next); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const close = async () => { flushScheduledSave(); await saveBuffer(); suppressFinalSaveRef.current = true; onClose(); };
  const resetAuto = (field: string) => { dirtyRef.current = true; suppressFinalSaveRef.current = false; setOverrides((current) => current.filter((item) => item !== field)); setMessage(`${field.replace(/([A-Z])/g, ' $1')} returned to automatic.`); };
  const updateSource = (index: number, patch: Partial<BlogSource>) => update('sources', (draft.sources || []).map((source, sourceIndex) => sourceIndex === index ? { ...source, ...patch } : source), false);
  const removeSource = (index: number) => update('sources', (draft.sources || []).filter((_, sourceIndex) => sourceIndex !== index), false);

  const inspectSource = async () => {
    setBusy('source'); setError('');
    try {
      const result = await inspectAdminBlogSource(sourceUrl.trim());
      update('sources', [result.source, ...(draft.sources || []).filter((source) => source.url !== result.source.url)], false);
      setSourceUrl(''); setMessage(`Source details added from ${result.source.publisher}.`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'The source could not be inspected.'); }
    finally { setBusy(''); }
  };

  const fixSafe = async () => {
    setBusy('fix'); setError('');
    try {
      const previouslyFailed = new Set(readiness.filter((item) => !item.passed).map((item) => item.id));
      const result = await preflightAdminBlogDraft(draft, 'safe_fix', overrides);
      setAutoFixedIds((current) => [...new Set([...current, ...result.readiness.filter((item) => item.passed && previouslyFailed.has(item.id)).map((item) => item.id)])]);
      dirtyRef.current = true; suppressFinalSaveRef.current = false; setDraft(result.draft as Draft); setMessage('Safe metadata and link issues were fixed. Review the article before publishing.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Safe fixes could not be applied.'); }
    finally { setBusy(''); }
  };

  const suggestHeadings = async () => {
    setBusy('headings'); setError('');
    try {
      const result = await preflightAdminBlogDraft(draft, 'suggest_headings', overrides);
      setHeadingPreview(result.headingPreview || null);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Heading suggestions could not be created.'); }
    finally { setBusy(''); }
  };

  const persist = async (status: BlogPostStatus) => {
    if (['published', 'scheduled'].includes(status) && (!editorialReviewed || unresolved.length)) { setError('Finish the required checks and confirm the final editorial review before publishing.'); return; }
    flushScheduledSave();
    setBusy(status); setError('');
    try {
      const result = await saveAdminBlogPost({
        ...draft, status, publishedAt: status === 'published' ? post?.publishedAt || new Date().toISOString() : null,
        scheduledAt: status === 'scheduled' ? draft.publishedAt : null,
        ...(editorialReviewed ? { originalityStatus: 'passed', sourceStatus: 'passed', prerenderStatus: 'passed', imageStatus: draft.ogImageUrl ? draft.imageStatus || 'needs_review' : 'not_required' } : {}),
      }, post?.id, post?.updatedAt || null);
      suppressFinalSaveRef.current = true;
      dirtyRef.current = false;
      await deleteAdminBlogEditorDraft(clientDraftIdRef.current, post?.id || null).catch(() => undefined);
      localStorage.removeItem(localKey); setAutosave('saved'); onSaved(result.post);
      setMessage(status === 'published' ? 'Article published.' : status === 'scheduled' ? 'Article scheduled.' : 'Private draft saved.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'The article could not be saved.'); }
    finally { setBusy(''); }
  };

  const savePrivateDraft = async () => {
    if (post?.status !== 'published') { await persist('draft'); return; }
    flushScheduledSave();
    await saveBuffer();
    dirtyRef.current = false;
    setMessage('Private editor draft saved. The published article has not changed.');
  };

  const archive = async () => {
    if (!post || !window.confirm('Archive this article? It will disappear from the public blog.')) return;
    flushScheduledSave();
    setBusy('archive');
    try { await archiveAdminBlogPost(post.id); suppressFinalSaveRef.current = true; await deleteAdminBlogEditorDraft(clientDraftIdRef.current, post.id).catch(() => undefined); localStorage.removeItem(localKey); onArchived(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'The article could not be archived.'); }
    finally { setBusy(''); }
  };

  const importImage = async () => {
    setBusy('image'); setError('');
    try {
      const { image } = await importAdminBlogImage({ ...imageImport, articleId: post?.id || null });
      dirtyRef.current = true; suppressFinalSaveRef.current = false; setDraft((current) => ({ ...current, ogImageUrl: String(image.storage_url || image.source_url || ''), ogImageAlt: String(image.alt_text || imageImport.altText), ogImageAttribution: String(image.attribution || ''), imageVariants: Array.isArray(image.variants) ? image.variants : [], imageStatus: 'passed' }));
      setMessage('Image verified and added.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'The image could not be imported.'); }
    finally { setBusy(''); }
  };

  const steps: Array<[BlogEditorStep, string]> = [['write', 'Write'], ['review', 'Review'], ['publish', 'Publish']];
  return <div className="space-y-5">
    <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div><button type="button" onClick={() => void close()} className="mb-3 flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to Blog Studio</button><h3 className="text-xl font-semibold">{post ? `Edit ${post.title}` : 'New manual article'}</h3><p className="mt-1 text-sm text-muted-foreground">Start with the article. Crawlio handles the supporting search fields and autosaves your work.</p></div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className={`h-2 w-2 rounded-full ${autosave === 'failed' ? 'bg-red-500' : autosave === 'saving' ? 'bg-amber-500' : 'bg-emerald-500'}`} />{saveLabel(autosave)}</div>
    </div>
    <nav className="grid grid-cols-3 overflow-hidden rounded-lg border border-border bg-muted/30" aria-label="Article steps">{steps.map(([id, label], index) => <button key={id} type="button" onClick={() => void move(id)} aria-current={step === id ? 'step' : undefined} className={`flex min-h-12 items-center justify-center gap-2 border-r border-border px-3 text-sm font-semibold last:border-r-0 ${step === id ? 'bg-card text-accent' : 'text-muted-foreground hover:bg-card/70 hover:text-foreground'}`}><span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${step === id ? 'bg-accent text-white' : 'bg-muted text-muted-foreground'}`}>{index + 1}</span>{label}</button>)}</nav>
    {error && <Notice tone="danger" title="Blog action failed">{error}</Notice>}
    {message && <Notice tone="success">{message}</Notice>}
    {recovery && <Notice tone="warning" title="A newer editing draft is available"><div className="mt-2 flex flex-wrap gap-2"><button type="button" className="trust-button" onClick={() => { const payload = recovery as any; dirtyRef.current = true; suppressFinalSaveRef.current = false; setDraft({ ...fromPost(post), ...payload }); setStep(payload.editorStep || 'write'); setOverrides(Array.isArray(payload.automaticOverrides) ? payload.automaticOverrides : []); setRecovery(null); }}>Restore draft</button><button type="button" className="quiet-button" onClick={() => { setRecovery(null); void deleteAdminBlogEditorDraft(clientDraftIdRef.current, post?.id || null); localStorage.removeItem(localKey); }}>Discard recovery copy</button></div></Notice>}

    {step === 'write' && <Panel className="p-5 sm:p-6">
      <div className="grid gap-5"><FormField label="Article title" htmlFor="manual-blog-title"><input id="manual-blog-title" value={draft.title} onChange={(event) => update('title', event.target.value, false)} className="suite-input text-base font-semibold" maxLength={140} placeholder="What should readers learn?" /></FormField>
        <FormField label="Article content" hint={`${wordCount.toLocaleString()} words`}><RichTextEditor value={draft.contentHtml} onChange={(value) => update('contentHtml', value, false)} /></FormField>
      </div>
      <div className="mt-5 rounded-lg border border-border bg-muted/20 p-4"><p className="text-sm font-semibold">Optional research source</p><p className="mt-1 text-xs text-muted-foreground">Paste one public source and Crawlio will fill its title and publisher.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} className="suite-input flex-1" placeholder="https://example.com/research" /><button type="button" disabled={!sourceUrl.trim() || Boolean(busy)} onClick={() => void inspectSource()} className="quiet-button justify-center">{busy === 'source' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Add source</button></div></div>
      {post && <BlogSectionRevisionPanel post={post} onChanged={() => undefined} />}
      <div className="mt-6 flex justify-end"><button type="button" onClick={() => void move('review')} className="trust-button">Review article <ArrowRight className="h-4 w-4" /></button></div>
    </Panel>}

    {step === 'review' && <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Panel className="p-5 sm:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h4 className="font-semibold">Article preview</h4><p className="mt-1 text-sm text-muted-foreground">Review the content and generated search details before publishing.</p></div><button type="button" disabled={Boolean(busy)} onClick={() => void fixSafe()} className="trust-button">{busy === 'fix' ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />} Fix safe issues automatically</button></div><article className="prose prose-slate mt-6 max-w-none dark:prose-invert"><h1>{draft.title || 'Untitled article'}</h1><div dangerouslySetInnerHTML={{ __html: previewHtml }} /></article></Panel>
        {headingPreview && <Notice tone="info" title="Heading structure preview"><p>The suggested headings organize existing content without replacing factual paragraphs.</p><ul className="mt-2 list-disc pl-5 text-sm">{headingPreview.headings.map((heading) => <li key={heading}>{heading}</li>)}</ul><div className="mt-3 flex gap-2"><button type="button" className="trust-button" onClick={() => { setHeadingUndo(headingPreview.previousContentHtml); update('contentHtml', headingPreview.contentHtml, false); setHeadingPreview(null); }}>Apply headings</button><button type="button" className="quiet-button" onClick={() => setHeadingPreview(null)}>Cancel</button></div></Notice>}
        {headingUndo && <button type="button" className="quiet-button" onClick={() => { update('contentHtml', headingUndo, false); setHeadingUndo(null); }}><RotateCcw className="h-4 w-4" /> Undo heading change</button>}
        <details className="rounded-lg border border-border bg-card"><summary className="cursor-pointer px-5 py-4 text-sm font-semibold">Advanced options <span className="ml-2 font-normal text-muted-foreground">Search fields, sources, image, canonical URL, and article settings</span></summary><div className="border-t border-border p-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <AutoField label="URL slug" field="slug" overridden={overrides.includes('slug')} onReset={resetAuto}><input value={draft.slug} onChange={(event) => update('slug', createBlogSlug(event.target.value))} className="suite-input" /></AutoField>
            <AutoField label="Focus phrase" field="focusKeyword" overridden={overrides.includes('focusKeyword')} onReset={resetAuto}><input value={draft.focusKeyword} onChange={(event) => update('focusKeyword', event.target.value)} className="suite-input" /></AutoField>
            <AutoField label="Excerpt" field="excerpt" overridden={overrides.includes('excerpt')} onReset={resetAuto}><textarea value={draft.excerpt} onChange={(event) => update('excerpt', event.target.value)} className="suite-input min-h-24 resize-y" /></AutoField>
            <AutoField label="Article tagline" field="tagline" overridden={overrides.includes('tagline')} onReset={resetAuto}><input value={draft.tagline} onChange={(event) => update('tagline', event.target.value)} className="suite-input" /></AutoField>
            <AutoField label="Summary" field="summary" overridden={overrides.includes('summary')} onReset={resetAuto}><textarea value={draft.summary} onChange={(event) => update('summary', event.target.value)} className="suite-input min-h-24 resize-y" /></AutoField>
            <AutoField label="Tags" field="tags" overridden={overrides.includes('tags')} onReset={resetAuto}><input value={draft.tags.join(', ')} onChange={(event) => update('tags', event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean))} className="suite-input" /></AutoField>
            <AutoField label="Topic hub" field="topicCluster" overridden={overrides.includes('topicCluster')} onReset={resetAuto}><input value={draft.topicCluster || ''} onChange={(event) => update('topicCluster', event.target.value)} className="suite-input" /></AutoField>
            <FormField label="Article format"><select value={draft.articleType || 'evergreen_guide'} onChange={(event) => update('articleType', event.target.value, false)} className="suite-input"><option value="evergreen_guide">Evergreen guide</option><option value="technical_guide">Technical guide</option><option value="troubleshooting_guide">Troubleshooting guide</option><option value="checklist">Checklist</option><option value="glossary">Glossary or explainer</option><option value="comparison">Comparison</option><option value="news_analysis">News analysis</option><option value="urgent_news">Urgent update</option></select></FormField>
            <AutoField label="SEO title" field="seoTitle" overridden={overrides.includes('seoTitle')} onReset={resetAuto}><input value={draft.seoTitle} onChange={(event) => update('seoTitle', event.target.value)} className="suite-input" maxLength={70} /></AutoField>
            <AutoField label="Meta description" field="metaDescription" overridden={overrides.includes('metaDescription')} onReset={resetAuto}><textarea value={draft.metaDescription} onChange={(event) => update('metaDescription', event.target.value)} className="suite-input min-h-24 resize-y" maxLength={180} /></AutoField>
            <FormField label="Canonical URL override" hint="Leave empty to use the article URL."><input type="url" value={draft.canonicalUrl} onChange={(event) => update('canonicalUrl', event.target.value, false)} className="suite-input" /></FormField>
          </div>
          <div className="mt-5 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-3"><div><h5 className="text-sm font-semibold">Research sources</h5><p className="mt-1 text-xs text-muted-foreground">Source details are filled automatically when possible, but remain editable.</p></div><button type="button" className="quiet-button" onClick={() => update('sources', [...(draft.sources || []), { url: '', title: '', publisher: '', citationStatus: 'needs_review', reliability: 'unverified' }], false)}><Plus className="h-4 w-4" /> Add record</button></div>
            {(draft.sources || []).map((source, index) => <div key={`${source.url}-${index}`} className="mt-4 rounded-lg border border-border bg-muted/20 p-4"><div className="grid gap-3 lg:grid-cols-3"><input type="url" value={source.url} onChange={(event) => updateSource(index, { url: event.target.value })} className="suite-input" placeholder="Source URL" /><input value={source.title} onChange={(event) => updateSource(index, { title: event.target.value })} className="suite-input" placeholder="Source title" /><input value={source.publisher} onChange={(event) => updateSource(index, { publisher: event.target.value })} className="suite-input" placeholder="Publisher" /></div><button type="button" onClick={() => removeSource(index)} className="mt-3 flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-300"><Trash2 className="h-3.5 w-3.5" /> Remove source</button></div>)}
            {!(draft.sources || []).length && <p className="mt-3 text-sm text-muted-foreground">No source has been added.</p>}
          </div>
          <div className="mt-5 rounded-lg border border-border p-4"><h5 className="text-sm font-semibold">Optional verified image</h5><div className="mt-4 grid gap-4 lg:grid-cols-2"><input type="url" value={imageImport.sourceUrl} onChange={(event) => setImageImport((value) => ({ ...value, sourceUrl: event.target.value }))} className="suite-input" placeholder="Public image URL" /><input value={imageImport.altText} onChange={(event) => setImageImport((value) => ({ ...value, altText: event.target.value }))} className="suite-input" placeholder="Descriptive alt text" /><input value={imageImport.creator} onChange={(event) => setImageImport((value) => ({ ...value, creator: event.target.value }))} className="suite-input" placeholder="Creator (optional)" /><input value={imageImport.publisher} onChange={(event) => setImageImport((value) => ({ ...value, publisher: event.target.value }))} className="suite-input" placeholder="Publisher" /><input value={imageImport.licence} onChange={(event) => setImageImport((value) => ({ ...value, licence: event.target.value }))} className="suite-input" placeholder="Licence" /></div><button type="button" disabled={Boolean(busy) || !imageImport.sourceUrl || imageImport.altText.length < 8 || !imageImport.publisher || !imageImport.licence} onClick={() => void importImage()} className="quiet-button mt-3">{busy === 'image' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Verify and import</button></div>
        </div></details>
        <div className="flex justify-between"><button type="button" onClick={() => void move('write')} className="quiet-button"><ArrowLeft className="h-4 w-4" /> Write</button><button type="button" onClick={() => void move('publish')} className="trust-button">Continue to publish <ArrowRight className="h-4 w-4" /></button></div>
      </div>
      <BlogEditorialReviewPanel post={post} draft={draft} />
    </div>}

    {step === 'publish' && <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Panel className="p-5 sm:p-6"><h4 className="font-semibold">Final publication check</h4><p className="mt-1 text-sm text-muted-foreground">Only unresolved requirements are shown first. Passing technical details stay out of the way.</p>
        <h5 className="mt-5 text-sm font-semibold">Needs your attention</h5><div className="mt-2 space-y-2">{unresolved.length ? unresolved.map((item) => <div key={item.id} className="flex flex-col gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><div><p className="text-sm font-semibold">{item.label}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.explanation}</p></div></div>{item.fixAction === 'suggest_headings' ? <button type="button" disabled={Boolean(busy)} onClick={() => { void suggestHeadings(); setStep('review'); }} className="quiet-button shrink-0">Fix this</button> : item.fixableAutomatically ? <button type="button" disabled={Boolean(busy)} onClick={() => void fixSafe()} className="quiet-button shrink-0">Fix this</button> : null}</div>) : <div className="flex items-center gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4 text-sm text-emerald-800 dark:text-emerald-200"><CheckCircle2 className="h-5 w-5" /> Every required publication check is ready.</div>}</div>
        {autoFixedIds.length > 0 && <div className="mt-5"><h5 className="text-sm font-semibold">Fixed automatically</h5><div className="mt-2 grid gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 sm:grid-cols-2">{readiness.filter((item) => autoFixedIds.includes(item.id)).map((item) => <div key={item.id} className="flex gap-2 text-xs text-muted-foreground"><WandSparkles className="h-4 w-4 shrink-0 text-accent" /><span>{item.label}</span></div>)}</div></div>}
        <details className="mt-5 rounded-lg border border-border"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Ready checks and recommendations</summary><div className="grid gap-2 border-t border-border p-4 sm:grid-cols-2">{readiness.filter((item) => (item.passed && !autoFixedIds.includes(item.id)) || item.severity === 'warning').map((item) => <div key={item.id} className="flex gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /><span>{item.label}</span></div>)}</div></details>
        <details className="mt-4 rounded-lg border border-border"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Final article preview</summary><article className="prose prose-slate max-w-none border-t border-border p-5 dark:prose-invert"><h1>{draft.title || 'Untitled article'}</h1><div dangerouslySetInnerHTML={{ __html: previewHtml }} /></article></details>
        <label className="mt-5 flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-4 text-sm"><input type="checkbox" checked={editorialReviewed} onChange={(event) => setEditorialReviewed(event.target.checked)} className="mt-1 h-4 w-4" /><span><strong>Final editorial review complete.</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">I checked the facts, claims, links, originality, and source attribution.</span></span></label>
        <div className="mt-5 grid gap-4 sm:grid-cols-2"><FormField label="Public URL"><div className="suite-input text-muted-foreground">/blog/{draft.slug || 'article-slug'}</div></FormField><FormField label="Schedule for later" hint="Leave empty to publish now."><input type="datetime-local" value={draft.publishedAt} onChange={(event) => update('publishedAt', event.target.value, false)} className="suite-input" /></FormField></div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={() => void move('review')} className="quiet-button"><ArrowLeft className="h-4 w-4" /> Review</button><div className="flex flex-wrap gap-2">{post && <button type="button" onClick={() => void archive()} disabled={Boolean(busy)} className="quiet-button text-red-600"><Archive className="h-4 w-4" /> Archive</button>}<button type="button" onClick={() => void savePrivateDraft()} disabled={Boolean(busy)} className="quiet-button"><Save className="h-4 w-4" /> Save private draft</button><button type="button" onClick={() => void persist('scheduled')} disabled={Boolean(busy) || !draft.publishedAt || !editorialReviewed || unresolved.length > 0} className="quiet-button"><CalendarDays className="h-4 w-4" /> Schedule</button><button type="button" onClick={() => void persist('published')} disabled={Boolean(busy) || !editorialReviewed || unresolved.length > 0} className="trust-button">{busy === 'published' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe2 className="h-4 w-4" />} {post?.status === 'published' ? 'Republish' : 'Publish now'}</button></div></div>
      </Panel>
      <Panel className="p-5"><h4 className="flex items-center gap-2 font-semibold"><FileCheck2 className="h-4 w-4 text-accent" /> Public result</h4><div className="mt-4 rounded-lg bg-white p-4 text-slate-900"><p className="text-sm text-emerald-700">{window.location.hostname} / blog / {draft.slug || 'article-slug'}</p><p className="mt-1 text-lg text-[#1a0dab]">{draft.seoTitle || draft.title || 'Article title'}</p><p className="mt-1 text-sm leading-6 text-slate-700">{draft.metaDescription || draft.excerpt || 'Article description'}</p></div><div className="mt-5"><p className="text-sm font-semibold">Sources</p>{(draft.sources || []).map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs text-accent">{source.title}</a>)}{!(draft.sources || []).length && <p className="mt-2 text-xs text-muted-foreground">No verified source yet.</p>}</div><p className="mt-5 text-xs leading-5 text-muted-foreground">Published articles use <code>index,follow,max-image-preview:large</code>. Private drafts remain excluded from search engines.</p></Panel>
    </div>}
  </div>;
}
