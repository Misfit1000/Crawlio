import assert from 'node:assert/strict';
import type { User } from '@supabase/supabase-js';
import { AccountProfileError, accountActionError, finishRegistration } from '../src/lib/auth/account-state.ts';
import { ensureUserProfileFromAuthUser } from '../src/lib/billing/entitlements.ts';

let profileCalls = 0;
assert.deepEqual(await finishRegistration(false, async () => { profileCalls++; }), { status: 'confirmation_required' });
assert.equal(profileCalls, 0, 'Confirmation-required signup must not initialize a profile.');
assert.deepEqual(await finishRegistration(true, async () => { profileCalls++; }), { status: 'signed_in' });
assert.equal(profileCalls, 1);
const pending = await finishRegistration(true, async () => { throw new Error('raw database failure'); });
assert.equal(pending.status, 'profile_pending');
assert.doesNotMatch(JSON.stringify(pending), /raw database failure/);
await assert.rejects(finishRegistration(true, async () => { throw new AccountProfileError(403); }), /account is unavailable/);
await assert.rejects(finishRegistration(true, async () => { throw new AccountProfileError(401); }), /session has expired/);
assert.equal(accountActionError({ code: 'user_already_exists' }, 'register'), 'An account already uses this email. Sign in instead of registering again.');
assert.match(accountActionError({ code: 'email_not_confirmed' }, 'login'), /Confirm your email/);
assert.doesNotMatch(accountActionError({ message: 'new row violates row-level security policy' }, 'register'), /row-level|policy/);

const originalFetch = globalThis.fetch;
const originalEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, admins: process.env.ADMIN_EMAILS };
process.env.SUPABASE_URL = 'https://registration-fixture.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-key';
process.env.ADMIN_EMAILS = '';
let existing: Record<string, unknown> | null = null;
let writes = 0;
let saved: Record<string, unknown> | null = null;
globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  assert.equal(new URL(request.url).hostname, 'registration-fixture.supabase.co', 'No real service may be called.');
  assert.equal(new URL(request.url).pathname, '/rest/v1/user_profiles');
  if (request.method === 'GET') return Response.json(existing ? [existing] : []);
  assert.equal(request.method, 'POST');
  writes++;
  saved = await request.json();
  return Response.json(saved);
};

try {
  const consentAt = '2026-09-30T00:00:00.000Z';
  const authUser = {
    id: '33333333-3333-4333-8333-333333333333', email: 'fixture@example.com',
    user_metadata: { role: 'admin', plan: 'admin', legal_consent_version: 'fixture-version', terms_accepted_at: consentAt, privacy_accepted_at: consentAt },
  } as unknown as User;
  const profile = await ensureUserProfileFromAuthUser(authUser);
  assert.equal(profile.role, 'user');
  assert.equal(profile.plan, 'free');
  assert.equal(profile.subscriptionStatus, 'inactive');
  assert.equal(writes, 1, 'A confirmed Auth account without a profile is recoverable.');
  assert.equal(saved?.terms_accepted_at, consentAt);
  assert.equal(saved?.privacy_accepted_at, consentAt);
  assert.equal(saved?.legal_version, 'fixture-version');
  existing = saved;
  await ensureUserProfileFromAuthUser(authUser);
  assert.equal(writes, 1, 'Verified hydration must not rewrite an existing profile.');
  existing = { ...existing, disabled: true };
  await assert.rejects(ensureUserProfileFromAuthUser(authUser), (error: unknown) => {
    assert.equal((error as { status: number }).status, 403);
    return true;
  });
  assert.equal(writes, 1, 'Suspension must not be bypassed by initialization.');
} finally {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries({ SUPABASE_URL: originalEnv.url, SUPABASE_SERVICE_ROLE_KEY: originalEnv.key, ADMIN_EMAILS: originalEnv.admins })) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
console.log('Registration and protected profile recovery checks passed.');
