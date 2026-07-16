import assert from 'node:assert/strict';
import { alertFingerprint, buildOperationalHealth, buildSafeAlertPayload, shouldSendOperationalAlert } from '../src/lib/operations/health';

const now = Date.parse('2026-07-16T12:00:00.000Z');
const compatibility = {
  expected: { commitIdentifier: 'abc123', apiSchemaVersion: 13, auditEngineVersion: '2026.07', scoringVersion: '2.0' },
  database: { api_schema_version: 13 },
  worker: null,
};
const healthy = buildOperationalHealth({
  nowMs: now,
  compatibility,
  workers: [{ updated_at: '2026-07-16T11:59:30.000Z', value: { commitIdentifier: 'abc123', databaseConnected: true, deepAuditEnabled: false } }],
  audits: [
    { status: 'completed', created_at: '2026-07-16T11:50:00.000Z', started_at: '2026-07-16T11:50:02.000Z', completed_at: '2026-07-16T11:50:12.000Z', used_http_fallback: false },
  ],
  plans: [{ plan: 'free', max_pages_quick: 5 }],
});
assert.equal(healthy.status, 'healthy');
assert.equal(healthy.activeWorkerCount, 1);
assert.equal(healthy.recentCompletionRate, 1);

const critical = buildOperationalHealth({ ...{ compatibility, plans: [] }, nowMs: now, workers: [], audits: [{ status: 'queued', created_at: '2026-07-16T11:40:00.000Z' }] });
assert.equal(critical.status, 'critical');
assert.equal(critical.workerOnline, false);
assert.ok(critical.oldestQueuedAgeSeconds! >= 1200);

const payload = buildSafeAlertPayload(critical);
const serialized = JSON.stringify(payload).toLowerCase();
for (const forbidden of ['url', 'email', 'service_role', 'private_key', 'authorization', 'connection_string', 'stack']) {
  assert.equal(serialized.includes(forbidden), false, `Alert payload contains forbidden field/text: ${forbidden}`);
}
const fingerprint = alertFingerprint(payload);
assert.equal(fingerprint.length, 64);
assert.equal(shouldSendOperationalAlert({ enabled: true, status: 'critical', fingerprint, cooldownMinutes: 60, nowMs: now }), true);
assert.equal(shouldSendOperationalAlert({ enabled: true, status: 'critical', fingerprint, previousFingerprint: fingerprint, cooldownMinutes: 60, nowMs: now }), false);
assert.equal(shouldSendOperationalAlert({ enabled: true, status: 'critical', fingerprint, previousFingerprint: 'different', lastSentAt: '2026-07-16T11:30:00.000Z', cooldownMinutes: 60, nowMs: now }), false);
assert.equal(shouldSendOperationalAlert({ enabled: false, status: 'critical', fingerprint, cooldownMinutes: 60, nowMs: now }), false);
console.log('Operational health and alert safety smoke test passed.');
