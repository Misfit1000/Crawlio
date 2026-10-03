import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import AxeBuilder from '@axe-core/playwright';
import { transform } from 'esbuild';

const userId = '11111111-1111-4111-8111-111111111111';
const auditId = '22222222-2222-4222-8222-222222222222';
const now = new Date().toISOString();
const worker = { id: 'engine-1', state: 'healthy', lastSeenAt: now, databaseConnected: true, currentAuditId: null, commitIdentifier: 'abc123', apiSchemaVersion: 15, auditEngineVersion: '2', scoringVersion: '1', deepAuditEnabled: true };
const operation = {
  observedAt: now, status: 'degraded', reasons: ['Review failed target request.'],
  components: Object.fromEntries(['api', 'database', 'worker', 'queue', 'deployment'].map(name => [name, { status: 'healthy', reason: `${name} ready` }])),
  metrics: { audits: 8, completed: 5, warnings: 1, failed: 1, abandoned: 1, successRate: 75, medianDurationSeconds: 42 },
  queue: { queued: 0, running: 0, oldestQueuedSeconds: null, medianWaitSeconds: null, staleLeases: 0, byMode: {}, byPlan: {} }, workers: [worker],
  deployment: { applicationCommit: 'abc123', workerCommit: 'abc123', expectedSchemaVersion: 15, databaseSchemaVersion: 15, appliedMigration: '028', compatible: true, commitMismatch: false },
  trend: [{ day: now.slice(0, 10), audits: 8, completed: 5, warnings: 1, failed: 1, medianDurationSeconds: 42 }],
  recentFailures: [{ id: auditId, domain: 'example.test', status: 'failed', error: 'Target timed out', createdAt: now, failureClass: 'target-site', failureCode: 'TARGET_TIMEOUT' }], recentActions: [],
};
const plan = { id: 'paid', plan: 'paid', label: 'Paid', daily_audits: 25, monthly_audits: 500, max_pages_quick: 50, max_pages_standard: 50, max_pages_deep: 0, priority: 50, allowed_modes: ['quick', 'standard'], exports_enabled: true, pdf_enabled: true, scheduled_audits_enabled: false };
const project = { id: 'project-1', name: 'Example', hostname: 'example.test', normalizedUrl: 'https://example.test/', auditFrequency: 'manual', auditMode: 'quick', nextAuditAt: null, changeAlertsEnabled: true, latestAudit: { id: auditId, status: 'completed', score: 82, pagesCrawled: 10, issuesFound: 2, criticalCount: 1, highCount: 1, completedAt: now, createdAt: now }, previousAudit: null, scoreDelta: 2, newCriticalCount: 1, resolvedFindingCount: 3, openFindingCount: 2, recommendedAction: 'Review the missing page titles.' };
const entry = `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {BrowserRouter,useLocation,useNavigate} from '/src/app/router.tsx';
import {TAB_PATHS,tabForPath} from '/src/app/routes.ts';
import {WorkspaceShell} from '/src/components/layout/ProductShells.tsx';
import Sidebar from '/src/components/Sidebar.tsx'; import AdminDashboard from '/src/components/AdminDashboard.tsx';
import Dashboard from '/src/components/Dashboard.tsx'; import {useAuth} from '/src/contexts/AuthContext'; import '/src/index.css';
import {AdminRefreshProvider} from '/src/components/admin/AdminRefresh.tsx'; import {useAdminData} from '/src/components/admin/useAdminData.ts';
function RefreshProbe(){const state=useAdminData(signal=>new Promise((resolve,reject)=>{window.__probeCalls=(window.__probeCalls||0)+1;const timer=setTimeout(()=>resolve('Probe ready'),400);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'))},{once:true})}));return <><h1>Refresh probe</h1><p>{state.data||'Pending probe'}</p></>}
function App(){const location=useLocation(),navigate=useNavigate(),{user}=useAuth();const [open,setOpen]=useState(innerWidth>=1024),[theme,setTheme]=useState('light');
const setTab=tab=>navigate(TAB_PATHS[tab]);return <WorkspaceShell theme={theme} onToggleTheme={()=>{const next=theme==='light'?'dark':'light';setTheme(next);document.documentElement.classList.toggle('dark',next==='dark')}} sidebarOpen={open} onToggleSidebar={()=>setOpen(value=>!value)} onHome={()=>navigate('/app')} userLabel={user?.email} onSettings={()=>setTab('settings')} onLogout={()=>{}} onLogin={()=>{}} onRegister={()=>{}}
sidebar={<Sidebar isOpen={open} onClose={()=>setOpen(false)} activeTab={tabForPath(location.pathname)} setActiveTab={setTab} onOpenHelp={()=>{}}/>}>
{location.pathname.startsWith('/admin')?<AdminDashboard/>:location.pathname==='/app'?<Dashboard onOpenSeoAudit={()=>setTab('seo-audit')} onOpenReports={()=>setTab('reports')} onOpenImports={()=>setTab('imports')} onOpenSecurityAudit={()=>setTab('security-audit')}/>:location.pathname==='/app/refresh-probe'?<AdminRefreshProvider polling={false} controls={false}><RefreshProbe/></AdminRefreshProvider>:<h1>Route fixture</h1>}</WorkspaceShell>}
createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);`;
const fixtures = {
  name: 'navigation-overview-fixtures', enforce: 'pre',
  resolveId(source) {
    if (source.endsWith('/contexts/AuthContext')) return '\0fixture-auth';
    if (source.endsWith('/api/auth-headers')) return '\0fixture-headers';
    if (source.endsWith('/blog/BlogNotificationInbox')) return '\0fixture-inbox';
    if (source === '/__navigation_entry.jsx') return '\0fixture-entry.jsx';
  },
  async load(id) {
    if (id === '\0fixture-auth') return `export function useAuth(){return {user:window.__uiRole==='guest'?null:{id:'${userId}',role:window.__uiRole||'admin',email:'operator@example.test',plan:'free',auditQuotaUsedDaily:1,auditQuotaUsedMonthly:4,auditEntitlements:{dailyAudits:3,monthlyAudits:30}}}}`;
    if (id === '\0fixture-headers') return 'export async function getAuthHeaders(base={}){return base}';
    if (id === '\0fixture-inbox') return 'export default function Inbox(){return null}';
    if (id === '\0fixture-entry.jsx') return (await transform(entry, { loader: 'jsx', jsx: 'automatic', format: 'esm' })).code;
  },
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!/^\/(admin|app)(\/|\?|$)/.test(req.url || '')) return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml(req.url, '<html lang="en"><head><title>Navigation and overview check</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__navigation_entry.jsx"></script></body></html>'));
    });
  },
};

