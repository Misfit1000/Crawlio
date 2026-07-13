import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile('src/components/audit/AuditWorkspace.tsx', 'utf8');
const summary = await readFile('src/components/audit/AuditExecutiveSummary.tsx', 'utf8');
const findings = await readFile('src/components/audit/FindingWorkspace.tsx', 'utf8');
const liveAudit = await readFile('src/components/audit/LiveAuditProgress.tsx', 'utf8');

for (const section of ['overview', 'seo', 'technical', 'crawlability', 'links', 'performance', 'security', 'pages']) {
  assert.match(workspace, new RegExp(`id: '${section}'`), `${section} must remain available`);
}
assert.match(workspace, /<AuditExecutiveSummary/);
assert.match(workspace, /<PriorityRecommendations/);
assert.match(workspace, /Compare with an earlier audit/);
assert.match(workspace, /downloadAuditExport\(auditId, 'pdf'\)/);
assert.match(workspace, /downloadAuditExport\(auditId, 'json'\)/);
assert.match(summary, /Fix priority/);
assert.match(summary, /Pages analysed/);
assert.match(summary, /Checks completed/);
assert.match(summary, /Unavailable/);
assert.doesNotMatch(liveAudit, /estimatedScore/, 'Live audits must not invent a provisional score.');
assert.match(liveAudit, /data\.finalReport \? finalOverallScore : null/);
assert.match(findings, /Previous/);
assert.match(findings, /Next/);
assert.match(findings, /Implementation note/);
assert.match(findings, /Affected and source pages/);
console.log('Premium audit workspace smoke test passed.');
