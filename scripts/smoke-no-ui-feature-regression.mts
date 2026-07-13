import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile('src/App.tsx', 'utf8');
const routes = await readFile('src/app/routes.ts', 'utf8');
const live = await readFile('src/components/audit/LiveAuditProgress.tsx', 'utf8');
const workspace = await readFile('src/components/audit/AuditWorkspace.tsx', 'utf8');
const findings = await readFile('src/components/audit/FindingWorkspace.tsx', 'utf8');

assert.match(app, /onRerun=\{startLiveAudit\}/);
assert.match(routes, /auditWorkspacePath/);
assert.match(live, /subscribeToAuditLiveData/);
assert.match(live, /cancelAudit/);
assert.match(live, /downloadPdf/);
assert.match(live, /downloadJson/);
assert.match(live, /compareAuditIssues/);
assert.match(workspace, /AuditWorkspaceProvider/);
assert.match(workspace, /SitePreviewSection/);
assert.match(workspace, /ComparisonPanel/);
assert.match(findings, /Bulk status/);
assert.match(findings, /Filter by workflow status/);
assert.match(findings, /Filter by error type/);
assert.match(findings, /writeFindingNotes/);
console.log('Audit UI feature-retention smoke test passed.');
