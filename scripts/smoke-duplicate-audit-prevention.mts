import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {
  AUDIT_START_DEBOUNCE_MS,
  createAuditSubmitGuard,
} from '../src/lib/api/audit-submit-guard.ts';
import {
  DEFAULT_PLAN_LIMITS,
  resolveEffectiveAuditMode,
} from '../src/lib/billing/entitlements.ts';

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { apiRouter } = await import('../src/api/index.ts');
const { auditRepository } = await import('../src/lib/supabase/audit-repository.ts');

function listen(server: http.Server, port = 0) {
  return new Promise<import('node:net').AddressInfo>((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server.address() as import('node:net').AddressInfo));
  });
}

function close(server: http.Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

async function startAudit(baseUrl: string, url: string, guestId: string, mode = 'quick') {
  const response = await fetch(`${baseUrl}/api/tools/audit/start`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-crawlio-guest-id': guestId,
    },
    body: JSON.stringify({ url, mode }),
  });
  assert.equal(response.headers.get('content-type')?.includes('application/json'), true);
  return response.json() as Promise<any>;
}

const app = express();
app.use(express.json());
app.use('/api/tools', apiRouter);
const apiServer = http.createServer(app);
const apiAddress = await listen(apiServer);
const baseUrl = `http://127.0.0.1:${apiAddress.port}`;

try {
  const guestId = `duplicate-smoke-${Date.now()}`;
  const firstUrl = `https://duplicate-smoke-${Date.now()}.example.com`;
  const secondUrl = `https://second-duplicate-smoke-${Date.now()}.example.com`;

  const first = await startAudit(baseUrl, firstUrl, guestId);
  assert.equal(first.success, true);
  assert.equal(first.data.reusedExistingAudit, false);
  assert.ok(first.data.auditId);

  const duplicate = await startAudit(baseUrl, firstUrl, guestId);
  assert.equal(duplicate.success, true);
  assert.equal(duplicate.data.auditId, first.data.auditId);
  assert.equal(duplicate.data.reusedExistingAudit, true);

  await auditRepository.updateAudit(first.data.auditId, {
    status: 'completed',
    progress: 100,
    completedAt: new Date().toISOString(),
    lockedBy: null,
    lockedAt: null,
    leaseExpiresAt: null,
  });

  const afterCompleted = await startAudit(baseUrl, firstUrl, guestId);
  assert.equal(afterCompleted.success, true);
  assert.notEqual(afterCompleted.data.auditId, first.data.auditId);
  assert.equal(afterCompleted.data.reusedExistingAudit, false);

  const activeFree = await startAudit(baseUrl, secondUrl, guestId);
  assert.equal(activeFree.success, true);
  assert.equal(activeFree.message, 'You already have an audit in progress.');
  assert.equal(activeFree.data.auditId, afterCompleted.data.auditId);
  assert.equal(activeFree.data.reusedExistingAudit, true);

  assert.equal(resolveEffectiveAuditMode('paid', 'standard'), 'standard');
  assert.ok(DEFAULT_PLAN_LIMITS.paid.dailyAudits > DEFAULT_PLAN_LIMITS.free.dailyAudits);
  assert.ok(DEFAULT_PLAN_LIMITS.paid.priority > DEFAULT_PLAN_LIMITS.free.priority);

  let now = 10_000;
  const guard = createAuditSubmitGuard(() => now);
  assert.equal(guard.begin(), true);
  assert.equal(guard.begin(), false);
  guard.end();
  assert.equal(guard.begin(), false);
  now += AUDIT_START_DEBOUNCE_MS;
  assert.equal(guard.begin(), true);

  console.log('Duplicate audit prevention smoke test passed.');
} finally {
  await close(apiServer);
}
