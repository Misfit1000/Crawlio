import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, RefreshCw, RotateCcw, X } from 'lucide-react';
import { decideBlogSectionRevision, getBlogSectionRevisions, queueBlogSectionRegeneration } from '../../lib/blog/client';
import type { BlogPost, BlogSectionRevision } from '../../lib/blog/types';
import { Notice } from '../ui/page-system';
import { StatusBadge } from '../ui/visual-system';

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function BlogSectionRevisionPanel({ post, onChanged }: { post: BlogPost; onChanged: () => void }) {
  const [sectionKey, setSectionKey] = useState('introduction');
  const [action, setAction] = useState('improve_clarity');
  const [revisions, setRevisions] = useState<BlogSectionRevision[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const headings = useMemo(() => [...post.contentHtml.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((match, index) => ({ key: `heading:${index}`, label: `${match[1]?.toUpperCase()}: ${stripHtml(match[2] || '')}` })), [post.contentHtml]);
  const load = async () => {
    try { setRevisions((await getBlogSectionRevisions(post.id)).revisions); setError(''); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Section revisions could not be loaded.'); }
  };
  useEffect(() => { void load(); }, [post.id]);
  const queue = async () => {
    setBusy('queue'); setError(''); setMessage('');
    try { await queueBlogSectionRegeneration(post.id, sectionKey, action); setMessage('Section revision queued. The published article will not change until you accept the resulting revision.'); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Section regeneration could not be queued.'); }
    finally { setBusy(''); }
  };
  const decide = async (revision: BlogSectionRevision, decision: 'accepted' | 'rejected') => {
    setBusy(revision.id); setError('');
    try { await decideBlogSectionRevision(revision.id, decision); await load(); onChanged(); setMessage(decision === 'accepted' ? 'The selected section revision was accepted.' : 'The revision was rejected; article content was preserved.'); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'The revision decision could not be saved.'); }
    finally { setBusy(''); }
  };
  return <section className="mt-5 rounded-lg border border-border p-4" aria-labelledby="section-revision-title">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h4 id="section-revision-title" className="font-semibold text-foreground">Selected-section regeneration</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">Only the selected field or heading block is drafted again. Existing citations are retained and the result remains pending until accepted.</p></div><button type="button" onClick={() => void load()} className="quiet-button"><RefreshCw className="h-4 w-4" /> Refresh</button></div>
    {error && <div className="mt-3"><Notice tone="danger">{error}</Notice></div>}{message && <p className="mt-3 text-sm text-emerald-700" role="status">{message}</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><label className="text-sm"><span className="mb-1 block font-medium">Section</span><select value={sectionKey} onChange={(event) => setSectionKey(event.target.value)} className="suite-input"><option value="introduction">Introduction</option><option value="conclusion">Conclusion</option><option value="tagline">Tagline</option><option value="summary">Summary</option><option value="meta_description">Meta description</option>{headings.map((heading) => <option key={heading.key} value={heading.key}>{heading.label}</option>)}</select></label><label className="text-sm"><span className="mb-1 block font-medium">Action</span><select value={action} onChange={(event) => setAction(event.target.value)} className="suite-input"><option value="regenerate">Regenerate section</option><option value="shorten">Shorten section</option><option value="make_practical">Make more practical</option><option value="add_example">Add an example</option><option value="improve_clarity">Improve clarity</option><option value="remove_repetition">Remove repetition</option><option value="rewrite_from_sources">Rewrite from sources</option></select></label><button type="button" disabled={Boolean(busy)} onClick={() => void queue()} className="trust-button self-end">{busy === 'queue' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Queue revision</button></div>
    <div className="mt-4 space-y-3">{revisions.map((revision) => <article key={revision.id} className="rounded-lg border border-border bg-muted/20 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-foreground">{revision.sectionKey.replaceAll('_', ' ')}</p><p className="text-xs text-muted-foreground">{revision.action.replaceAll('_', ' ')} · {new Date(revision.createdAt).toLocaleString()}</p></div><StatusBadge tone={revision.status === 'accepted' ? 'success' : revision.status === 'rejected' ? 'danger' : 'warning'}>{revision.status}</StatusBadge></div><div className="mt-3 grid gap-3 lg:grid-cols-2"><div><p className="text-xs font-semibold text-muted-foreground">Before</p><div className="mt-1 max-h-44 overflow-auto rounded-lg bg-background p-3 text-xs leading-5 text-foreground">{stripHtml(revision.beforeHtml)}</div></div><div><p className="text-xs font-semibold text-muted-foreground">After</p><div className="mt-1 max-h-44 overflow-auto rounded-lg bg-background p-3 text-xs leading-5 text-foreground">{stripHtml(revision.afterHtml)}</div></div></div>{revision.status === 'pending' && <div className="mt-3 flex gap-2"><button type="button" onClick={() => void decide(revision, 'accepted')} disabled={Boolean(busy)} className="trust-button"><Check className="h-4 w-4" /> Accept</button><button type="button" onClick={() => void decide(revision, 'rejected')} disabled={Boolean(busy)} className="quiet-button"><X className="h-4 w-4" /> Reject</button></div>}</article>)}{!revisions.length && <p className="text-sm text-muted-foreground">No section revisions yet.</p>}</div>
  </section>;
}
