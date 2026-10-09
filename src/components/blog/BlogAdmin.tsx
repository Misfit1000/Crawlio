import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Bot, FilePlus2, Files, LayoutDashboard, Loader2, RefreshCw, Search, Settings2 } from 'lucide-react';
import { getAdminBlogPosts } from '../../lib/blog/client';
import type { BlogPost, BlogPostStatus } from '../../lib/blog/types';
import { Notice } from '../ui/page-system';
import { EmptyState, StatusBadge } from '../ui/visual-system';
import BlogStudioStart from './BlogStudioStart';
import { useLocation, useNavigate } from '../../app/router';

const BlogAutomationPanel = lazy(() => import('./BlogAutomationPanel'));
const BlogManualEditor = lazy(() => import('./BlogManualEditor'));
const BlogProviderFreeWorkspace = lazy(() => import('./BlogProviderFreeWorkspace'));

type WorkspaceTab = 'start' | 'articles' | 'automation' | 'operations';

const TABS: Array<{ id: WorkspaceTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'start', label: 'Create', icon: LayoutDashboard },
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
  const location = useLocation();
  const navigate = useNavigate();
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
    const params = new URLSearchParams(location.search);
    const articleId = params.get('articleId');
    const jobId = params.get('jobId');
    if (articleId && posts.some((post) => post.id === articleId)) {
      setSelectedId(articleId);
      setEditorOpen(true);
      setActiveTab('articles');
    } else if (jobId) {
      setActiveTab('automation');
    }
  }, [posts, location.search]);

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
    navigate(`/admin/blog?articleId=${encodeURIComponent(post.id)}`);
    setSelectedId(post.id);
    setEditorOpen(true);
    setActiveTab('articles');
  };

  const startManual = () => {
    navigate('/admin/blog', { replace: true });
    setSelectedId(null);
    setEditorOpen(true);
    setActiveTab('articles');
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setSelectedId(null);
    navigate('/admin/blog', { replace: true });
  };

  return <section className="min-w-0 space-y-5" aria-label="Blog studio">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <nav className="flex min-w-0 flex-wrap gap-1" aria-label="Blog administration">
        {TABS.map((tab) => { const Icon = tab.icon; return <button key={tab.id} type="button" onClick={() => { setActiveTab(tab.id); if (tab.id !== 'articles') setEditorOpen(false); }} className={`flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold ${activeTab === tab.id ? 'bg-accent/10 text-accent' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} aria-current={activeTab === tab.id ? 'page' : undefined}><Icon className="h-4 w-4" aria-hidden="true" /> {tab.label}</button>; })}
      </nav>
      {activeTab === 'articles' && !editorOpen && <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="quiet-button" aria-label="Refresh articles" title="Refresh articles" onClick={() => void loadPosts()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
        <button type="button" className="trust-button" onClick={startManual}><FilePlus2 className="h-4 w-4" /> Write article</button>
      </div>}
    </div>

    {error && <Notice tone="danger" title="Blog studio could not load">{error}</Notice>}

    {activeTab === 'start' && <BlogStudioStart posts={posts} onManual={startManual} onOpenArticle={openArticle} onOpenAutomation={() => setActiveTab('automation')} />}

    <Suspense fallback={<div role="status" className="flex min-h-56 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading workspace...</div>}>
    {activeTab === 'articles' && (editorOpen ? <BlogManualEditor
      key={selectedPost?.id || 'new-article'}
      post={selectedPost}
      onClose={closeEditor}
      onSaved={(saved) => { setSelectedId(saved.id); void loadPosts(); }}
      onArchived={() => { closeEditor(); void loadPosts(); }}
    /> : <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative flex-1"><span className="sr-only">Search articles</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="suite-input pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by title, URL, or focus phrase" /></label>
          <select className="suite-input md:w-48" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | BlogPostStatus)} aria-label="Filter articles by status">
            <option value="all">All statuses</option><option value="draft">Draft</option><option value="needs_review">Needs attention</option><option value="review">In review</option><option value="scheduled">Scheduled</option><option value="published">Published</option><option value="failed">Failed</option><option value="archived">Archived</option>
          </select>
        </div>
      {loading ? <div role="status" aria-label="Loading articles" className="flex min-h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div> : filteredPosts.length ? <div className="divide-y divide-border border-y border-border">
        {filteredPosts.map((post) => <button key={post.id} type="button" onClick={() => openArticle(post)} className="group flex w-full min-w-0 flex-col gap-3 py-4 text-left hover:bg-muted/30 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1"><h2 className="break-words text-base font-semibold group-hover:text-accent">{post.title || 'Untitled article'}</h2><p className="mt-1 break-all text-xs text-muted-foreground">/blog/{post.slug || 'draft'}</p><p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{post.excerpt || 'No summary yet.'}</p><p className="mt-2 text-xs text-muted-foreground">{post.origin === 'admin_manual' ? 'Manual' : 'AI-assisted'} / Updated {dateLabel(post.updatedAt)}</p></div>
          <StatusBadge tone={statusTone(post.status)}>{post.status.replaceAll('_', ' ')}</StatusBadge>
        </button>)}
      </div> : <EmptyState icon={Files} title="No articles found" description="Change the filters or start a new article." action={<button type="button" className="trust-button" onClick={startManual}><FilePlus2 className="h-4 w-4" /> Write article</button>} />}
    </div>)}

    {activeTab === 'automation' && <BlogAutomationPanel posts={posts} onChanged={() => void loadPosts()} />}
    {activeTab === 'operations' && <BlogProviderFreeWorkspace />}
    </Suspense>
  </section>;
}
