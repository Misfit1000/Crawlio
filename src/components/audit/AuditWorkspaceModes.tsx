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

export function AuditWorkspaceModes({ mode, pathFor }: Pick<ReturnType<typeof useAuditWorkspaceMode>, 'mode' | 'pathFor'>) {
  return <nav className="audit-mode-navigation" aria-label="Audit workspace views">
    {modes.map(({ id, label, icon: Icon }) => <Link key={id} to={pathFor(id)} aria-current={mode === id ? 'page' : undefined} className={`flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold ${mode === id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}><Icon className="h-4 w-4 shrink-0" /><span>{label}</span></Link>)}
  </nav>;
}
