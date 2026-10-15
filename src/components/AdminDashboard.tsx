import { Loader2, ShieldAlert } from 'lucide-react';
import React from 'react';
import './admin/admin-workspace.css';
import { Link, useLocation } from '../app/router';
import { useAuth } from '../contexts/AuthContext';
import { AdminActionProvider } from './admin/AdminActionDialog';
import { AdminRefreshProvider } from './admin/AdminRefresh';
import AdminSearch from './admin/AdminSearch';
import BlogNotificationInbox from './blog/BlogNotificationInbox';
import { Notice, PageHeader } from './ui/page-system';
import { adminGroupForPath, adminSectionForPath, currentNavigationPath } from './navigation/product-navigation';

const AdminOverview = React.lazy(() => import('./admin/AdminOverview'));
const AdminUsers = React.lazy(() => import('./admin/AdminUsers'));
const AdminAudits = React.lazy(() => import('./admin/AdminAudits'));
const AdminQueue = React.lazy(() => import('./admin/AdminQueue'));
const AdminWorkers = React.lazy(() => import('./admin/AdminWorkers'));
const AdminDiagnostics = React.lazy(() => import('./admin/AdminDiagnostics'));
const AdminResources = React.lazy(() => import('./admin/AdminResources'));
const AdminSettings = React.lazy(() => import('./admin/AdminSettings'));
const AdminPlans = React.lazy(() => import('./admin/AdminPlans'));

const BlogAdmin = React.lazy(() => import('./blog/BlogAdmin'));

export default function AdminDashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const activeSection = adminSectionForPath(location.pathname);
  const activeTab = activeSection.id;
  const activeGroup = adminGroupForPath(location.pathname);

  if (!user || user.role !== 'admin') {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-8 py-16">
        <PageHeader eyebrow="Protected area" icon={ShieldAlert} title="Admin access required" description="This operational workspace is available only to accounts with the server-verified admin role." />
        <Notice tone="danger">Sign in with an administrator account assigned through the existing admin role controls. Client-side state cannot grant access.</Notice>
      </div>
    );
  }

  return (
    <AdminActionProvider key={user.id}><div className="admin-workspace flex min-w-0 max-w-full flex-col gap-8 text-base text-foreground">
      <div className="admin-page-heading"><PageHeader title={activeTab === 'overview' ? 'Operations overview' : activeTab === 'blog' ? 'Blog studio' : activeSection.label} actions={<BlogNotificationInbox />} /></div>

      {activeGroup.sections.length > 1 && <nav aria-label={`${activeGroup.label} sections`} className="admin-section-tabs flex min-w-0 flex-wrap gap-4 border-b border-border md:gap-6">
        {activeGroup.sections.map(section => <Link key={section.id} to={currentNavigationPath(section.path, location)} aria-current={activeTab === section.id ? 'page' : undefined} className="inline-flex min-h-12 items-center justify-center gap-2 border-b-2 border-transparent py-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-4">{section.label}</Link>)}
      </nav>}

      <AdminRefreshProvider controls={activeTab !== 'blog'} polling={activeTab !== 'settings' && activeTab !== 'plans'} toolbar={activeTab !== 'blog' ? <AdminSearch /> : undefined}>
      <React.Suspense fallback={<div role='status' className='p-8 text-muted-foreground'>Loading section...</div>}>
      {activeTab === 'overview' && <AdminOverview />}
      {activeTab === 'users' && <AdminUsers adminUserId={user.id} />}
      {activeTab === 'audits' && <AdminAudits adminUserId={user.id} />}
      {activeTab === 'queue' && <AdminQueue adminUserId={user.id} />}
      {activeTab === 'workers' && <AdminWorkers />}
      {activeTab === 'diagnostics' && <AdminDiagnostics />}
      {activeTab === 'resources' && <AdminResources />}
      {activeTab === 'settings' && <AdminSettings />}
      {activeTab === 'plans' && <AdminPlans adminUserId={user.id} />}
      {activeTab === 'blog' && (
        <React.Suspense fallback={<div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>}>
          <BlogAdmin />
        </React.Suspense>
      )}
    </React.Suspense></AdminRefreshProvider></div></AdminActionProvider>
  );
}
