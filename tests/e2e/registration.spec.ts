import { expect, test, type Page } from '@playwright/test';
import { mockBlogApi } from './helpers';

const id = '33333333-3333-4333-8333-333333333333';
const email = 'registration-fixture@example.com';
const password = 'Synthetic-only-test-password-827!';
const authUser = {
  id, email, aud: 'authenticated', role: 'authenticated',
  created_at: '2026-09-30T00:00:00.000Z', app_metadata: { provider: 'email' },
  user_metadata: {}, identities: [{ id, user_id: id, provider: 'email', identity_data: { email } }],
};

function sessionResponse() {
  const encode = (data: unknown) => Buffer.from(JSON.stringify(data)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic-signature`,
    refresh_token: 'synthetic-refresh-token', token_type: 'bearer', expires_in: 3600,
    user: { ...authUser, email_confirmed_at: '2026-09-30T00:00:00.000Z' },
  };
}

function profileResponse() {
  return { success: true, data: {
    profile: { id, email, fullName: 'Fixture', role: 'user', plan: 'free', subscriptionStatus: 'inactive', auditQuotaUsedDaily: 0, auditQuotaUsedMonthly: 0, disabled: false },
    limits: { allowedModes: ['quick'], maxPagesQuick: 5, maxPagesStandard: 0, maxPagesDeep: 0, dailyAudits: 3, monthlyAudits: 30, exportsEnabled: true, pdfEnabled: false, scheduledAuditsEnabled: false },
    auditCapabilities: { availableModes: ['quick'], pageCeilings: { quick: 500, standard: 500, deep: 500 } },
  } };
}

async function mockAccount(page: Page, options: { confirmation?: boolean; profileStatus?: () => number } = {}) {
  const requests = { signups: 0, profiles: 0, browserProfileWrites: 0, consent: null as Record<string, unknown> | null };
  await mockBlogApi(page);
  await page.route('**/api/tools/**', (route) => route.fulfill({ json: { success: true, data: [], projects: [], audits: [] } }));
  await page.route('**/api/tools/me/profile', async (route) => {
    requests.profiles++;
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    const status = options.profileStatus?.() || 200;
    await route.fulfill({ status, json: status === 200 ? profileResponse() : { success: false, error: 'raw database failure' } });
  });
  await page.route('**/rest/v1/user_profiles**', (route) => {
    if (route.request().method() !== 'GET') requests.browserProfileWrites++;
    return route.fulfill({ status: 403, json: { message: 'new row violates row-level security policy' } });
  });
  await page.route('**/auth/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/signup')) {
      requests.signups++;
      requests.consent = route.request().postDataJSON().data;
      await route.fulfill({ json: options.confirmation ? authUser : sessionResponse() });
    } else if (path.endsWith('/user')) {
      await route.fulfill({ json: authUser });
    } else if (path.endsWith('/token')) {
      await route.fulfill({ json: sessionResponse() });
    } else {
      await route.fulfill({ status: 204 });
    }
  });
  return requests;
}

async function submitSignup(page: Page) {
  await page.goto('/register');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.locator('#register-password').fill(password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
}

test('confirmation-required signup avoids profile writes, then confirmed sign-in recovers the profile', async ({ page }) => {
  const requests = await mockAccount(page, { confirmation: true });
  await submitSignup(page);
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  expect(requests.signups).toBe(1);
  expect(requests.profiles).toBe(0);
  expect(requests.browserProfileWrites).toBe(0);
  expect(requests.consent?.legal_consent_version).toBeTruthy();
  expect(requests.consent?.terms_accepted_at).toBe(requests.consent?.privacy_accepted_at);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.locator('#login-password').fill(password);
  await page.getByRole('dialog', { name: 'Sign in' }).getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('/app');
  expect(requests.profiles).toBe(1);
  expect(requests.signups).toBe(1);
  expect(requests.browserProfileWrites).toBe(0);
});

test('signup with an authenticated session hydrates once without browser profile insertion', async ({ page }) => {
  const requests = await mockAccount(page);
  await submitSignup(page);
  await expect(page.getByRole('heading', { name: 'Check your email' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Create account' })).toHaveCount(0);
  await expect(page).toHaveURL('/app');
  expect(requests.signups).toBe(1);
  expect(requests.profiles).toBe(1);
  expect(requests.browserProfileWrites).toBe(0);
});

test('temporary profile failure offers retry, survives reload, and never repeats signup', async ({ page }) => {
  let status = 503;
  const requests = await mockAccount(page, { profileStatus: () => status });
  await submitSignup(page);
  await expect(page.getByRole('heading', { name: 'Finish account setup' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('raw database failure');
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Finish account setup' })).toBeVisible();
  status = 200;
  await page.getByRole('button', { name: 'Retry account setup' }).click();
  await expect(page).toHaveURL('/app');
  expect(requests.signups).toBe(1);
  expect(requests.browserProfileWrites).toBe(0);
});

test('suspended profile cannot open the workspace or appear as a fabricated Free user', async ({ page }) => {
  const requests = await mockAccount(page, { profileStatus: () => 403 });
  await submitSignup(page);
  await expect(page.getByRole('alert')).toContainText('This account is unavailable');
  await expect(page.locator('body')).not.toContainText('raw database failure');
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('This account is unavailable');
  await expect(page.getByRole('heading', { name: 'Your audit workspace' })).toHaveCount(0);
  expect(requests.browserProfileWrites).toBe(0);
});
