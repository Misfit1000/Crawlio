import { Activity, BarChart3, FileText, Gauge, Globe, HelpCircle, History, LayoutDashboard, Layers, ListChecks, Search, Settings, ShieldAlert, ShieldCheck, X, type LucideIcon } from 'lucide-react';
import { TabType } from '../App';
import { useAuth } from '../contexts/AuthContext';
import { useLocation, useNavigate } from '../app/router';
import { useEffect, useRef, type ReactNode } from 'react';

function NavigationGroup({ title, active, children }: { title: string; active: boolean; children: ReactNode }) {
  const label = <span className="text-xs font-semibold text-muted-foreground">{title}</span>;
  if (title === 'Audit evidence') return <details open={active} className="navigation-evidence"><summary className="min-h-10 cursor-pointer px-2 py-2">{label}</summary><div className="mt-1">{children}</div></details>;
  return <div><div className="mb-2 px-2">{label}</div>{children}</div>;
}

const navGroups: Array<{
  title: string;
  items: Array<{ icon: LucideIcon; label: string; description: string; id: TabType; adminOnly?: boolean }>;
}> = [
  {
    title: 'Workspace',
    items: [
      { icon: LayoutDashboard, label: 'Dashboard', description: 'Scores and next actions', id: 'dashboard' },
      { icon: Globe, label: 'Projects', description: 'Websites, schedules, and progress', id: 'projects' },
      { icon: Activity, label: 'Start audit', description: 'Run a live website audit', id: 'seo-audit' },
      { icon: History, label: 'Audit history', description: 'Past runs and comparisons', id: 'audit-history' },
      { icon: FileText, label: 'Reports', description: 'Evidence, exports, and delivery', id: 'reports' },
    ],
  },
  {
    title: 'Audit evidence',
    items: [
      { icon: Search, label: 'SEO findings', description: 'Metadata and content checks', id: 'seo-findings' },
      { icon: Gauge, label: 'Technical SEO', description: 'Delivery and status signals', id: 'technical-seo' },
      { icon: Layers, label: 'Crawlability', description: 'Discovery and indexing signals', id: 'crawlability' },
      { icon: BarChart3, label: 'Performance', description: 'Observed response and size', id: 'performance' },
      { icon: ShieldCheck, label: 'Passive security', description: 'Non-invasive public checks', id: 'security-audit' },
      { icon: Globe, label: 'Pages', description: 'Filter page-level evidence', id: 'pages' },
    ],
  },
  { title: 'Search data', items: [
    { icon: BarChart3, label: 'Search performance', description: 'Connected or imported search data', id: 'search-data' },
    { icon: Layers, label: 'Import data', description: 'Add your provider exports', id: 'imports' },
    { icon: Search, label: 'Keyword positions', description: 'Positions from imported data', id: 'rank-tracker' },
  ] },
  { title: 'Administration', items: [{ icon: ShieldAlert, label: 'Admin', description: 'Users, queue, and engine health', id: 'admin-dashboard', adminOnly: true }] },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  onOpenHelp?: () => void;
}

export default function Sidebar({ isOpen, onClose, activeTab, setActiveTab, onOpenHelp }: SidebarProps) {
  const navigationRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen || window.innerWidth >= 1024) return;
    const previous = document.activeElement as HTMLElement | null;
    const navigation = navigationRef.current;
    navigation?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (window.innerWidth >= 1024) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab' || !navigation) return;
      const controls = [...navigation.querySelectorAll<HTMLElement>('button, a[href], summary, input, select, [tabindex="0"]')].filter((element) => element.getClientRects().length && !element.hasAttribute('disabled'));
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === navigation)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    navigation?.addEventListener('keydown', handleKey);
    return () => { navigation?.removeEventListener('keydown', handleKey); if (previous?.isConnected) previous.focus(); };
  }, [isOpen]);
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = activeTab === 'admin-dashboard';
  const adminLinks = [
    ['Overview', '/admin'], ['Users', '/admin/users'], ['Audits', '/admin/audits'],
    ['Queue', '/admin/queue'], ['Content', '/admin/blog'], ['Audit engines', '/admin/workers'],
    ['Diagnostics', '/admin/diagnostics'], ['Plans', '/admin/plans'], ['Platform settings', '/admin/settings'],
  ];

  const filteredGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.adminOnly || user?.role === 'admin'),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <>
      {isOpen && <div onClick={onClose} className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm lg:hidden" />}

      {isOpen && (
        <aside ref={navigationRef} tabIndex={-1} aria-label="Workspace navigation" className="workspace-navigation fixed left-0 top-[4.25rem] z-50 flex h-[calc(100dvh-4.25rem)] w-[16rem] flex-col overflow-hidden border-r border-border bg-card lg:relative lg:top-0 lg:h-full lg:shrink-0">
          <div className="border-b border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{isAdmin ? 'Administration' : 'Workspace'}</div>
                <div className="text-xs text-muted-foreground">{isAdmin ? 'Manage Crawlio' : 'Website audits and reports'}</div>
              </div>
              <button onClick={onClose} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden" aria-label="Close navigation">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3" aria-label="Main navigation">
            {isAdmin ? <div className="space-y-1">{adminLinks.map(([label, path]) => <button key={path} type="button" aria-current={location.pathname === path ? 'page' : undefined} onClick={() => { navigate(path); if (window.innerWidth < 1024) onClose(); }} className={`flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-medium ${location.pathname === path ? 'bg-accent/10 text-accent' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{label}</button>)}<button className="quiet-button mt-4 w-full" onClick={() => setActiveTab('dashboard')}>Back to workspace</button></div> : filteredGroups.map((group) => (
              <NavigationGroup key={group.title} title={group.title} active={group.items.some((item) => item.id === activeTab)}>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const isActive = activeTab === item.id;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => {
                          setActiveTab(item.id);
                          if (window.innerWidth < 1024) onClose();
                        }}
                        className={`group flex min-h-12 w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-200 ${
                          isActive
                            ? 'bg-accent/10 text-accent'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{item.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </NavigationGroup>
            ))}
          </nav>

          <div className="shrink-0 border-t border-border bg-card p-4">
            <button
              type="button"
              onClick={() => {
                setActiveTab('settings');
                if (window.innerWidth < 1024) onClose();
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Settings className="h-5 w-5 text-accent" />
              <span>
                <span className="block text-sm font-semibold">Settings</span>
                <span className="block text-xs text-muted-foreground">Account and preferences</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenHelp?.();
                if (window.innerWidth < 1024) onClose();
              }}
              className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <HelpCircle className="h-5 w-5 text-accent" />
              <span>
                <span className="block text-sm font-semibold">Help</span>
                <span className="block text-xs text-muted-foreground">Setup and support</span>
              </span>
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
