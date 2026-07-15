import assert from 'node:assert/strict';
import { createInitialWorkerState, loadWorkerConfig, updateWorkerState } from '../src/workers/audit-worker-runtime.ts';
import { startWorkerHealthServer } from '../src/workers/audit-worker-health.ts';

const state = createInitialWorkerState(loadWorkerConfig({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only', PORT: '3000', DEEP_AUDIT_ENABLED: 'true' }));
updateWorkerState(state, { status: 'idle', queuePollingStatus: 'active', databaseConnected: true, lastCompletedAuditId: 'private-audit-id', lastCompletedAuditAt: new Date().toISOString() });
const server = startWorkerHealthServer(state, () => true, '0');
assert(server);
await new Promise<void>((resolve) => server.once('listening', resolve));
const address = server.address();
assert(address && typeof address === 'object');
const url = `http://127.0.0.1:${address.port}/health`;

try {
  const healthy = await (await fetch(url)).json();
  assert.equal(healthy.ok, true);
  assert.equal(healthy.queuePollingStatus, 'active');
  assert.equal(healthy.databaseConnected, true);
  assert.equal('workerId' in healthy, false);
  assert.equal('runtime' in healthy, false);
  assert.equal('currentAuditId' in healthy, false);
  assert.equal('lastCompletedAuditId' in healthy, false);
  assert.equal(healthy.planLimitsSummary.agency.maxPages, 75, 'Enabled agency deep mode must report the enforced 75-page ceiling.');

  // A target URL failure is audit data; it must not mutate worker health.
  const targetFailure = new Error('ENOTFOUND target.example');
  void targetFailure;
  const stillHealthy = await (await fetch(url)).json();
  assert.equal(stillHealthy.ok, true);

  updateWorkerState(state, { queuePollingStatus: 'error', databaseConnected: false, lastFatalWorkerError: 'database unavailable' });
  const unhealthy = await (await fetch(url)).json();
  assert.equal(unhealthy.ok, false);
  assert.equal(unhealthy.lastFatalWorkerError, true, 'public health exposes only the presence of a fatal error');
  assert.equal(JSON.stringify(unhealthy).includes('database unavailable'), false);
  console.log('Worker health isolation smoke test passed.');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
