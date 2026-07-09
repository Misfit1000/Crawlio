import { Activity, BarChart3, FileText, Globe, HelpCircle, LayoutDashboard, Layers, PieChart, Search, Settings, ShieldAlert, ShieldCheck, Target, Upload, X, type LucideIcon } from 'lucide-react';
import { TabType } from '../App';
import { useAuth } from '../contexts/AuthContext';

const navGroups: Array<{
  title: string;
  items: Array<{ icon: LucideIcon; label: string; description: string; id: TabType; adminOnly?: boolean }>;
}> = [
  {
    title: 'Overview',
    items: [
      { icon: LayoutDashboard, label: 'Dashboard', description: 'Scores, limits, and next actions', id: 'dashboard' },
      { icon: PieChart, label: 'Reports', description: 'Client-ready summaries', id: 'reports' },
    ],
  },
  {
    title: 'Audits',
    items: [
      { icon: Activity, label: 'SEO Audit', description: 'Titles, links, Google access', id: 'seo-audit' },
      { icon: ShieldCheck, label: 'Browser Safety', description: 'Passive protection checks', id: 'security-audit' },
      { icon: Globe, label: 'Website Scan', description: 'Public page scan tools', id: 'website-analyzer' },
    ],
  },
  {
    title: 'SEO Data',
    items: [
      { icon: Upload, label: 'Data Sources', description: 'Import real CSV data', id: 'imports' },
      { icon: BarChart3, label: 'Search Data', description: 'GSC/Bing performance', id: 'search-data' },
      { icon: BarChart3, label: 'Rankings Data', description: 'Imported SERP positions', id: 'rank-tracker' },
      { icon: Search, label: 'Keyword Ideas', description: 'Deterministic suggestions', id: 'keyword-research' },
      { icon: Layers, label: 'Topic Clusters', description: 'Group keyword themes', id: 'keyword-clusters' },
    ],
  },
  {
    title: 'Planning',
    items: [
      { icon: Target, label: 'Competitor Compare', description: 'Content gap workflow', id: 'competitor-gap' },
      { icon: FileText, label: 'Content Briefs', description: 'Outline next pages', id: 'content-briefs' },
      { icon: Globe, label: 'Public Discovery', description: 'Find public signals', id: 'public-discovery' },
      { icon: ShieldAlert, label: 'Admin Panel', description: 'Worker and plan controls', id: 'admin-dashboard', adminOnly: true },
    ],
  },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
}

export default function Sidebar({ isOpen, onClose, activeTab, setActiveTab }: SidebarProps) {
  const { user } = useAuth();

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
        <aside className="fixed left-0 top-[4.5rem] z-50 flex h-[calc(100vh-4.5rem)] w-[18rem] flex-col overflow-hidden border-r border-border bg-card/92 shadow-2xl shadow-slate-950/10 backdrop-blur-xl lg:sticky dark:shadow-black/30">
          <div className="border-b border-border p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black">SEO suite</div>
                <div className="text-xs text-muted-foreground">Audit, data, reports</div>
              </div>
              <button onClick={onClose} className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden" aria-label="Close navigation">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <nav className="flex-1 space-y-5 overflow-y-auto p-4" aria-label="Main navigation">
            {filteredGroups.map((group) => (
              <div key={group.title}>
                <div className="mb-2 px-2 text-[0.68rem] font-black uppercase tracking-[0.16em] text-muted-foreground">{group.title}</div>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const isActive = activeTab === item.id;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setActiveTab(item.id);
                          if (window.innerWidth < 1024) onClose();
                        }}
                        className={`group flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-200 ${
                          isActive
                            ? 'bg-accent text-accent-foreground shadow-lg shadow-accent/20'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${isActive ? 'text-accent-foreground' : 'text-accent'}`} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold">{item.label}</span>
                          <span className={`block truncate text-xs ${isActive ? 'text-accent-foreground/80' : 'text-muted-foreground'}`}>{item.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-border p-4">
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Settings className="h-5 w-5 text-accent" />
              <span>
                <span className="block text-sm font-bold">Settings</span>
                <span className="block text-xs text-muted-foreground">Account and preferences</span>
              </span>
            </button>
            <button type="button" className="mt-1 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <HelpCircle className="h-5 w-5 text-accent" />
              <span>
                <span className="block text-sm font-bold">Help</span>
                <span className="block text-xs text-muted-foreground">Setup and support</span>
              </span>
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