const server = await createServer({ configFile: false, plugins: [fixtures, react(), tailwindcss()], define: { __CRAWLIO_RELEASE__: '"navigation-check"', __CRAWLIO_ENVIRONMENT__: '"test"' }, server: { host: '127.0.0.1', port: 5198, strictPort: false }, logLevel: 'error' });
let browser;
const counts = new Map();
let concurrent = 0;
let maximumConcurrent = 0;
let latency = 30;
let failOperations = false;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/tools/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/tools/', '');
    counts.set(path, (counts.get(path) || 0) + 1);
    let data = {};
    let status = 200;
    if (path === 'admin/operations') {
      concurrent++; maximumConcurrent = Math.max(maximumConcurrent, concurrent);
      await new Promise(resolve => setTimeout(resolve, latency)); concurrent--;
      data = operation;
      if (failOperations) status = 503;
    } else if (path === 'admin/plans') data = [plan];
    else if (path === 'admin/workers') data = [worker];
    else if (path === 'admin/platform/settings') data = { id: 'settings', platform_name: 'Crawlio', support_email: 'support@example.test', value: {} };
    else if (path === 'admin/resources') data = { observedAt: now, relations: [], quotaAvailability: 'provider-dashboard-only' };
    else if (path === 'admin/search') data = { users: [], audits: [], schedules: [] };
    else if (path === 'admin/actions') data = { rows: [], hasMore: false };
    else if (path === 'admin/audits' || path === 'admin/users') data = { rows: [], hasMore: false };
    else if (path === 'projects/overview') data = { projects: [project], unreadNotifications: 0, scheduledAuditsEnabled: true, generatedAt: now };
    else if (path === `admin/audits/${auditId}/detail`) data = { audit: { id: auditId, normalizedUrl: 'https://example.test', status: 'failed' }, diagnostics: [], failureClass: 'target-site', retryEligible: true, worker: null };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { success: true, data } : { success: false, error: 'Fixture refresh failed' }) }).catch(() => {});
  });
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  const goto = async path => { await page.goto(`${origin}${path}`); await page.locator('h1').waitFor(); };
  const count = path => counts.get(path) || 0;
  const settle = () => new Promise(resolve => setTimeout(resolve, 120));
  const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('workspace-content').scrollWidth <= document.getElementById('workspace-content').clientWidth), true, 'Workspace must not overflow horizontally');
  const axe = async () => assert.deepEqual((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) })), [], 'WCAG A/AA check');

  await goto('/admin');
  await page.getByText('75.0%', { exact: true }).waitFor();
  assert.equal(count('admin/operations'), 1, 'Overview mounts with one load');
  assert.deepEqual(await page.getByRole('navigation', { name: 'Admin primary navigation' }).locator(':scope > a').allTextContents(), ['Overview', 'Users', 'Audits', 'Content', 'Operations', 'Settings']);
  assert.equal(await page.locator('.admin-stat').count(), 4);
  assert.equal(await page.getByText('api ready', { exact: true }).count(), 0, 'Collapsed evidence is not mounted');
  assert.equal(await page.getByRole('heading', { name: 'Administrator activity' }).count(), 0);
  assert.equal(count('admin/actions'), 0);
  assert.equal(await page.locator('.admin-stat').evaluateAll(nodes => nodes.every(node => parseFloat(getComputedStyle(node).borderRadius) <= 8)), true);
  await noOverflow();
  await axe();
  await page.screenshot({ path: 'test-results/navigation-overview-desktop.png', fullPage: true });

  await page.clock.install();
  await page.getByLabel('Admin auto-refresh interval').selectOption('15');
  let before = count('admin/operations');
  await page.clock.fastForward(15000); await settle();
  assert.equal(count('admin/operations'), before + 1, 'Interval refresh loads once');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  before = count('admin/operations');
  await page.clock.fastForward(60000); await settle();
  assert.equal(count('admin/operations'), before, 'Hidden tabs do not poll');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  await settle();
  assert.equal(count('admin/operations'), before + 1, 'Focus and visibility share one refresh');
  await page.clock.fastForward(500);
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await settle();
  assert.equal(count('admin/operations'), before + 1, 'Return-to-tab events are coalesced');
  await page.getByLabel('Admin auto-refresh interval').selectOption('0');
  before = count('admin/operations');
  await page.clock.fastForward(60000);
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); }); await settle();
  assert.equal(count('admin/operations'), before, 'Off stays off on focus');

  const search = page.getByRole('searchbox', { name: 'Search accounts, audits, and schedules' });
  await search.fill('example'); await page.clock.fastForward(400); await page.getByText('No users found.', { exact: true }).waitFor();
  const beforeSearch = count('admin/search');
  await page.getByRole('button', { name: 'Refresh current admin section' }).click(); await settle();
  assert.equal(count('admin/search'), beforeSearch + 1, 'Manual refresh includes nonpolling data');
  await page.getByLabel('Admin auto-refresh interval').selectOption('15');
  await page.clock.fastForward(15000); await settle();
  assert.equal(count('admin/search'), beforeSearch + 1, 'Search results do not automatically poll');
  await page.getByRole('button', { name: 'Close search results' }).click();
  await page.getByLabel('Admin auto-refresh interval').selectOption('0');

  await page.getByText('Recent failures', { exact: true }).click();
  await page.getByRole('button', { name: 'example.test', exact: true }).waitFor();
  assert.equal(count(`admin/audits/${auditId}/detail`), 0);
  await page.getByRole('button', { name: 'example.test', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(count(`admin/audits/${auditId}/detail`), 1, 'Audit details load on demand');
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByText('Recent failures', { exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'example.test', exact: true }).count(), 0, 'Closing evidence unmounts it');
  failOperations = true;
  await page.getByRole('button', { name: 'Refresh current admin section' }).click(); await page.getByText('Refresh failed; showing stale data').waitFor();
  await page.getByText('75.0%', { exact: true }).waitFor();
  failOperations = false; latency = 300;
  await page.getByRole('button', { name: 'Refresh current admin section' }).click({ clickCount: 3 }); await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(maximumConcurrent, 1, 'Refresh requests never overlap');

  await goto('/admin/plans?marker=keep'); await page.getByRole('heading', { name: 'Plan limits', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Admin auto-refresh interval').count(), 0, 'Config has no polling control');
  before = count('admin/plans');
  await page.clock.fastForward(120000); await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); }); await settle();
  assert.equal(count('admin/plans'), before, 'Plans do not poll or refresh on focus');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Plans', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get('marker'), 'keep', 'Active context link preserves URL filters');
  await page.getByRole('button', { name: 'Refresh current admin section' }).click(); await settle();
  assert.equal(count('admin/plans'), before + 1, 'Config manual refresh still works');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Platform settings', exact: true }).click();
  await page.getByLabel('Platform name', { exact: true }).waitFor(); await settle();
  const settingsBefore = count('admin/platform/settings'), resourcesBefore = count('admin/resources');
  await page.clock.fastForward(120000); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await settle();
  assert.equal(count('admin/platform/settings'), settingsBefore); assert.equal(count('admin/resources'), resourcesBefore);

  await goto('/admin/workers'); await page.getByRole('navigation', { name: 'Operations sections' }).waitFor();
  assert.deepEqual(await page.getByRole('navigation', { name: 'Operations sections' }).getByRole('link').allTextContents(), ['Queue', 'Workers', 'Diagnostics']);
  await page.setViewportSize({ width: 390, height: 844 }); await goto('/admin'); await page.getByText('75.0%', { exact: true }).waitFor();
  assert.equal(await page.getByRole('navigation', { name: 'Admin primary navigation' }).count(), 0, 'Mobile has no duplicate navigation rail');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Help', 'Drawer traps reverse Tab');
  await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Close navigation');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Open navigation', 'Escape restores the trigger');
  await noOverflow(); await axe();
  await page.screenshot({ path: 'test-results/navigation-overview-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.clock.fastForward(400); await new Promise(resolve => setTimeout(resolve, 400));
  await axe(); await noOverflow();
  await page.screenshot({ path: 'test-results/navigation-overview-vanta.png', fullPage: true });

  await page.addInitScript(() => { window.__uiRole = 'user'; });
  await page.setViewportSize({ width: 1280, height: 900 });
  await goto(`/app/audits/${auditId}/seo?severity=critical&issue=missing-title`);
  assert.deepEqual(await page.getByRole('navigation', { name: 'Main navigation', exact: true }).locator(':scope > div > a').allTextContents(), ['Dashboard', 'Projects', 'Audits', 'Search Data', 'Tools']);
  await page.getByRole('link', { name: 'Technical SEO', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, `/app/audits/${auditId}/technical`); assert.equal(new URL(page.url()).searchParams.get('severity'), 'critical');
  await goto('/app/imports');
  assert.deepEqual(await page.getByRole('list', { name: 'Search Data views' }).getByRole('link').allTextContents(), ['Search performance', 'Imports', 'Rankings']);
  assert.equal(await page.getByRole('link', { name: 'Administration', exact: true }).count(), 0, 'Admin entry stays role protected');
  await goto('/app'); await page.getByText(project.recommendedAction, { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Recent audits', exact: true }).count(), 0, 'Dashboard details mount on demand');
  await page.getByRole('button', { name: 'Open latest report', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('crawlio_selected_report_id')), auditId, 'Current project report selection is retained');
  await goto('/app'); await page.getByText(project.recommendedAction, { exact: true }).waitFor();
  await noOverflow();
  await page.screenshot({ path: 'test-results/navigation-dashboard-desktop.png', fullPage: true });
  const dashboardAccessibility = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations;
  assert.deepEqual(dashboardAccessibility.map(item => ({ id: item.id, count: item.nodes.length })), [{ id: 'select-name', count: 1 }], 'Only the unchanged ProjectCockpit schedule-label issue remains');
  assert.match(dashboardAccessibility[0].nodes[0].html, /select/, 'Baseline accessibility gap is the existing project schedule select');
  await page.getByText('Saved audit details', { exact: true }).click();
  await page.getByRole('heading', { name: 'Recent audits', exact: true }).waitFor();
  await page.getByText('Saved audit details', { exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: 'Recent audits', exact: true }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 }); await goto('/app');
  await page.getByText(project.recommendedAction, { exact: true }).waitFor(); await noOverflow();
  await page.screenshot({ path: 'test-results/navigation-dashboard-mobile.png', fullPage: true });
  await goto('/admin'); await page.getByRole('heading', { name: 'Admin access required', exact: true }).waitFor();
  await goto('/app/refresh-probe');
  assert.equal(await page.evaluate(() => window.__probeCalls), 1);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); }); await settle();
  assert.equal(await page.evaluate(() => window.__probeCalls), 2, 'A quick return retries an aborted initial load even with polling disabled');
  await page.clock.fastForward(500); await page.getByText('Probe ready', { exact: true }).waitFor();
  await page.clock.fastForward(120000); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await settle();
  assert.equal(await page.evaluate(() => window.__probeCalls), 2, 'Successful nonpolling data stays quiet');
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log('PASS: grouped navigation, contextual routes/filters, lazy evidence/details, four metrics, interval/focus dedupe, Off/hidden/manual/config refresh, stale data, request overlap, mobile drawer keyboard, role guard, project report workflow, desktop/mobile overflow, and admin light/Vanta WCAG A/AA checks.');
  console.log('BASELINE GAP: ProjectCockpit has one unlabeled audit-schedule select; the component is outside this change scope.');
} finally { await browser?.close(); await server.close(); }
