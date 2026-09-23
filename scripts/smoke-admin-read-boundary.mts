import assert from 'node:assert/strict';
import express from 'express';
import { createAdminReadRouter } from '../src/api/admin/read-routes';

const app = express();
app.use('/admin', createAdminReadRouter(async (_req, res) => { res.status(403).json({ success: false }); return null; }));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
try {
  const address = server.address();
  assert(address && typeof address !== 'string');
  for (const resource of ['users', 'audits']) {
    const response = await fetch(`http://127.0.0.1:${address.port}/admin/${resource}?limit=999999`);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), { success: false });
  }
  console.log('PASS admin list boundaries: unauthorized requests rejected before database access');
} finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
