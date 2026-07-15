import http from 'http';
import assert from 'assert';
import { execFileSync, spawn } from 'child_process';

function makeRequest(path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: { ...headers }
    };

    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function run() {
  console.log("Starting smoke test for JSON APIs...");

  let serverProcess = null;
  const stopServer = () => {
    if (!serverProcess?.pid) return;
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/pid', String(serverProcess.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {}
    } else {
      serverProcess.kill('SIGTERM');
    }
  };
  try {
    await makeRequest('/api/invalid-route');
  } catch {
    const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run dev'] : ['run', 'dev'];
    serverProcess = spawn(command, args, {
      stdio: 'ignore',
    });
    for (let i = 0; i < 30; i++) {
      try {
        await makeRequest('/api/invalid-route');
        break;
      } catch {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  try {
    // 1. Invalid API route under /api returns JSON 404
    const notFoundRes = await makeRequest('/api/invalid-route');
    assert.strictEqual(notFoundRes.status, 404, 'Status should be 404');
    assert.ok(notFoundRes.headers['content-type'].includes('application/json'), 'Should return JSON');
    const notFoundData = JSON.parse(notFoundRes.data);
    assert.strictEqual(notFoundData.success, false);
    assert.strictEqual(notFoundData.error.code, 'API_ROUTE_NOT_FOUND');
    assert.strictEqual(notFoundData.error.message, 'The requested API route was not found.');
    assert.match(notFoundData.error.requestId, /^[a-zA-Z0-9-]{8,}$/);
    console.log("✓ Invalid route returned JSON 404");

    // 2. audit start handler returns valid JSON
    const guestHeaders = { 'x-seointel-guest-id': 'api-json-smoke-owner' };
    const startRes = await makeRequest('/api/tools/audit/start', 'POST', { url: 'https://example.com', maxPages: 1 }, guestHeaders);
    assert.ok(startRes.headers['content-type'].includes('application/json'), 'Should return JSON');
    const startData = JSON.parse(startRes.data);
    assert.strictEqual(startData.success, true);
    console.log("✓ Audit start returned valid JSON");
    const auditId = startData.data.auditId;

    // 3. audit status handler returns valid JSON
    const statusRes = await makeRequest(`/api/tools/audit/status/${auditId}`, 'GET', null, guestHeaders);
    assert.ok(statusRes.headers['content-type'].includes('application/json'), 'Should return JSON');
    const statusData = JSON.parse(statusRes.data);
    assert.strictEqual(statusData.success, true);
    console.log("✓ Audit status returned valid JSON");

    // 4. audit result handler returns valid JSON
    const resultRes = await makeRequest(`/api/tools/audit/result/${auditId}`, 'GET', null, guestHeaders);
    assert.ok(resultRes.headers['content-type'].includes('application/json'), 'Should return JSON');
    const resultData = JSON.parse(resultRes.data);
    assert.ok(resultData.success === true || resultData.success === false);
    console.log("✓ Audit result returned valid JSON");

    // The compatibility event path must stay bounded inside Vercel.
    const eventRes = await makeRequest(`/api/tools/audit/events/${auditId}?limit=10`, 'GET', null, guestHeaders);
    assert.ok(eventRes.headers['content-type'].includes('application/json'), 'Audit events should return bounded JSON');
    assert.ok(!eventRes.headers['content-type'].includes('text/event-stream'), 'Audit events must not keep a serverless SSE request open');
    const eventData = JSON.parse(eventRes.data);
    assert.strictEqual(eventData.success, true);
    assert.ok(Array.isArray(eventData.data.events));
    assert.ok(eventData.data.events.length <= 10);
    console.log("PASS: Audit events returned a bounded JSON snapshot");

    console.log("All JSON API smoke tests passed!");
    stopServer();
    process.exit(0);
  } catch (err) {
    console.error("Smoke test failed:", err);
    stopServer();
    process.exit(1);
  }
}

run();
