import { createServer, type Plugin } from 'vite';
import { AUDIT_ID, auditSnapshot, publicPlanFixture } from '../../../../tests/e2e/helpers';

export const auditId = AUDIT_ID;
export const summary = { version: 1, scope: 'complete', analysedPages: 60, attemptedPages: 60, responseOutcomes: { success: 57, redirect: 1, clientError: 1, serverError: 1, unavailable: 0 }, delivery: { count: 60, totalResponseMs: 0, totalBytes: 0, averageResponseMs: 0, averagePageBytes: 0 }, pagesWithFindings: 40, depthCounts: { '0': 1, '1': 59 }, findingsBySection: { 'on-page': 40, security: 1 }, topRecommendations: [{ key: 'title', title: 'Missing page title', category: 'on_page', severity: 'high', affectedPages: 40, recommendation: 'Add descriptive page titles.' }], updatedAt: '2026-10-01T00:00:00.000Z' };
export const auditFixture: any = auditSnapshot();
auditFixture.audit = { ...auditFixture.audit, pagesCrawled: 60, pagesDiscovered: 80, pageLimit: 100, processingVersion: 2, presentationSummary: summary };
auditFixture.latestPages = Array.from({ length: 60 }, (_, index) => ({ ...auditFixture.latestPages[0], id: `page-${index}`, title: `Page ${index}`, url: `https://example.com/${index}`, crawlDepth: index ? 1 : 0, sourceUrl: index ? 'https://example.com/0' : undefined }));
auditFixture.finalReport.presentationSummary = summary;
auditFixture.finalReport.scores.seo = 78;

export function historyFixture(result = auditFixture) {
  return { items: [{ audit: result.audit, finalReport: result.finalReport }, { audit: { ...result.audit, id: 'baseline-audit', createdAt: '2026-09-01T00:00:00.000Z' }, finalReport: result.finalReport }], total: 2, limit: 12, offset: 0 };
}

function scenarioFixture(scenario: string | null) {
  const data = structuredClone(auditFixture);
  if (scenario === 'sample') { delete data.audit.presentationSummary; delete data.finalReport.presentationSummary; }
  if (scenario === 'focused') {
    const scope = { version: 1, coverage: 'page', focus: 'seo', checkGroups: ['seo'] };
    Object.assign(data.audit, { scope, pagesCrawled: 1, pagesDiscovered: 1, pageLimit: 1, planPageLimit: 50, presentationSummary: undefined });
    data.finalReport.scope = scope;
    delete data.finalReport.presentationSummary;
    data.latestPages = data.latestPages.slice(0, 1);
  }
  if (scenario === 'running' || scenario === 'queued') {
    const timestamp = new Date().toISOString();
    Object.assign(data.audit, { status: scenario, progress: scenario === 'running' ? 45 : 0, currentPhase: scenario === 'running' ? 'Checking pages' : 'Queued', createdAt: new Date(Date.now() - 42000).toISOString(), startedAt: scenario === 'running' ? new Date(Date.now() - 40000).toISOString() : null, updatedAt: timestamp, completedAt: null, currentUrl: data.latestPages[0].url, currentCheck: 'Page titles' });
    data.latestEvents = [{ id: `fixture-${scenario}`, type: 'progress_update', timestamp, message: data.audit.currentPhase }];
    if (scenario === 'running') data.latestEvents.push({ id: 'fixture-score', type: 'score_updated', timestamp, message: 'Page checks recorded', data: { scoreState: 'provisional', overallScore: 78, categoryScores: { onPage: 74, technical: 88, crawlability: 82, performance: 84, internalLinks: 80, security: 90, structuredData: 78, accessibility: 76 }, pagesAnalysed: 60, pagesDiscovered: 80, pageLimit: 100 } });
    data.finalReport = null;
  }
  if (scenario === 'failed' || scenario === 'cancelled' || scenario === 'completed_with_warnings') Object.assign(data.audit, { status: scenario, warningCount: 1, error: scenario === 'failed' ? 'Target response timed out.' : null });
  if (scenario === 'failed' || scenario === 'cancelled') data.finalReport = null;
  return data;
}

const fixturePlugin: Plugin = {
  name: 'audit-ui-fixture', enforce: 'pre',
  resolveId(source) { if (source.endsWith('AuthContext')) return '\0audit-ui-auth'; },
  load(id) {
    if (id !== '\0audit-ui-auth') return;
    return `const user={id:'fixture-user',username:'Reviewer',fullName:'UI Reviewer',email:'reviewer@example.test',role:'user',plan:'paid',subscriptionStatus:'active',auditEntitlements:{allowedModes:['quick','standard'],availableModes:['quick','standard'],pageLimits:{quick:25,standard:50,deep:0},exportsEnabled:true,pdfEnabled:true,scheduledAuditsEnabled:false,unavailableReasons:{}}}; export function AuthProvider({children}){return children} export function useAuth(){return {user,loading:false,profilePending:false,logout:async()=>{},refreshAuditEntitlements:async()=>user.auditEntitlements,setUnverifiedEmail:()=>{}}}`;
  },
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (!url.pathname.startsWith('/api/')) return next();
      const scenario = new URL(request.headers.referer || '/', 'http://127.0.0.1').searchParams.get('fixture');
      const data = scenarioFixture(scenario);
      let payload: unknown = null;
      if (url.pathname.includes('/plans/public')) payload = publicPlanFixture();
      else if (url.pathname.includes('/audits/history')) payload = historyFixture(data);
      else if (url.pathname.includes('/shared-reports/')) payload = { audit: data.audit, report: data.finalReport, pages: data.latestPages, issues: data.latestIssues, expiresAt: '2026-12-01T00:00:00.000Z' };
      else if (url.pathname.includes('/finding-workflow')) { response.statusCode = 401; }
      else if (url.pathname.includes('/evidence/')) payload = { items: url.pathname.endsWith('/pages') ? data.latestPages.slice(0, 50) : url.searchParams.get('section') === 'security' ? [] : data.latestIssues, total: url.pathname.endsWith('/pages') ? data.latestPages.length : data.latestIssues.length, nextCursor: null };
      else if (url.pathname.includes('/audit/compare/')) payload = { scoreDelta: 3, newIssues: [], resolvedIssues: [], persistentIssues: data.latestIssues };
      else if (url.pathname.includes('/audit/export/')) { response.setHeader('Content-Disposition', 'attachment; filename="audit.json"'); payload = data; }
      else if (/\/audit\/(result|status|events)\//.test(url.pathname)) payload = data;
      else { response.statusCode = 503; }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(payload ? { success: true, data: payload } : { success: false, error: 'No optional fixture data.' }));
    });
  },
};

export async function startAuditUiFixture(port = 5176) {
  const server = await createServer({ plugins: [fixturePlugin], server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null } });
  await server.listen();
  return server;
}

if (process.argv.includes('--serve')) {
  const server = await startAuditUiFixture(Number(process.env.AUDIT_UI_PORT || 5176));
  server.printUrls();
  console.log(`Fixture routes: /audit/live/${auditId}, /app/audits/${auditId}/overview, /app/reports, /app/audits/history, /share/${'a'.repeat(48)}. Add ?fixture=running, queued, sample, focused, failed, cancelled, or completed_with_warnings.`);
}
