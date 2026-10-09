import type { ReactNode } from 'react';
import { ChevronRight, LogOut, Menu, User } from 'lucide-react';
import { BrandMark, ThemeToggle } from '../ui/chrome';
import { BRAND } from '../../lib/brand';
import { Link, useLocation } from '../../app/router';
import { auditWorkspacePath, parseAuditWorkspacePath, TAB_PATHS, tabForPath } from '../../app/routes';
import { adminGroupForPath, adminSectionForPath, clientGroupForTab, clientNavigationPath, isCurrentNavigationPath } from '../navigation/product-navigation';
import './workspace.css';

type Theme = 'light' | 'dark';

const workspaceLabels: Record<string, string> = {
  '/app': 'Dashboard',
  '/app/projects': 'Projects',
  '/app/audits/new': 'Start audit',
  '/app/audits/history': 'Audit history',
  '/app/reports': 'Reports',
  '/app/reports/seo': 'SEO findings',
  '/app/reports/technical': 'Technical SEO',
  '/app/reports/crawlability': 'Crawlability',
  '/app/reports/performance': 'Performance',
  '/app/reports/pages': 'Pages',
  '/app/reports/security': 'Passive security',
  '/app/imports': 'Data imports',
  '/app/rankings': 'Rankings',
  '/app/search-data': 'Search Data',
  '/app/settings': 'Settings',
  '/app/tools': 'Tools',
};

function WorkspaceBreadcrumbs() {
  const { pathname, search } = useLocation();
  const audit = parseAuditWorkspacePath(pathname);
  const adminPath = pathname === '/admin' || pathname.startsWith('/admin/');
  const current = audit
    ? ({ overview: 'Overview', seo: 'SEO findings', technical: 'Technical SEO', crawlability: 'Crawlability', links: 'Links', performance: 'Performance', accessibility: 'Accessibility', security: 'Passive security', pages: 'Pages' })[audit.section]
    : adminPath
      ? adminSectionForPath(pathname).label
      : workspaceLabels[pathname] || 'Workspace';
  const rootPath = adminPath ? '/admin' : '/app';
  const rootLabel = adminPath ? 'Admin' : 'Workspace';
  const group = adminPath ? adminGroupForPath(pathname) : clientGroupForTab(tabForPath(pathname));
  const groupPath = adminPath ? adminGroupForPath(pathname).sections[0].path : TAB_PATHS[clientGroupForTab(tabForPath(pathname))?.id || 'dashboard'];
  const trail: Array<{ label: string; path: string | null }> = [];
  if (audit) {
    trail.push({ label: 'Audits', path: '/app/audits/history' });
    if (audit.section !== 'overview') trail.push({ label: `Audit ${audit.auditId.slice(0, 8)}`, path: `${auditWorkspacePath(audit.auditId)}${search}` });
  } else if (group && group.label !== current && groupPath !== pathname) trail.push({ label: group.label, path: groupPath });
  trail.push({ label: current, path: null });
  if (pathname === rootPath) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-4 overflow-x-auto text-xs text-muted-foreground">
      <ol className="flex min-w-max items-center gap-1.5">
        <li><Link to={rootPath} className="rounded px-1 py-1 font-semibold hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">{rootLabel}</Link></li>
        {trail.map((item) => <li key={`${item.label}-${item.path || 'current'}`} className="flex items-center gap-1.5"><ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />{item.path ? <Link to={item.path} className="rounded px-1 py-1 font-semibold hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">{item.label}</Link> : <span className="px-1 py-1 capitalize text-foreground" aria-current="page">{item.label}</span>}</li>)}
      </ol>
    </nav>
  );
}

function WorkspaceSections() {
  const location = useLocation();
  if (location.pathname.startsWith('/admin') || parseAuditWorkspacePath(location.pathname)) return null;
  const group = clientGroupForTab(tabForPath(location.pathname));
  const items = group?.items.filter(item => ['seo-audit', 'audit-history', 'reports', 'search-data', 'imports', 'rank-tracker'].includes(item.id));
  if (!items?.length) return null;
  return <nav aria-label={`${group!.label} views`} className="workspace-section-nav">{items.map(item => {
    const path = clientNavigationPath(item.id, location.pathname, location.search, location.hash);
    return <Link key={item.id} to={path} aria-current={isCurrentNavigationPath(path, location.pathname) ? 'page' : undefined}>{item.label}</Link>;
  })}</nav>;
}

export default function WorkspaceShell({
  children,
  sidebar,
  theme,
  onToggleTheme,
  sidebarOpen,
  onToggleSidebar,
  onHome,
  userLabel,
  authLoading,
  onLogin,
  onRegister,
  onSettings,
  onLogout,
}: {
  children: ReactNode;
  sidebar: ReactNode;
  theme: Theme;
  onToggleTheme: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onHome: () => void;
  userLabel?: string | null;
  authLoading?: boolean;
  onLogin: () => void;
  onRegister: () => void;
  onSettings: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="workspace-shell flex h-dvh min-h-0 flex-col overflow-hidden">
      <a href="#workspace-content" className="skip-link">Skip to workspace content</a>
      <header className="relative z-50 flex h-[4.25rem] shrink-0 items-center border-b border-border bg-card px-4 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button type="button" onClick={onToggleSidebar} className="min-h-11 min-w-11 rounded-lg p-2.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={sidebarOpen} aria-controls="workspace-navigation"><Menu className="h-5 w-5" /></button>
          <button type="button" onClick={onHome} className="rounded-lg" aria-label={`${BRAND.name} home`}><BrandMark /></button>
        </div>
        <div className="ml-3 flex items-center gap-2">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          {authLoading ? <div className="h-9 w-20 animate-pulse rounded-lg bg-muted" /> : userLabel ? (
            <>
              <button type="button" onClick={onSettings} className="inline-flex min-h-11 min-w-11 max-w-48 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-muted" aria-label="Account settings"><User className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="hidden truncate md:block">{userLabel}</span></button>
              <button type="button" onClick={onLogout} className="min-h-11 min-w-11 rounded-lg p-2.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-600" aria-label="Sign out"><LogOut className="h-5 w-5" /></button>
            </>
          ) : (
            <><button type="button" onClick={onLogin} className="hidden rounded-lg px-3 py-2 text-sm font-semibold hover:bg-muted sm:block">Log in</button><button type="button" onClick={onRegister} className="trust-button min-h-10 px-3 py-2 text-sm">Sign up</button></>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">{sidebar}<main id="workspace-content" className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain" tabIndex={-1}><div className="suite-page"><WorkspaceBreadcrumbs /><WorkspaceSections />{children}</div></main></div>
    </div>
  );
}
