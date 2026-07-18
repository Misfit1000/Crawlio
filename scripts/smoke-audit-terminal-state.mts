import assert from 'node:assert/strict';
import type { ResourceAuditDocument, ResourceAuditEvent, ResourceAuditIssue, ResourceAuditPage } from '../src/lib/audit/resource-types.ts';
import { deriveAuditTerminalPresentation } from '../src/lib/audit/audit-terminal-presentation.ts';
import { isTerminalAuditStatus } from '../src/lib/audit/audit-time.ts';
import { AuditWriteBatch, type AuditWriteSink } from '../src/workers/audit-write-batch.ts';

const patches: Array<Partial<ResourceAuditDocument>> = [];
const sink: AuditWriteSink = {
  async updateAudit(_id, patch) { patches.push(patch); },
  async appendPages(_id, pages) { return pages.map((page, index) => ({ ...page, id: page.id || `page-${index}` } as ResourceAuditPage)); },
  async appendIssues(_id, issues) { return issues.map((issue, index) => ({ ...issue, id: issue.id || `issue-${index}`, detectedAt: issue.detectedAt || new Date().toISOString() } as ResourceAuditIssue)); },
  async appendEvents(_id, events) { return events.map((event, index) => ({ ...event, id: `event-${index}`, type: event.type || 'progress_update', timestamp: new Date().toISOString(), message: event.message || '' } as ResourceAuditEvent)); },
};

const writer = new AuditWriteBatch('terminal-test', sink, { progressThrottleMs: 0 });
await writer.writeProgress({ progress: 60, status: 'running' });
await writer.writeProgress({ progress: 25, status: 'running' });
await writer.writeProgress({ progress: 100, status: 'completed_with_warnings', completedAt: new Date().toISOString(), lockedBy: null, leaseExpiresAt: null }, undefined, { force: true });

assert.deepEqual(patches.map((patch) => patch.progress), [60, 60, 100], 'progress must be monotonic and end at 100');
assert.equal(patches.at(-1)?.status, 'completed_with_warnings');
for (const status of ['completed', 'completed_with_warnings', 'failed', 'cancelled'] as const) assert.equal(isTerminalAuditStatus(status), true);
for (const status of ['queued', 'running'] as const) assert.equal(isTerminalAuditStatus(status), false);

assert.equal(deriveAuditTerminalPresentation('queued'), 'none');
assert.equal(deriveAuditTerminalPresentation('running'), 'none');
assert.equal(deriveAuditTerminalPresentation('completed'), 'none');
assert.equal(deriveAuditTerminalPresentation('completed_with_warnings'), 'none');
assert.equal(deriveAuditTerminalPresentation('completed', true), 'preparing');
assert.equal(deriveAuditTerminalPresentation('completed_with_warnings', true), 'preparing');
assert.equal(deriveAuditTerminalPresentation('failed'), 'failed');
assert.equal(deriveAuditTerminalPresentation('cancelled'), 'cancelled');
assert.equal(deriveAuditTerminalPresentation('abandoned'), 'abandoned');

console.log('Audit terminal-state smoke test passed.');
