import { useEffect, useMemo, useState } from 'react';
import { Bot, FilePlus2, Files, LayoutDashboard, Loader2, RefreshCw, Search, Settings2 } from 'lucide-react';
import { getAdminBlogPosts } from '../../lib/blog/client';
import type { BlogPost, BlogPostStatus } from '../../lib/blog/types';
import { Notice, Panel } from '../ui/page-system';
import { EmptyState, StatusBadge } from '../ui/visual-system';
import BlogAutomationPanel from './BlogAutomationPanel';
import BlogManualEditor from './BlogManualEditor';
import BlogProviderFreeWorkspace from './BlogProviderFreeWorkspace';
import BlogStudioStart from './BlogStudioStart';

type WorkspaceTab = 'start' | 'articles' | 'automation' | 'operations';

const TABS: Array<{ id: WorkspaceTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'start', label: 'Blog studio', icon: LayoutDashboard },
  { id: 'articles', label: 'Articles', icon: Files },
  { id: 'automation', label: 'Advanced AI', icon: Bot },
  { id: 'operations', label: 'Sources and system', icon: Settings2 },
];

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function statusTone(status: BlogPostStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'published') return 'success';
  if (status === 'failed' || status === 'archived') return 'danger';
  if (status === 'draft') return 'neutral';
  return 'warning';
}

export default function BlogAdmin() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('start');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | BlogPostStatus>('all');

  const loadPosts = async () => {
    setLoading(true);
    try {
      const result = await getAdminBlogPosts();
      setPosts(result.posts);
      setError('');
      return result.posts;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Blog articles could not be loaded.');
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadPosts(); }, []);

  useEffect(() => {
    if (!posts.length) return;
    const params = new URLSearchParams(window.location.search);
    const articleId = params.get('articleId');
    const jobId = params.get('jobId');
    if (articleId && posts.some((post) => post.id === articleId)) {
      setSelectedId(articleId);
      setEditorOpen(true);
      setActiveTab('articles');
    } else if (jobId) {
      setActiveTab('automation');
    }
  }, [posts]);

  const selectedPost = posts.find((post) => post.id === selectedId);
  const filteredPosts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return posts.filter((post) => {
      const statusMatches = statusFilter === 'all' || post.status === statusFilter;
      const textMatches = !needle || `${post.title} ${post.slug} ${post.focusKeyword}`.toLowerCase().includes(needle);
      return statusMatches && textMatches;
    });
  }, [posts, search, statusFilter]);

  const openArticle = (post: BlogPost) => {
    setSelectedId(post.id);
    setEditorOpen(true);
    setActiveTab('articles');
  };

  const startManual = () => {
    setSelectedId(null);
    setEditorOpen(true);
    setActiveTab('articles');
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setSelectedId(null);
    window.history.replaceState({}, '', '/admin/blog');
  };

  return <section className="space-y-6" aria-labelledby="blog-studio-title">
    <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Content operations</p>
        <h1 id="blog-studio-title" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Blog studio</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Publish a guarded AI article in one click, create from a trusted source, or write manually with automatic search fields.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="quiet-button" onClick={() => void loadPosts()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        <button type="button" className="trust-button" onClick={startManual}><FilePlus2 className="h-4 w-4" /> Write article</button>
      </div>
    </div>

    <nav className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1" aria-label="Blog administration">
      {TABS.map((tab) => { const Icon = tab.icon; return <button key={tab.id} type="button" onClick={() => { setActiveTab(tab.id); if (tab.id !== 'articles') setEditorOpen(false); }} className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${activeTab === tab.id ? 'bg-accent text-white shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} aria-current={activeTab === tab.id ? 'page' : undefined}><Icon className="h-4 w-4" /> {tab.label}</button>; })}
    </nav>

    {error && <Notice tone="danger" title="Blog studio could not load">{error}</Notice>}

    {activeTab === 'start' && <BlogStudioStart posts={posts} onManual={startManual} onOpenArticle={openArticle} onOpenAutomation={() => setActiveTab('automation')} />}

    {activeTab === 'articles' && (editorOpen ? <BlogManualEditor
      key={selectedPost?.id || 'new-article'}
      post={selectedPost}
      onClose={closeEditor}
      onSaved={(saved) => { setSelectedId(saved.id); void loadPosts(); }}
      onArchived={() => { closeEditor(); void loadPosts(); }}
    /> : <div className="space-y-4">
      <Panel className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative flex-1"><span className="sr-only">Search articles</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="suite-input pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by title, URL, or focus phrase" /></label>
          <select className="suite-input md:w-48" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | BlogPostStatus)} aria-label="Filter articles by status">
            <option value="all">All statuses</option><option value="draft">Draft</option><option value="needs_review">Needs attention</option><option value="review">In review</option><option value="scheduled">Scheduled</option><option value="published">Published</option><option value="failed">Failed</option><option value="archived">Archived</option>
          </select>
        </div>
      </Panel>
      {loading ? <div className="flex min-h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div> : filteredPosts.length ? <div className="grid gap-3 lg:grid-cols-2">
        {filteredPosts.map((post) => <button key={post.id} type="button" onClick={() => openArticle(post)} className="group rounded-lg border border-border bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate font-semibold group-hover:text-accent">{post.title || 'Untitled article'}</h2><p className="mt-1 truncate text-xs text-muted-foreground">/blog/{post.slug || 'draft'}</p></div><StatusBadge tone={statusTone(post.status)}>{post.status.replaceAll('_', ' ')}</StatusBadge></div>
          <p className="mt-4 line-clamp-2 text-sm leading-6 text-muted-foreground">{post.excerpt || 'Continue writing to generate a summary and search preview.'}</p>
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground"><span>{post.origin === 'admin_manual' ? 'Manual article' : 'AI-assisted article'}</span><span>Updated {dateLabel(post.updatedAt)}</span></div>
        </button>)}
      </div> : <EmptyState icon={Files} title="No articles found" description="Change the filters or start a new article." action={<button type="button" className="trust-button" onClick={startManual}><FilePlus2 className="h-4 w-4" /> Write article</button>} />}
    </div>)}

    {activeTab === 'automation' && <BlogAutomationPanel posts={posts} onChanged={() => void loadPosts()} />}
    {activeTab === 'operations' && <BlogProviderFreeWorkspace />}
  </section>;
}
