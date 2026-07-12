import assert from 'node:assert/strict';
import { auditWorkspacePath, isWorkspacePath, parseAuditWorkspacePath, tabForPath } from '../src/app/routes';

assert.equal(tabForPath('/app'), 'dashboard');
assert.equal(tabForPath('/app/audits/new'), 'seo-audit');
assert.equal(tabForPath('/app/audits/history'), 'audit-history');
assert.equal(tabForPath('/app/settings'), 'settings');
assert.equal(tabForPath('/admin'), 'admin-dashboard');
assert.equal(isWorkspacePath('/app/audits/example/seo'), true);
assert.deepEqual(parseAuditWorkspacePath('/app/audits/audit-123/security'), { auditId: 'audit-123', section: 'security' });
assert.equal(parseAuditWorkspacePath('/app/audits/history'), null);
assert.equal(auditWorkspacePath('audit id', 'pages'), '/app/audits/audit%20id/pages');

console.log('Application routing smoke test passed.');
