import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { transform } from 'esbuild';

export const previewIds = {
  user: '11111111-1111-4111-8111-111111111111',
  audit: '22222222-2222-4222-8222-222222222222',
  project: '44444444-4444-4444-8444-444444444444',
};
export const previewRoutes = ['/app', '/app/projects', '/admin', '/admin/users', '/admin/audits', '/admin/queue', '/admin/workers', '/admin/diagnostics', '/admin/settings', '/admin/plans', '/admin/blog'];
const now = '2026-10-09T06:00:00.000Z';
const profile = { id: previewIds.user, email: 'operator@example.test', display_name: 'Preview operator', plan: 'paid', role: 'user', subscription_status: 'active', disabled: false, audit_quota_used_daily: 2, audit_quota_used_monthly: 12 };
const audit = { id: previewIds.audit, user_id: previewIds.user, normalized_url: 'https://example.test/a-long-domain-path-to-inspect', status: 'failed', processing_version: 2, plan: 'paid', effective_mode: 'standard', created_at: now, updated_at: now, started_at: now, completed_at: now, pages_discovered: 12, pages_crawled: 10, lease_expires_at: '9999-01-01T00:00:00Z', error: 'Target timed out' };
const worker = { id: 'engine-1', state: 'healthy', lastSeenAt: now, databaseConnected: true, currentAuditId: null, commitIdentifier: 'abc123', apiSchemaVersion: 15, auditEngineVersion: '2', scoringVersion: '1', deepAuditEnabled: true };
const trend = [4, 7, 0, 9, 5, 11, 8].map((audits, index) => ({ day: `2026-10-${String(index + 3).padStart(2, '0')}`, audits, completed: [3, 5, 0, 7, 4, 8, 5][index], warnings: [0, 1, 0, 1, 0, 1, 1][index], failed: [1, 1, 0, 1, 1, 1, 1][index], medianDurationSeconds: index === 2 ? null : 35 + index * 2 }));
const operation = {
  observedAt: now, status: 'degraded', reasons: ['Review failed target request.'],
  components: Object.fromEntries(['api', 'database', 'worker', 'queue', 'deployment'].map(name => [name, { status: 'healthy', reason: `${name} ready` }])),
  metrics: { audits: 44, completed: 32, warnings: 4, failed: 6, abandoned: 2, successRate: 36 / 44 * 100, medianDurationSeconds: 41 },
  queue: { queued: 2, running: 1, oldestQueuedSeconds: 83, medianWaitSeconds: 25, staleLeases: 0, byMode: { quick: 1, standard: 1 }, byPlan: { free: 1, paid: 1 } }, workers: [worker],
  deployment: { applicationCommit: 'abc123', workerCommit: 'abc123', expectedSchemaVersion: 15, databaseSchemaVersion: 15, appliedMigration: '028', compatible: true, commitMismatch: false }, trend,
  recentFailures: [{ id: previewIds.audit, domain: 'example.test', status: 'failed', error: 'Target timed out', createdAt: now, failureClass: 'target-site', failureCode: 'TARGET_TIMEOUT' }],
  recentActions: [{ id: 'preview-action', action: 'audit.retry', targetType: 'audit', targetId: previewIds.audit, reason: 'Target recovered; retry approved', outcome: 'retry_queued', createdAt: now, requestId: 'preview-request' }],
};
const plan = { plan: 'paid', label: 'Paid', daily_audits: 25, monthly_audits: 500, max_pages_quick: 50, max_pages_standard: 50, max_pages_deep: 0, priority: 50, allowed_modes: ['quick', 'standard'], exports_enabled: true, pdf_enabled: true, scheduled_audits_enabled: true };
const settings = { platform_name: 'Crawlio', support_email: 'support@example.test', value: { guestAuditEnabled: true, hardQueueLimit: 50 } };
const summary = (id, score, day, extra = {}) => ({ id, status: 'completed', score, pagesCrawled: 42, issuesFound: 8, criticalCount: 0, highCount: 2, createdAt: `2026-10-${day}T05:00:00.000Z`, completedAt: `2026-10-${day}T05:02:00.000Z`, ...extra });
const projects = [
  { id: previewIds.project, name: 'Crawlio documentation', hostname: 'docs.example.test', normalizedUrl: 'https://docs.example.test/', auditFrequency: 'weekly', auditMode: 'standard', nextAuditAt: '2026-10-16T05:00:00.000Z', changeAlertsEnabled: true, latestAudit: summary('docs-latest', 84, '09'), previousAudit: summary('docs-previous', 76, '02'), scoreDelta: 8, newCriticalCount: 0, resolvedFindingCount: 5, openFindingCount: 8, recommendedAction: 'Add unique descriptions to the two remaining documentation pages.' },
  { id: '55555555-5555-4555-8555-555555555555', name: 'Storefront', hostname: 'shop.example.test', normalizedUrl: 'https://shop.example.test/', auditFrequency: 'manual', auditMode: 'standard', nextAuditAt: null, changeAlertsEnabled: true, latestAudit: summary('shop-latest', 0, '08', { criticalCount: 3, highCount: 6, issuesFound: 17, pagesCrawled: 18 }), previousAudit: summary('shop-previous', 38, '01'), scoreDelta: -38, newCriticalCount: 3, resolvedFindingCount: 1, openFindingCount: 17, recommendedAction: 'Review the new crawl-blocking rules before running another audit.' },
  { id: '66666666-6666-4666-8666-666666666666', name: 'New publication', hostname: 'journal.example.test', normalizedUrl: 'https://journal.example.test/', auditFrequency: 'manual', auditMode: 'quick', nextAuditAt: null, changeAlertsEnabled: false, latestAudit: null, previousAudit: null, scoreDelta: null, newCriticalCount: 0, resolvedFindingCount: 0, openFindingCount: 0, recommendedAction: 'Run the first audit to collect page evidence.' },
];
const history = [
  ...projects.flatMap(project => [project.latestAudit, project.previousAudit].filter(Boolean).map(item => ({ auditId: item.id, projectId: project.id, normalizedUrl: project.normalizedUrl, hostname: project.hostname, status: item.status, score: item.score, scoreSource: 'final_report', scores: { seo: item.score, technical: item.score, crawlability: item.score, performance: null, security: 92, accessibility: null }, issuesFound: item.issuesFound, criticalCount: item.criticalCount, highCount: item.highCount, mediumCount: 4, lowCount: 2, pagesCrawled: item.pagesCrawled, createdAt: item.createdAt, completedAt: item.completedAt, updatedAt: item.completedAt, mode: 'standard', issueSignatures: [], topIssues: [], pageSummaries: [] }))),
].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

