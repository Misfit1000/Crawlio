import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectAuditAdmission, projectAuditStatus, snapshotFromAdmission } from './audit-admission';
import type { ResourceAuditDocument } from './resource-types';

const audit = {
  id: 'new-job', hostname: 'example.com', normalizedUrl: 'https://example.com/', mode: 'quick',
  status: 'queued', progress: 0, pagesCrawled: 0, issuesFound: 0, pageLimit: 5,
  guestKeyHash: 'private-identity', lockedBy: 'private-worker', checkpointState: { secret: true },
} as unknown as ResourceAuditDocument;

test('new admission seeds truthful queue state without private worker or guest fields', () => {
  const summary = projectAuditAdmission(audit);
  assert.equal('guestKeyHash' in summary, false);
  assert.equal('lockedBy' in summary, false);
  assert.equal('checkpointState' in summary, false);
  const snapshot = snapshotFromAdmission({ auditId: audit.id, initialAudit: summary });
  assert.equal(snapshot?.audit?.status, 'queued');
  assert.equal(snapshot?.audit?.progress, 0);
  assert.equal(snapshot?.audit?.pagesCrawled, 0);
  assert.deepEqual(snapshot?.latestPages, []);
  assert.equal(snapshot?.finalReport, null);
});

test('reopened or mismatched admissions never imply empty evidence', () => {
  const initialAudit = projectAuditAdmission(audit);
  assert.equal(snapshotFromAdmission({ auditId: audit.id, initialAudit, reusedExistingAudit: true }), undefined);
  assert.equal(snapshotFromAdmission({ auditId: 'other-job', initialAudit }), undefined);
  assert.equal(snapshotFromAdmission({ auditId: 'old-compatible-response' }), undefined);
});

test('compact status retains measured progress but excludes private and oversized state', () => {
  const summary = projectAuditStatus({ ...audit, pagesCrawled: 12, issuesFound: 34,
    presentationSummary: { version: 1 }, checkpointPagesCrawled: 12 } as unknown as ResourceAuditDocument);
  assert.equal(summary.pagesCrawled, 12);
  assert.equal(summary.issuesFound, 34);
  assert.equal(summary.checkpointPagesCrawled, 12);
  for (const key of ['guestKeyHash', 'lockedBy', 'checkpointState', 'ipHash', 'leaseUntil']) {
    assert.equal(key in summary, false);
  }
});
