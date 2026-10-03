import { Activity, BookOpen, Gauge, Globe, LayoutDashboard, Search, Settings, Users, Wrench, type LucideIcon } from 'lucide-react';
import { auditWorkspacePath, parseAuditWorkspacePath, TAB_PATHS, type TabType } from '../../app/routes';

export interface ClientNavigationItem { id: TabType; label: string }
export interface ClientNavigationGroup extends ClientNavigationItem {
  icon: LucideIcon;
  items: ClientNavigationItem[];
}

export const clientNavigation: ClientNavigationGroup[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, items: [] },
  { id: 'projects', label: 'Projects', icon: Globe, items: [] },
  { id: 'audit-history', label: 'Audits', icon: Activity, items: [
    { id: 'seo-audit', label: 'Start audit' },
    { id: 'audit-history', label: 'History' },
    { id: 'reports', label: 'Reports' },
    { id: 'seo-findings', label: 'SEO findings' },
    { id: 'technical-seo', label: 'Technical SEO' },
    { id: 'crawlability', label: 'Crawlability' },
    { id: 'performance', label: 'Performance' },
    { id: 'security-audit', label: 'Passive security' },
    { id: 'pages', label: 'Pages' },
  ] },
  { id: 'search-data', label: 'Search Data', icon: Search, items: [
    { id: 'search-data', label: 'Search performance' },
    { id: 'imports', label: 'Imports' },
    { id: 'rank-tracker', label: 'Rankings' },
  ] },
  { id: 'tools', label: 'Tools', icon: Wrench, items: [] },
];

export function clientGroupForTab(tab: TabType) {
  return clientNavigation.find(group => group.id === tab || group.items.some(item => item.id === tab) || group.id === 'audit-history' && tab === 'website-analyzer');
}

export function clientNavigationPath(tab: TabType, pathname: string, search: string, hash: string) {
  const audit = parseAuditWorkspacePath(pathname);
  const sections = { reports: 'overview', 'seo-findings': 'seo', 'technical-seo': 'technical', crawlability: 'crawlability', performance: 'performance', 'security-audit': 'security', pages: 'pages' } as const;
  const section = sections[tab as keyof typeof sections];
  const path = audit && section ? auditWorkspacePath(audit.auditId, section) : TAB_PATHS[tab];
  return path === pathname.replace(/\/$/, '') || audit && section ? `${path}${search}${hash}` : path;
}

export type AdminSection = 'overview' | 'users' | 'audits' | 'queue' | 'workers' | 'diagnostics' | 'settings' | 'plans' | 'blog';
export interface AdminNavigationSection { id: AdminSection; label: string; path: string }
export interface AdminNavigationGroup {
  label: string;
  icon: LucideIcon;
  sections: AdminNavigationSection[];
}

export const adminNavigation: AdminNavigationGroup[] = [
  { label: 'Overview', icon: LayoutDashboard, sections: [{ id: 'overview', label: 'Overview', path: '/admin' }] },
  { label: 'Users', icon: Users, sections: [{ id: 'users', label: 'Users', path: '/admin/users' }] },
  { label: 'Audits', icon: Activity, sections: [{ id: 'audits', label: 'Audits', path: '/admin/audits' }] },
  { label: 'Content', icon: BookOpen, sections: [{ id: 'blog', label: 'Content', path: '/admin/blog' }] },
  { label: 'Operations', icon: Gauge, sections: [
    { id: 'queue', label: 'Queue', path: '/admin/queue' },
    { id: 'workers', label: 'Workers', path: '/admin/workers' },
    { id: 'diagnostics', label: 'Diagnostics', path: '/admin/diagnostics' },
  ] },
  { label: 'Settings', icon: Settings, sections: [
    { id: 'settings', label: 'Platform settings', path: '/admin/settings' },
    { id: 'plans', label: 'Plans', path: '/admin/plans' },
  ] },
];

export function adminSectionForPath(pathname: string): AdminNavigationSection {
  return adminNavigation.flatMap(group => group.sections).find(section => section.path === pathname.replace(/\/$/, '') || section.path !== '/admin' && pathname.startsWith(`${section.path}/`)) || adminNavigation[0].sections[0];
}

export function adminGroupForPath(pathname: string) {
  const section = adminSectionForPath(pathname);
  return adminNavigation.find(group => group.sections.some(item => item.id === section.id))!;
}

export function currentNavigationPath(path: string, location: { pathname: string; search: string; hash: string }) {
  return path === location.pathname.replace(/\/$/, '') ? `${path}${location.search}${location.hash}` : path;
}

export function isCurrentNavigationPath(path: string, pathname: string) {
  return new URL(path, 'https://navigation.local').pathname.replace(/\/$/, '') === pathname.replace(/\/$/, '');
}