const entry = `
import React,{lazy,Suspense,useState} from 'react';import{createRoot}from'react-dom/client';
import{BrowserRouter,useLocation,useNavigate}from'/src/app/router.tsx';import{TAB_PATHS,tabForPath}from'/src/app/routes.ts';
import WorkspaceShell from'/src/components/layout/WorkspaceShell.tsx';import Sidebar from'/src/components/Sidebar.tsx';import{useAuth}from'/src/contexts/AuthContext';import'/src/index.css';
const AdminDashboard=lazy(()=>import('/src/components/AdminDashboard.tsx')),Dashboard=lazy(()=>import('/src/components/Dashboard.tsx')),Projects=lazy(()=>import('/src/components/projects/ProjectsPage.tsx'));
const initial=new URLSearchParams(location.search),initialTheme=initial.get('theme')==='black'?'dark':initial.get('theme')==='light'?'light':localStorage.getItem('crawlio_preview_theme')||'light';
document.documentElement.classList.toggle('dark',initialTheme==='dark');
localStorage.setItem('crawlio_audit_history_v1',JSON.stringify(initial.get('scenario')==='projects-empty'?[]:${JSON.stringify(history)}));localStorage.setItem('crawlio_project_owner','${previewIds.user}');
function App(){const location=useLocation(),navigate=useNavigate(),{user}=useAuth();const[open,setOpen]=useState(innerWidth>=1024),[theme,setTheme]=useState(initialTheme);
const setTab=tab=>navigate(TAB_PATHS[tab]);const start=()=>navigate('/app/audits/new'),reports=()=>navigate('/app/reports');
return <WorkspaceShell theme={theme} onToggleTheme={()=>{const next=theme==='dark'?'light':'dark';setTheme(next);localStorage.setItem('crawlio_preview_theme',next);document.documentElement.classList.toggle('dark',next==='dark')}} sidebarOpen={open} onToggleSidebar={()=>setOpen(value=>!value)} onHome={()=>navigate('/app')} userLabel={user?.email} onSettings={()=>navigate('/app/settings')} onLogout={()=>{}} onLogin={()=>{}} onRegister={()=>{}} sidebar={<Sidebar isOpen={open} onClose={()=>setOpen(false)} activeTab={tabForPath(location.pathname)} setActiveTab={setTab} onOpenHelp={()=>navigate('/app/help')}/> }>
<Suspense fallback={<p role="status">Loading local UI fixture...</p>}>{location.pathname.startsWith('/admin')?<AdminDashboard/>:location.pathname==='/app'?<Dashboard onOpenSeoAudit={start} onOpenReports={reports} onOpenImports={()=>navigate('/app/imports')} onOpenSecurityAudit={()=>navigate('/app/security')}/>:location.pathname==='/app/projects'?<Projects onStartAudit={start} onOpenReports={reports}/>:<section><h1>Outside preview inventory</h1><p>This local read-only harness does not render this application screen.</p><a href="/app">Back to dashboard</a></section>}</Suspense></WorkspaceShell>}
createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);`;

