import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultActivityLayout, parseActivityLayout } from '../src/lib/ui/activity-layout';

const source = await readFile('src/components/audit/AuditActivityPanel.tsx', 'utf8');
const live = await readFile('src/components/audit/LiveAuditProgress.tsx', 'utf8');
const workspace = await readFile('src/components/audit/AuditWorkspace.tsx', 'utf8');

assert.equal(defaultActivityLayout({ width: 1440, height: 900 }).open, false, 'Activity must remain collapsed on first use');
assert.equal(parseActivityLayout('{invalid', { width: 1440, height: 900 }).snap, 'right', 'invalid preferences must reset safely');
assert.match(source, /role="dialog"/);
assert.match(source, /event\.key === 'Escape'/);
assert.match(source, /customerSafeDiagnosticText/);
assert.match(source, /warning_summary/);
assert.match(source, /data-activity-panel/);
assert.match(live, /<AuditActivityPanel events=\{data\.latestEvents\}/);
assert.match(workspace, /<AuditActivityPanel events=\{data\.latestEvents\}/);
assert.doesNotMatch(source, /fixed bottom-5 right-4/);
console.log('Floating Activity panel smoke test passed.');
