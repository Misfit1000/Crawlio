import { ArrowRight, Bot, CalendarClock, CircleAlert, FilePlus2, Files, Globe2, Settings2 } from 'lucide-react';
import type { BlogPost } from '../../lib/blog/types';
import { EmptyState, StatusBadge } from '../ui/visual-system';
import { Panel } from '../ui/page-system';

interface BlogAdminOverviewProps {
  posts: BlogPost[];
  loading: boolean;
  onNew: () => void;
  onOpenArticles: () => void;
  onOpenAutomation: () => void;
  onOpenOperations: () => void;
  onSelectPost: (post: BlogPost) => void;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value));
}

export default function BlogAdminOverview({
  posts,
  loading,
  onNew,
  onOpenArticles,
  onOpenAutomation,
  onOpenOperations,
  onSelectPost,
}: BlogAdminOverviewProps) {
  const needsReview = posts.filter((post) => post.status === 'review' || post.status === 'needs_review');
  const scheduled = posts.filter((post) => post.status === 'scheduled');
  const drafts = posts.filter((post) => post.status === 'draft');
  const published = posts.filter((post) => post.status === 'published');
  const priorityPosts = [...needsReview, ...scheduled, ...drafts]
    .filter((post, index, items) => items.findIndex((item) => item.id === post.id) === index)
    .slice(0, 6);
  const metrics = [
    { label: 'Needs review', value: needsReview.length, icon: CircleAlert, tone: 'text-amber-600' },
    { label: 'Scheduled', value: scheduled.length, icon: CalendarClock, tone: 'text-blue-600' },
    { label: 'Drafts', value: drafts.length, icon: Files, tone: 'text-slate-600 dark:text-slate-300' },
    { label: 'Published', value: published.length, icon: Globe2, tone: 'text-emerald-600' },
  ];

  return (
    <div className="space-y-5">
      <section aria-labelledby="editorial-summary-title">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h3 id="editorial-summary-title" className="text-lg font-semibold">Editorial summary</h3>
            <p className="mt-1 text-sm text-muted-foreground">The work that needs attention now.</p>
          </div>
          <button type="button" className="quiet-button" onClick={onOpenArticles}>View all articles <ArrowRight className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <button key={metric.label} type="button" onClick={onOpenArticles} className="flex min-h-24 items-center gap-4 bg-card p-4 text-left transition-colors hover:bg-muted/40">
              <metric.icon className={`h-5 w-5 shrink-0 ${metric.tone}`} />
              <span>
                <strong className="block text-2xl font-semibold tabular-nums text-foreground">{metric.value}</strong>
                <span className="text-sm text-muted-foreground">{metric.label}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel className="overflow-hidden p-0">
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h3 className="font-semibold">Next editorial tasks</h3>
              <p className="mt-1 text-xs text-muted-foreground">Reviews first, then scheduled work and drafts.</p>
            </div>
            <button type="button" className="trust-button" onClick={onNew}><FilePlus2 className="h-4 w-4" /> New article</button>
          </div>
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading editorial work...</div>
          ) : priorityPosts.length ? (
            <div className="divide-y divide-border">
              {priorityPosts.map((post) => (
                <button key={post.id} type="button" onClick={() => onSelectPost(post)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/35">
                  <span className="min-w-0">
                    <span className="line-clamp-1 text-sm font-semibold text-foreground">{post.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">Updated {dateLabel(post.updatedAt)}</span>
                  </span>
                  <StatusBadge tone={post.status === 'scheduled' ? 'accent' : post.status === 'draft' ? 'warning' : 'danger'}>{post.status.replace('_', ' ')}</StatusBadge>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-5"><EmptyState icon={Files} title="Editorial queue is clear" description="Create an article or review the published library." /></div>
          )}
        </Panel>

        <Panel className="p-5">
          <h3 className="font-semibold">Quick actions</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Open only the workspace needed for the current task.</p>
          <div className="mt-4 divide-y divide-border border-y border-border">
            <button type="button" onClick={onOpenAutomation} className="flex w-full items-center gap-3 py-4 text-left">
              <Bot className="h-5 w-5 text-accent" />
              <span className="min-w-0 flex-1"><strong className="block text-sm">Generate a Groq draft</strong><span className="text-xs text-muted-foreground">Research, draft, validate, then review.</span></span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </button>
            <button type="button" onClick={onOpenArticles} className="flex w-full items-center gap-3 py-4 text-left">
              <Files className="h-5 w-5 text-accent" />
              <span className="min-w-0 flex-1"><strong className="block text-sm">Manage articles</strong><span className="text-xs text-muted-foreground">Write, edit, schedule, and publish.</span></span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </button>
            <button type="button" onClick={onOpenOperations} className="flex w-full items-center gap-3 py-4 text-left">
              <Settings2 className="h-5 w-5 text-accent" />
              <span className="min-w-0 flex-1"><strong className="block text-sm">Sources and system</strong><span className="text-xs text-muted-foreground">Feeds, calendar, jobs, and diagnostics.</span></span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
