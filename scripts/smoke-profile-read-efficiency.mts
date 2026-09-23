import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.com',
  full_name: 'Site owner',
  role: 'user',
  plan: 'paid',
  subscription_status: 'past_due',
  disabled: false,
  audit_quota_used_daily: 0,
  audit_quota_used_monthly: 0,
};
const writes: Array<Record<string, unknown>> = [];
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url?.startsWith('/rest/v1/user_profiles')) {
    res.end(JSON.stringify(profile));
    return;
  }
  if (req.method === 'POST' && req.url?.startsWith('/rest/v1/user_profiles')) {
    const parts: Buffer[] = [];
    for await (const part of req) parts.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(parts).toString()) as Record<string, unknown>;
    writes.push(body);
    res.end(JSON.stringify({ ...profile, ...body }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ message: 'Unexpected request' }));
});
server.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
try {
  const address = server.address();
  assert(address && typeof address !== 'string');
  process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  const { ensureUserProfileFromAuthUser } = await import('../src/lib/billing/entitlements');
  const user = { id: profile.id, email: profile.email, user_metadata: {} };
  const unchanged = await ensureUserProfileFromAuthUser(user as never);
  assert.equal(unchanged.subscriptionStatus, 'past_due');
  assert.equal(writes.length, 0, 'Unchanged profile read must not write');
  await ensureUserProfileFromAuthUser({ ...user, email: 'new@example.com' } as never);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].subscription_status, 'past_due', 'Profile sync must preserve billing state');
  console.log('PASS profile reads avoid writes and preserve subscription status');
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
