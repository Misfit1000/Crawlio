import { Activity, FileSearch, Globe2, LayoutDashboard } from 'lucide-react';
import './audit-report.css';
import { useCallback } from 'react';
import { Link, useLocation, useNavigate } from '../../app/router';

export type AuditWorkspaceMode = 'overview' | 'findings' | 'pages' | 'activity';

const modes = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'findings', label: 'Findings', icon: FileSearch },
  { id: 'pages', label: 'Pages', icon: Globe2 },
  { id: 'activity', label: 'Activity', icon: Activity },
] as const;

export function useAuditWorkspaceMode(defaultMode: AuditWorkspaceMode = 'overview') {
  const location = useLocation();
  const navigate = useNavigate();
  const requested = new URLSearchParams(location.search).get('view');
  const mode = modes.some(item => item.id === requested) ? requested as AuditWorkspaceMode : defaultMode;
  const pathFor = useCallback((next: AuditWorkspaceMode) => {
    const query = new URLSearchParams(window.location.search);
    query.set('view', next);
    return `${location.pathname}?${query}`;
  }, [location.pathname]);
  const setMode = useCallback((next: AuditWorkspaceMode) => navigate(pathFor(next)), [navigate, pathFor]);
  return { mode, pathFor, setMode };
}

export function AuditWorkspaceModes({ mode, pathFor, categories = [], selectedCategory = '' }: Pick<ReturnType<typeof useAuditWorkspaceMode>, 'mode' | 'pathFor'> & { categories?: Array<{ label: string; path: string }>; selectedCategory?: string }) {
  return <nav className="audit-mode-navigation border-b border-border" aria-label="Audit workspace views">
    <div className="audit-view-tabs flex flex-wrap gap-6">{modes.map(({ id, label, icon: Icon }) => <Link key={id} to={pathFor(id)} aria-current={mode === id ? 'page' : undefined} className="inline-flex min-h-11 items-center gap-2 border-b-2 border-transparent py-3 text-sm font-semibold text-muted-foreground"><Icon className="h-4 w-4 shrink-0" /><span>{label}</span></Link>)}</div>
    {mode === 'findings' && categories.length > 0 && <div className="audit-category-tabs flex flex-wrap gap-2 py-4" aria-label="Report categories">{categories.map(item => <Link key={item.path} to={item.path} aria-current={(selectedCategory || categories[0].path) === item.path ? 'page' : undefined} className="inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm text-muted-foreground">{item.label}</Link>)}</div>}
  </nav>;
}
