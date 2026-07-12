import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import handler from '../api/index';

const server = createServer((request, response) => {
  void Promise.resolve(handler(request, response)).catch((error) => {
    response.statusCode = 500;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Handler failed' }));
  });
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

try {
  const address = server.address();
  assert(address && typeof address === 'object');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/index?path=tools/audit/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'not-a-url', mode: 'quick' }),
  });
  const contentType = response.headers.get('content-type') || '';
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(contentType, /application\/json/i);
  assert.equal(body.success, false);
  assert.match(body.error, /valid (url|public domain)/i);
  console.log('Vercel function entry smoke test passed.');
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
