import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.SEOINTEL_E2E_TSX_LOADED) {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(import.meta.url)],
    {
      stdio: 'inherit',
      env: { ...process.env, SEOINTEL_E2E_TSX_LOADED: '1', SEOINTEL_ALLOW_PRIVATE_TEST_TARGETS: 'true' },
    },
  );
  process.exit(result.status ?? 1);
}

const http = await import('node:http');
const expressModule = await import('express');
const { apiRouter } = await import('../src/api/index.ts');
const { auditRepository } = await import('../src/lib/supabase/audit-repository.ts');
const { runOneAudit } = await import('../src/workers/audit-worker.ts');

const express = expressModule.default;

function makeRequest(baseUrl, path, method = 'GET', body) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'x-seointel-guest-id': 'local-e2e-owner',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => ({
    status: response.status,
    headers: response.headers,
    json: await response.json(),
  }));
}

async function canReachServer(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/invalid-route`);
    return response.headers.get('content-type')?.includes('application/json') || false;
  } catch {
    return false;
  }
}

function listen(server, port = 0) {
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address())));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

const supabaseEnabled = auditRepository.isSupabaseEnabled();
const configuredServer = process.env.E2E_SERVER_URL || 'http://127.0.0.1:3000';
let baseUrl = configuredServer;
let server = null;
const configuredServerReachable = await canReachServer(configuredServer);

if (configuredServerReachable) {
  if (!supabaseEnabled) {
    console.log('Running local in-memory E2E mode - not production Supabase.');
    console.log('A running external server was detected, but in-memory worker state cannot be shared across processes. Starting an in-process API server for this test.');
  } else {
    console.log(`Using running server at ${configuredServer}.`);
  }
}

if (!supabaseEnabled || !configuredServerReachable) {
  if (!supabaseEnabled) {
    console.log('Running local in-memory E2E mode - not production Supabase.');
  }
  const app = express();
  app.use(express.json());
  app.use('/api/tools', apiRouter);
  app.use('/api', (req, res) => {
    res.status(404).json({
      success: false,
      error: `API route not found: ${req.method} ${req.originalUrl}`,
    });
  });
  server = http.createServer(app);
  const address = await listen(server);
  baseUrl = `http://127.0.0.1:${address.port}`;
}

try {
  const startTime = Date.now();
  const start = await makeRequest(baseUrl, '/api/tools/audit/start', 'POST', {
    url: 'example.com',
    mode: 'quick',
  });
  assert.equal(start.status, 200);
  assert.equal(start.json.success, true);
  assert.ok(Date.now() - startTime < 1500, 'audit start should return auditId quickly');
  assert.ok(start.json.data.auditId, 'auditId should be returned');

  const auditId = start.json.data.auditId;
  const queued = await makeRequest(baseUrl, `/api/tools/audit/status/${auditId}`);
  assert.equal(queued.json.success, true);
  assert.equal(queued.json.data.audit.status, 'queued');
  assert.ok(queued.json.data.latestEvents.some((event) => event.type === 'audit_queued'));

  const workerClaimed = await runOneAudit('local-e2e-worker');
  assert.equal(workerClaimed, true, 'worker should claim the queued audit');

  const afterWorker = await makeRequest(baseUrl, `/api/tools/audit/status/${auditId}`);
  assert.equal(afterWorker.json.success, true);
  assert.ok(['running', 'completed', 'failed', 'cancelled'].includes(afterWorker.json.data.audit.status));
  assert.ok(['running', 'completed'].includes(afterWorker.json.data.audit.status), `unexpected audit status ${afterWorker.json.data.audit.status}`);

  const retainedEvents = await auditRepository.getEvents(auditId, 300);
  assert.ok(retainedEvents.some((event) => event.type === 'audit_queued'));
  assert.ok(retainedEvents.some((event) => event.type === 'page_crawling'));
  assert.ok(retainedEvents.some((event) => event.type === 'page_crawled'));
  assert.ok(afterWorker.json.data.latestPages.length > 0, 'latestPages should be populated');
  assert.ok(Array.isArray(afterWorker.json.data.latestIssues), 'latestIssues should be returned');
  assert.equal(JSON.stringify(afterWorker.json.data).toLowerCase().includes('<!doctype'), false, 'raw doctype HTML should not be stored');
  assert.equal(JSON.stringify(afterWorker.json.data).toLowerCase().includes('<html'), false, 'raw HTML should not be stored');

  const second = await makeRequest(baseUrl, '/api/tools/audit/start', 'POST', {
    url: 'example.com',
    mode: 'quick',
  });
  assert.equal(second.json.success, true);
  const cancelId = second.json.data.auditId;
  const cancel = await makeRequest(baseUrl, `/api/tools/audit/cancel/${cancelId}`, 'POST');
  assert.equal(cancel.json.success, true);
  const cancelled = await makeRequest(baseUrl, `/api/tools/audit/status/${cancelId}`);
  assert.equal(cancelled.json.data.audit.status, 'cancelled');

  console.log('Local E2E audit test passed.');
} finally {
  if (server) {
    await close(server);
  }
}
