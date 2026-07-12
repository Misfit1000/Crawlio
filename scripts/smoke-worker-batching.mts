import assert from 'node:assert/strict';
import type {
  ResourceAuditDocument,
  ResourceAuditEvent,
  ResourceAuditIssue,
  ResourceAuditPage,
} from '../src/lib/audit/resource-types';
import { AuditWriteBatch, type AuditWriteSink } from '../src/workers/audit-write-batch';

const stored = {
  patches: [] as Array<Partial<ResourceAuditDocument>>,
  pages: [] as ResourceAuditPage[],
  issues: [] as ResourceAuditIssue[],
  events: [] as ResourceAuditEvent[],
};

let sequence = 0;
const sink: AuditWriteSink = {
  async updateAudit(_id, patch) {
    stored.patches.push(patch);
  },
  async appendPages(_id, pages) {
    const full = pages.map((page) => ({ id: page.id || `page-${sequence += 1}`, ...page } as ResourceAuditPage));
    stored.pages.push(...full);
    return full;
  },
  async appendIssues(_id, issues) {
    const full = issues.map((issue) => ({
      id: issue.id || `issue-${sequence += 1}`,
      detectedAt: issue.detectedAt || new Date(0).toISOString(),
      ...issue,
    } as ResourceAuditIssue));
    stored.issues.push(...full);
    return full;
  },
  async appendEvents(_id, events) {
    const full = events.map((event) => ({
      id: `event-${sequence += 1}`,
      type: event.type || 'progress_update',
      timestamp: event.timestamp || new Date(0).toISOString(),
      message: event.message || '',
      ...event,
    } as ResourceAuditEvent));
    stored.events.push(...full);
    return full;
  },
};

let now = 1_000;
const writer = new AuditWriteBatch('audit-batch-smoke', sink, {
  pageBatchSize: 10,
  issueBatchSize: 25,
  eventBatchSize: 20,
  progressThrottleMs: 1_000,
  now: () => now,
});

for (let index = 0; index < 50; index += 1) {
  await writer.addPage({
    url: `https://example.com/page-${index}`,
    statusCode: 200,
    responseTimeMs: 100,
    pageSizeBytes: 1_000,
    title: `Page ${index}`,
    metaDescription: '',
    h1: `Page ${index}`,
    wordCount: 200,
    crawlDepth: 1,
    issueCount: 4,
    crawledAt: new Date(0).toISOString(),
  });
  for (let issueIndex = 0; issueIndex < 4; issueIndex += 1) {
    await writer.addIssue({
      severity: issueIndex === 0 ? 'high' : 'medium',
      category: 'seo',
      title: `Finding ${index}-${issueIndex}`,
      description: 'Measured finding',
      affectedUrl: `https://example.com/page-${index}`,
      evidence: 'test evidence',
      recommendation: 'Fix the measured issue.',
    });
  }
  await writer.writeProgress({ progress: 20 + index, pagesCrawled: index + 1 });
}

now += 2_000;
await writer.writeProgress(
  { status: 'cancelled', completedAt: new Date(now).toISOString() },
  { type: 'audit_cancelled', message: 'Partial results retained.' },
);
await writer.flush();

const metrics = writer.getMetrics();
assert.equal(stored.pages.length, 50, 'all queued pages must be flushed');
assert.equal(stored.issues.length, 200, 'all queued issues must be flushed');
assert.ok(metrics.writeOperations < 40, `expected bounded writes, received ${metrics.writeOperations}`);
assert.ok(metrics.progressWrites <= 3, `progress writes should be throttled, received ${metrics.progressWrites}`);
assert.equal(stored.patches.at(-1)?.status, 'cancelled', 'terminal state must be flushed immediately');
assert.ok(stored.events.some((event) => event.type === 'audit_cancelled'), 'terminal event must survive the final flush');
assert.equal(new Set(stored.pages.map((page) => page.id)).size, 50, 'page ids must remain deterministic and unique');

console.log('Worker batching smoke test passed.');
console.log(JSON.stringify(metrics));
