import assert from 'node:assert/strict';
import http from 'node:http';
import handler from '../src/api/vercel-handler.ts';

function listen(server, port = 0) {
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address())));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function makeRequest(baseUrl, path, { method = 'GET', body, headers = {} } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body,
  }).then(async (response) => ({
    status: response.status,
    headers: response.headers,
    text: await response.text(),
  }));
}

const server = http.createServer((req, res) => handler(req, res));
const address = await listen(server);
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const versionResponse = await makeRequest(baseUrl, '/api/version');
  assert.equal(versionResponse.status, 200);
  const version = JSON.parse(versionResponse.text);
  for (const key of ['applicationVersion', 'commitIdentifier', 'buildTimestamp', 'apiSchemaVersion', 'auditEngineVersion', 'scoringVersion', 'checkRegistryVersion']) assert.ok(key in version);
  assert.equal(/secret|workerId|filePath|databaseUrl/i.test(versionResponse.text), false);

  const notFound = await makeRequest(baseUrl, '/api/not-found');
  assert.equal(notFound.status, 404);
  assert.ok(notFound.headers.get('content-type')?.includes('application/json'));
  assert.equal(notFound.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(notFound.headers.get('x-frame-options'), 'DENY');
  assert.match(notFound.text, /requestId/);

  const invalidJson = await makeRequest(baseUrl, '/api/tools/audit/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"url":',
  });
  assert.equal(invalidJson.status, 400);
  assert.match(invalidJson.text, /INVALID_JSON/);
  assert.match(invalidJson.text, /not valid JSON/);

  const largeBody = await makeRequest(baseUrl, '/api/tools/audit/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'example.com', padding: 'x'.repeat(70_000) }),
  });
  assert.equal(largeBody.status, 413);
  assert.match(largeBody.text, /REQUEST_BODY_TOO_LARGE/);

  const validAudit = await makeRequest(baseUrl, '/api/tools/audit/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-crawlio-guest-id': 'hardening-owner' },
    body: JSON.stringify({ url: 'example.com', mode: 'quick' }),
  });
  assert.equal(validAudit.status, 200);
  assert.ok(validAudit.headers.get('content-type')?.includes('application/json'));
  assert.equal(JSON.parse(validAudit.text).success, true);
  const auditId = JSON.parse(validAudit.text).data.auditId;

  const ownerStatus = await makeRequest(baseUrl, `/api/tools/audit/status/${auditId}`, {
    headers: { 'x-crawlio-guest-id': 'hardening-owner' },
  });
  assert.equal(ownerStatus.status, 200);

  for (const path of [
    `/api/tools/audit/status/${auditId}`,
    `/api/tools/audit/result/${auditId}`,
    `/api/tools/audit/export/${auditId}/json`,
  ]) {
    const denied = await makeRequest(baseUrl, path, { headers: { 'x-crawlio-guest-id': 'different-guest' } });
    assert.equal(denied.status, 404, `${path} should hide audits from other guests`);
  }

  const deniedCancel = await makeRequest(baseUrl, `/api/tools/audit/cancel/${auditId}`, {
    method: 'POST',
    headers: { 'x-crawlio-guest-id': 'different-guest' },
  });
  assert.equal(deniedCancel.status, 404);

  console.log('API hardening smoke test passed.');
} finally {
  await close(server);
}
