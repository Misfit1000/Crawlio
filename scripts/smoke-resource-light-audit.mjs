import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { apiRouter } from '../src/api/index.ts';
import { auditRepository } from '../src/lib/supabase/audit-repository.ts';
import { runOneAudit } from '../src/workers/audit-worker.ts';

process.env.SEOINTEL_ALLOW_PRIVATE_TEST_TARGETS = 'true';

if (!auditRepository.isSupabaseEnabled()) {
  console.log('Running local in-memory E2E mode - not production Supabase.');
}

function listen(server, port = 0) {
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address())));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

const targetServer = http.createServer((req, res) => {
  if (req.url === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n');
    return;
  }
  if (req.url === '/sitemap.xml') {
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end('<?xml version="1.0"?><urlset><url><loc>http://127.0.0.1:TARGET/about</loc></url></urlset>');
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/html',
    'x-content-type-options': 'nosniff',
  });
  res.end(`<!doctype html>
    <html lang="en">
      <head><title>Smoke Test</title><meta name="description" content="Smoke test page"></head>
      <body>
        <h1>Smoke Test</h1>
        <a href="/about">About</a>
        <img src="/missing.png">
      </body>
    </html>`);
});

const targetAddress = await listen(targetServer);
targetServer.removeAllListeners('request');
targetServer.on('request', (req, res) => {
  if (req.url === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`User-agent: *\nAllow: /\nSitemap: http://127.0.0.1:${targetAddress.port}/sitemap.xml\n`);
    return;
  }
  if (req.url === '/sitemap.xml') {
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end(`<?xml version="1.0"?><urlset><url><loc>http://127.0.0.1:${targetAddress.port}/about</loc></url></urlset>`);
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/html',
    'x-content-type-options': 'nosniff',
  });
  res.end(`<!doctype html>
    <html lang="en">
      <head><title>${req.url === '/about' ? 'About' : 'Home'} Smoke Test</title><meta name="description" content="Smoke test page"></head>
      <body>
        <h1>${req.url === '/about' ? 'About' : 'Home'}</h1>
        <a href="/about">About</a>
        <img src="/missing.png">
      </body>
    </html>`);
});

const app = express();
app.use(express.json());
app.use('/api/tools', apiRouter);
app.use('/api', (req, res) => res.status(404).json({ success: false, error: `API route not found: ${req.method} ${req.originalUrl}` }));
const apiServer = http.createServer(app);
const apiAddress = await listen(apiServer);

try {
  const startedAt = Date.now();
  const startResponse = await fetch(`http://127.0.0.1:${apiAddress.port}/api/tools/audit/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: `http://127.0.0.1:${targetAddress.port}`, mode: 'quick' }),
  });
  const startJson = await startResponse.json();
  assert.equal(startJson.success, true);
  assert.ok(Date.now() - startedAt < 1000, 'start route should return quickly');

  const auditId = startJson.data.auditId;
  let live = await auditRepository.getLiveData(auditId);
  assert.equal(live.audit.status, 'queued');
  assert.ok(live.latestEvents.some((event) => event.type === 'audit_queued'));

  const claimed = await runOneAudit('smoke-worker');
  assert.equal(claimed, true);

  live = await auditRepository.getLiveData(auditId);
  const retainedEvents = await auditRepository.getEvents(auditId, 300);
  assert.equal(live.audit.status, 'completed');
  assert.equal(live.audit.progress, 100);
  assert.ok(retainedEvents.some((event) => event.type === 'page_crawling' && event.currentUrl));
  assert.ok(retainedEvents.some((event) => event.type === 'page_crawled' && event.data?.responseTimeMs !== undefined));
  assert.ok(retainedEvents.some((event) => event.type === 'issue_found'));
  assert.ok(retainedEvents.some((event) => event.type === 'score_updated'));
  assert.ok(retainedEvents.some((event) => event.type === 'audit_completed'));
  assert.ok(live.latestPages.some((page) => page.responseTimeMs >= 0));
  assert.ok(live.latestIssues.length > 0);
  assert.ok(live.finalReport);
  assert.equal(JSON.stringify(live).includes('<!doctype'), false, 'raw HTML should not be stored');

  const cancelResponse = await fetch(`http://127.0.0.1:${apiAddress.port}/api/tools/audit/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: `http://127.0.0.1:${targetAddress.port}`, mode: 'quick' }),
  });
  const cancelJson = await cancelResponse.json();
  const cancelId = cancelJson.data.auditId;
  const cancelResult = await fetch(`http://127.0.0.1:${apiAddress.port}/api/tools/audit/cancel/${cancelId}`, { method: 'POST' });
  const cancelBody = await cancelResult.json();
  assert.equal(cancelBody.success, true);
  const cancelled = await auditRepository.getAudit(cancelId);
  assert.equal(cancelled.status, 'cancelled');

  const exportResponse = await fetch(`http://127.0.0.1:${apiAddress.port}/api/tools/audit/export/${auditId}/json`);
  const exportBody = await exportResponse.json();
  assert.equal(exportBody.success, true);

  console.log('Resource-light audit smoke test passed.');
} finally {
  await close(apiServer);
  await close(targetServer);
}
