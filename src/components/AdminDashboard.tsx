import { Activity,BookOpen,Database,Gauge,Loader2,Settings,ShieldAlert,SlidersHorizontal,Users,Wifi } from 'lucide-react';
import React from 'react';
import { useLocation,useNavigate } from '../app/router';
import { useAuth } from '../contexts/AuthContext';
import { AdminActionProvider } from './admin/AdminActionDialog';
import BlogNotificationInbox from './blog/BlogNotificationInbox';
import { Notice,PageHeader,Panel as UiPanel } from './ui/page-system';

const AdminOverview = React.lazy(() => import('./admin/AdminOverview'));
const AdminUsers = React.lazy(() => import('./admin/AdminUsers'));
const AdminAudits = React.lazy(() => import('./admin/AdminAudits'));
const AdminQueue = React.lazy(() => import('./admin/AdminQueue'));
const AdminWorkers = React.lazy(() => import('./admin/AdminWorkers'));
const AdminDiagnostics = React.lazy(() => import('./admin/AdminDiagnostics'));
const AdminSettings = React.lazy(() => import('./admin/AdminSettings'));
const AdminPlans = React.lazy(() => import('./admin/AdminPlans'));

const BlogAdmin = React.lazy(() => import('./blog/BlogAdmin'));

type AdminTab = 'overview' | 'users' | 'audits' | 'queue' | 'workers' | 'diagnostics' | 'settings' | 'plans' | 'blog';

const tabs: Array<{ id: AdminTab; label: string; icon: any; path: string }> = [
  { id: 'overview', label: 'Overview', icon: Activity, path: '/admin' },
  { id: 'users', label: 'Users', icon: Users, path: '/admin/users' },
  { id: 'audits', label: 'Audits', icon: Database, path: '/admin/audits' },
  { id: 'queue', label: 'Queue', icon: SlidersHorizontal, path: '/admin/queue' },
  { id: 'workers', label: 'Audit Engine', icon: Wifi, path: '/admin/workers' },
  { id: 'diagnostics', label: 'Diagnostics', icon: Gauge, path: '/admin/diagnostics' },
  { id: 'settings', label: 'Settings', icon: Settings, path: '/admin/settings' },
  { id: 'plans', label: 'Plans', icon: ShieldAlert, path: '/admin/plans' },
  { id: 'blog', label: 'Blog', icon: BookOpen, path: '/admin/blog' },
];

function tabFromPath(pathname: string) {
  const match = pathname.match(/^\/admin\/([^/]+)/);
  const id = match?.[1] as AdminTab | undefined;
  return tabs.some((tab) => tab.id === id) ? id! : 'overview';
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = tabFromPath(location.pathname);

  if (!user || user.role !== 'admin') {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-8 py-16">
        <PageHeader eyebrow="Protected area" icon={ShieldAlert} title="Admin access required" description="This operational workspace is available only to accounts with the server-verified admin role." />
        <Notice tone="danger">Sign in with an administrator account assigned through the existing admin role controls. Client-side state cannot grant access.</Notice>
      </div>
    );
  }

  const switchTab = (tab: AdminTab) => {
    navigate(tabs.find((item) => item.id === tab)?.path || '/admin');
  };

  return (
    <AdminActionProvider><div className="admin-workspace space-y-6">
      <PageHeader eyebrow="Operations" icon={Activity} title="Admin control center" description="Monitor the audit platform, manage access and plans, recover queued work, and publish reviewed guidance." metadata={<><span className="suite-chip"><ShieldAlert className="h-3.5 w-3.5" /> Server-verified admin</span><span className="suite-chip">{tabs.find((tab) => tab.id === activeTab)?.label}</span><BlogNotificationInbox /></>} />

      <UiPanel className="flex max-w-full gap-1 overflow-x-auto p-1.5 lg:hidden" as="nav">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              aria-current={activeTab === tab.id ? 'page' : undefined}
              className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
                activeTab === tab.id ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </UiPanel>

      <React.Suspense fallback={<div role='status' className='p-8 text-muted-foreground'>Loading section...</div>}>
      {activeTab === 'overview' && <AdminOverview />}
      {activeTab === 'users' && <AdminUsers adminUserId={user.id} />}
      {activeTab === 'audits' && <AdminAudits adminUserId={user.id} />}
      {activeTab === 'queue' && <AdminQueue adminUserId={user.id} />}
      {activeTab === 'workers' && <AdminWorkers />}
      {activeTab === 'diagnostics' && <AdminDiagnostics />}
      {activeTab === 'settings' && <AdminSettings />}
      {activeTab === 'plans' && <AdminPlans adminUserId={user.id} />}
      {activeTab === 'blog' && (
        <React.Suspense fallback={<div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>}>
          <BlogAdmin />
        </React.Suspense>
      )}
    </React.Suspense></div></AdminActionProvider>
  );
}
