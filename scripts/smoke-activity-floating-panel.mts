import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panel = await readFile('src/components/audit/AuditActivityPanel.tsx', 'utf8');
const live = await readFile('src/components/audit/LiveAuditProgress.tsx', 'utf8');
const workspace = await readFile('src/components/audit/AuditWorkspace.tsx', 'utf8');

assert.match(panel, /createPortal/);
assert.match(panel, /data-activity-panel/);
assert.match(panel, /Collapse audit activity/);
assert.match(panel, /Filter audit activity/);
assert.match(panel, /Reset layout/);
assert.match(panel, /aria-live="polite"/);
assert.ok(live.indexOf('<AuditActivityPanel') < live.indexOf('<PageHeader'), 'Live Activity must reserve the top rail before audit commands');
assert.ok(live.indexOf('<AuditActivityPanel') < live.indexOf('<SitePreviewSection'), 'Live Activity must appear before report content');
assert.ok(workspace.indexOf('<AuditActivityPanel') < workspace.indexOf('<header className='), 'Stored Activity must reserve the top rail before audit commands');
assert.ok(workspace.indexOf('<AuditActivityPanel') < workspace.indexOf('<nav className='), 'Stored Activity must be mounted near the command area');
assert.doesNotMatch(panel, /inset-x-0 bottom-0.*bottom sheet/);
console.log('Activity floating-layer smoke test passed.');
