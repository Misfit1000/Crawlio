import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPublicAuditExport, csvCell, csvRow } from '../src/lib/report/export';
import type { ResourceAuditLiveData } from '../src/lib/audit/resource-types';

for (const value of ['=SUM(1,1)', '+cmd', '-2+3', '@example', '  =HYPERLINK("bad")']) {
  assert.ok(csvCell(value).startsWith('"\''), `${value} must be neutralized before CSV export.`);
}
assert.equal(csvRow(['safe', 'a"b']), '"safe","a""b"');

const data = {
  audit: {
    id: 'audit-export-test', userId: null, guestKeyHash: 'must-not-export', projectId: null,
    submittedInput: 'example.com', normalizedUrl: 'https://example.com/', finalUrl: 'https://example.com/', hostname: 'example.com',
    mode: 'quick', plan: 'free', requestedMode: 'quick', effectiveMode: 'quick', queuePriority: 10, processingTier: 'free', quotaCounted: true,
    workerRuntime: 'must-not-export', estimatedWaitSeconds: null, status: 'completed', progress: 100, currentPhase: 'Report ready', currentUrl: null,
    currentCheck: null, pageLimit: 5, pagesDiscovered: 1, pagesCrawled: 1, checksTotal: 1, checksCompleted: 1, issuesFound: 0,
    criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, createdAt: new Date(0).toISOString(), updatedAt: new Date(1).toISOString(),
    startedAt: new Date(0).toISOString(), completedAt: new Date(1).toISOString(), expiresAt: new Date(2).toISOString(), cancelledAt: null, error: null,
    lockedBy: 'must-not-export', lockedAt: new Date(0).toISOString(), leaseExpiresAt: new Date(2).toISOString(),
  },
  latestEvents: [], latestPages: [], latestIssues: [], finalReport: null,
} satisfies ResourceAuditLiveData;

const exported = buildPublicAuditExport(data);
assert.ok(exported);
const serialized = JSON.stringify(exported);
for (const secretField of ['guestKeyHash', 'lockedBy', 'lockedAt', 'leaseExpiresAt', 'workerRuntime']) {
  assert.ok(!serialized.includes(secretField), `${secretField} must not appear in the public JSON export.`);
}

const api = await readFile('src/api/index.ts', 'utf8');
const exportRoute = api.slice(api.indexOf("apiRouter.get('/audit/export/:id/:format'"), api.indexOf("apiRouter.post('/audit/rerun/:id'"));
assert.ok(exportRoute.indexOf('auditRepository.getAudit(id)') < exportRoute.indexOf('auditRepository.getLiveData(id, audit)'), 'export ownership must be checked before child evidence is loaded');
assert.match(exportRoute, /limits\.pdfEnabled/);
assert.match(exportRoute, /limits\.exportsEnabled/);
assert.match(exportRoute, /Cache-Control', 'private, no-store/);

console.log('Audit export safety smoke test passed.');
