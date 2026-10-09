import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { ResourceAuditDocument } from '../lib/audit/resource-types';
import { registerAuditToolRoutes } from './audit-tool-routes';

test('tool documents are owner-authorized, private and allowlisted', async () => {
  const app = express(); let reads = 0;
  registerAuditToolRoutes(app, { requireAccess: async (_req, id) => id === 'owned' ? { id, status: 'completed', pagesCrawled: 3, updatedAt: '2026-10-02', processingVersion: 2 } as ResourceAuditDocument : null,
    readMetadata: async () => { reads++; return { secret: 'secret-key', owner: 'worker', robotsEvidence: { state: 'available', raw: 'User-agent: *', fetchedAt: '2026-10-02', warnings: [], authorization: 'private' } }; } });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as { port: number }; const base = `http://127.0.0.1:${address.port}`;
    const denied = await fetch(`${base}/audit/foreign/tool-evidence`); assert.equal(denied.status, 404); assert.equal(reads, 0);
    const result = await fetch(`${base}/audit/owned/tool-evidence`); assert.equal(result.headers.get('cache-control'), 'private, no-store');
    const body = await result.json(); assert.equal(body.data.robots.raw, 'User-agent: *'); assert.equal(reads, 1);
    assert.doesNotMatch(JSON.stringify(body), /secret-key|authorization|worker/);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
