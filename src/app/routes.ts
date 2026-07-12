export type TabType = 'dashboard' | 'keyword-research' | 'website-analyzer' | 'keyword-clusters' | 'competitor-gap' | 'content-briefs' | 'seo-audit' | 'seo-findings' | 'technical-seo' | 'crawlability' | 'performance' | 'pages' | 'audit-history' | 'security-audit' | 'rank-tracker' | 'imports' | 'reports' | 'settings' | 'admin-dashboard' | 'public-discovery' | 'search-data';

export type AuditWorkspaceSection = 'overview' | 'seo' | 'technical' | 'crawlability' | 'links' | 'performance' | 'security' | 'pages';

export const TAB_PATHS: Record<TabType, string> = {
  dashboard: '/app',
  'keyword-research': '/app/keywords',
  'website-analyzer': '/app/website-scan',
  'keyword-clusters': '/app/keyword-clusters',
  'competitor-gap': '/app/competitors',
  'content-briefs': '/app/content-briefs',
  'seo-audit': '/app/audits/new',
  'audit-history': '/app/audits/history',
  'seo-findings': '/app/reports/seo',
  'technical-seo': '/app/reports/technical',
  crawlability: '/app/reports/crawlability',
  performance: '/app/reports/performance',
  pages: '/app/reports/pages',
  'security-audit': '/app/reports/security',
  'rank-tracker': '/app/rankings',
  imports: '/app/imports',
  reports: '/app/reports',
  settings: '/app/settings',
  'admin-dashboard': '/admin',
  'public-discovery': '/app/discovery',
  'search-data': '/app/search-data',
};

const exactPathTabs = new Map(Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as TabType]));
const workspaceSectionTabs: Record<AuditWorkspaceSection, TabType> = {
  overview: 'reports',
  seo: 'seo-findings',
  technical: 'technical-seo',
  crawlability: 'crawlability',
  links: 'crawlability',
  performance: 'performance',
  security: 'security-audit',
  pages: 'pages',
};

export function auditWorkspacePath(auditId: string, section: AuditWorkspaceSection = 'overview') {
  return `/app/audits/${encodeURIComponent(auditId)}/${section}`;
}

export function tabForPath(pathname: string): TabType {
  if (pathname === '/admin/login' || pathname.startsWith('/admin/')) return 'admin-dashboard';
  const workspace = parseAuditWorkspacePath(pathname);
  if (workspace) return workspaceSectionTabs[workspace.section];
  return exactPathTabs.get(pathname.replace(/\/$/, '') || '/') ?? 'dashboard';
}

export function parseAuditWorkspacePath(pathname: string): { auditId: string; section: AuditWorkspaceSection } | null {
  const match = pathname.match(/^\/app\/audits\/([^/]+)(?:\/(overview|seo|technical|crawlability|links|performance|security|pages))?\/?$/);
  if (!match) return null;
  if (match[1] === 'new' || match[1] === 'history') return null;
  try {
    return { auditId: decodeURIComponent(match[1]), section: (match[2] || 'overview') as AuditWorkspaceSection };
  } catch {
    return { auditId: match[1], section: (match[2] || 'overview') as AuditWorkspaceSection };
  }
}

export function isWorkspacePath(pathname: string) {
  return pathname === '/app' || pathname.startsWith('/app/') || pathname === '/admin' || pathname.startsWith('/admin/');
}