function fixtureData(path, scenario) {
  if (path === 'projects/overview') return { projects: scenario === 'projects-empty' ? [] : projects, unreadNotifications: scenario === 'projects-empty' ? 0 : 2, scheduledAuditsEnabled: true, generatedAt: now };
  if (path === 'projects/notifications') return { notifications: [{ id: 'notice-1', title: 'Documentation score improved', message: 'Five findings were resolved in the latest comparison.', created_at: now, read_at: null }, { id: 'notice-2', title: 'Storefront needs attention', message: 'Three new critical findings need review.', created_at: now, read_at: null }] };
  if (path === 'admin/operations') {
    const cases = { empty: [], zero: [{ ...trend[0], audits: 0, completed: 0, warnings: 0, failed: 0, medianDurationSeconds: null }], unavailable: [{ ...trend[0], audits: null, completed: null, warnings: null, failed: null, medianDurationSeconds: null }], mixed: [trend[0], { ...trend[1], audits: null, medianDurationSeconds: null }] };
    return { ...operation, trend: Object.hasOwn(cases, scenario) ? cases[scenario] : trend };
  }
  if (path === 'admin/users') return { rows: [profile], hasMore: false };
  if (path === 'admin/audits') return { rows: [audit], hasMore: false };
  if (path === `admin/users/${previewIds.user}/detail`) return { profile, usage: { dailyUsed: 2, monthlyUsed: 12, dailyLimit: 25, monthlyLimit: 500, totalAudits: 8, queued: 0, running: 0, completed: 5, warnings: 1, failed: 2 }, latestAudit: { id: previewIds.audit, domain: 'example.test', status: 'failed', mode: 'standard', score: 0, completedAt: now } };
  if (path === `admin/audits/${previewIds.audit}/detail`) return { audit, diagnostics: [], processing: { attempted: 12, analysed: 10, failed: 2, blocked: 0 }, worker: { id: worker.id, leaseExpiresAt: now }, retryEligible: true, failureClass: 'target-site' };
  if (path === 'admin/workers') return [worker];
  if (path === 'admin/plans') return [plan];
  if (path === 'admin/platform/settings') return settings;
  if (path === 'admin/actions') return { rows: operation.recentActions, hasMore: false };
  if (path === 'admin/search') return { users: [profile], audits: [audit], schedules: [] };
  if (path === 'admin/resources') return { observedAt: now, relations: [{ name: 'audits', bytes: 2048, approximateRows: null, oldestAt: null, retentionDays: null, retentionDescription: 'Retained until account deletion.' }], quotaAvailability: 'provider-dashboard-only' };
  if (path === 'admin/diagnostics') return { compatibility: { compatible: true, status: 'compatible' }, metrics: { queued: 2, running: 1, completed: 32, completedWithWarnings: 4, failed: 6, abandoned: 2, staleLeases: 0, failuresByCode: { TARGET_TIMEOUT: 6 } }, operations: { status: 'degraded', reasons: operation.reasons, workerOnline: true, activeWorkerCount: 1, lastWorkerHeartbeat: now, oldestQueuedAgeSeconds: 83, queuedAuditCount: 2, recentCompletionRate: 36 / 44, medianAuditDurationMs: 41000, applicationCommit: 'abc123', workerCommit: 'abc123', databaseSchemaVersion: 15, apiSchemaVersion: 15, deepAuditEnabled: true }, monitoring: { apiConfigured: false, environment: 'local-preview' }, recentApiErrors: [], recentAuditDiagnostics: [] };
  if (path === 'admin/blog/posts') return { posts: [], total: 0 };
  if (path === 'admin/blog/settings') return { settings: { enabled: false, provider_enabled: false, timezone: 'UTC', approved_feed_urls: [], require_review_for_urgent: true, required_reviewed_articles_before_autopublish: 30, strict_autopilot_enabled: false, emergency_pause: false, pause_all_publication: true } };
  if (path === 'admin/blog/overview') return { overview: { activeJobs: 0, draftsNeedingReview: 0, strictAutopilotUnlocked: false }, provider: { provider: 'Groq', execution: 'Local UI fixture', enabled: false, configured: false, health: 'not tested', fixtureAvailable: false }, runtime: { dispatchConfigured: false, automationEnabled: false, providerEnabled: false, providerConfigured: false, generationAllowed: false, automaticPublishingAllowed: false, oneClickAllowed: false, cronSchedule: null, blockers: [{ code: 'LOCAL_READ_ONLY', message: 'Generation is disabled in this read-only preview.', action: 'Use production only after normal readiness checks.' }] }, jobs: [], discoveries: [] };
  if (path === 'admin/blog/editor-draft') return { draft: null };
  if (path === 'admin/blog/notifications') return { notifications: [], unreadCount: 0 };
  return undefined;
}

