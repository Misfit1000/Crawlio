import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { auditWorkspacePath, parseAuditWorkspacePath } from '../src/app/routes';

const sections = ['overview', 'seo', 'technical', 'crawlability', 'links', 'performance', 'security', 'pages'] as const;
for (const section of sections) {
  const path = auditWorkspacePath('workspace-audit', section);
  assert.deepEqual(parseAuditWorkspacePath(path), { auditId: 'workspace-audit', section });
}

const source = await readFile(new URL('../src/components/audit/AuditWorkspace.tsx', import.meta.url), 'utf8');
assert.match(source, /AuditWorkspaceProvider/);
assert.match(source, /Compare with an earlier audit/);
assert.match(source, /grid gap-4 xl:grid-cols-2/);
assert.doesNotMatch(source, /readAuditHistory/);
console.log('Routed report workspace smoke test passed.');