export async function createPreviewServer({ port = 5198 } = {}) {
  const requests = [];
  const fixture = {
    name: 'read-only-workspace-fixtures', enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('/contexts/AuthContext')) return '\0preview-auth';
      if (source.endsWith('/api/auth-headers')) return '\0preview-headers';
      if (source === '/__workspace_preview.jsx') return '\0preview-entry.jsx';
    },
    async load(id) {
      if (id === '\0preview-auth') return `export function useAuth(){const role=new URLSearchParams(location.search).get('role')||'admin';return {user:role==='guest'?null:{id:'${previewIds.user}',role,email:'operator@example.test',plan:'paid',auditQuotaUsedDaily:2,auditQuotaUsedMonthly:12,auditEntitlements:{dailyAudits:25,monthlyAudits:500}},loading:false}}`;
      if (id === '\0preview-headers') return 'export async function getAuthHeaders(base={}){return base}';
      if (id === '\0preview-entry.jsx') return (await transform(entry, { loader: 'jsx', jsx: 'automatic', format: 'esm' })).code;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (url.pathname.startsWith('/api/')) {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          const record = { method: req.method, path: url.pathname, status: 200 };
          requests.push(record);
          if (req.method !== 'GET') {
            record.status = res.statusCode = 403;
            res.end(JSON.stringify({ success: false, error: 'Read-only local UI fixture. All API writes are disabled.' }));
            return;
          }
          const scenario = new URL(req.headers.referer || '/', 'http://localhost').searchParams.get('scenario');
          const data = fixtureData(url.pathname.replace('/api/tools/', ''), scenario);
          if (data === undefined) record.status = res.statusCode = 404;
          res.end(JSON.stringify(data === undefined ? { success: false, error: 'This API is outside the local preview inventory.' } : { success: true, data }));
          return;
        }
        if (!/^\/(admin|app)(\/|$)/.test(url.pathname)) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><title>Read-only synthetic Crawlio preview</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__workspace_preview.jsx"></script></body></html>'));
      });
    },
  };
  const server = await createServer({ root: fileURLToPath(new URL('../../../../', import.meta.url)), configFile: false, cacheDir: 'node_modules/.vite-read-only-preview', resolve: { dedupe: ['react', 'react-dom'] }, optimizeDeps: { entries: [], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'lucide-react'] }, plugins: [fixture, react(), tailwindcss()], define: { __CRAWLIO_RELEASE__: '"ui-preview"', __CRAWLIO_ENVIRONMENT__: '"test"' }, server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
  return { server, requests };
}

export async function servePreview() {
  const { server } = await createPreviewServer();
  await server.listen();
  console.log(`Read-only synthetic UI preview: ${server.resolvedUrls.local[0]}app`);
  console.log(`Routes: ${previewRoutes.join(', ')}`);
  console.log('Themes: ?theme=light or ?theme=black. All non-GET /api/* requests return 403; unlisted reads return 404. No production credentials, proxy, or services.');
  await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  await server.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await servePreview();
