import { expect, test } from '@playwright/test';
import { AUDIT_ID, auditSnapshot, mockBlogApi, expectNoHorizontalOverflow } from './helpers';

test('healthy homepage defers pricing and route-only bundles until needed', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await mockBlogApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Crawlio website audits' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(requests.filter(url => /sentry-vendor|sentry-browser-runtime|node_modules.*sentry|supabase-vendor|node_modules.*supabase|editor-vendor|BlogAdmin|LiveAuditProgress/i.test(url))).toEqual([]);
  expect(requests.filter(url => url.includes('/api/tools/plans/public'))).toEqual([]);
  await page.getByRole('navigation', { name: 'Public navigation' }).getByRole('link', { name: 'Pricing', exact: true }).click();
  await expect.poll(() => requests.filter(url => url.includes('/api/tools/plans/public')).length).toBe(1);
});

test('submission paints immediate feedback and reuses the accepted snapshot', async ({ page }) => {
  await mockBlogApi(page);
  let starts = 0;
  let results = 0;
  const summary = auditSnapshot('queued').audit;
  let accept!: () => void;
  const wait = new Promise<void>(resolve => { accept = resolve; });
  await page.route('**/api/tools/audit/start', async route => {
    starts++;
    await wait;
    await route.fulfill({ status: 202, json: { success: true, data: { auditId: AUDIT_ID, initialAudit: summary } } });
  });
  await page.route(`**/api/tools/audit/result/${AUDIT_ID}`, route => { results++; return route.fulfill({ json: { success: true, data: auditSnapshot('queued') } }); });
  await page.route(`**/api/tools/audit/status/${AUDIT_ID}**`, route => route.fulfill({ json: { success: true, data: auditSnapshot('running') } }));
  await page.goto('/');
  await page.getByLabel('Website or domain').fill('example.com');
  await page.getByRole('button', { name: 'Start audit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Starting your audit' })).toBeFocused();
  await expect(page.getByRole('status')).toContainText('Submitting to the audit queue');
  expect(starts).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => {
    const clicked = performance.getEntriesByName('crawlio:audit-submit-click').at(-1)!;
    const shown = performance.getEntriesByName('crawlio:audit-launch-visible').at(-1)!;
    return shown.startTime - clicked.startTime;
  })).toBeLessThan(200);
  accept();
  await expect(page).toHaveURL(`/audit/live/${AUDIT_ID}`);
  await expect(page.getByRole('heading', { name: 'example.com', exact: true })).toBeVisible();
  expect(results).toBe(0);
  expect(starts).toBe(1);
});

test('failed admission keeps input and presents retry instead of fake audit progress', async ({ page }) => {
  await mockBlogApi(page);
  await page.route('**/api/tools/audit/start', route => route.fulfill({ status: 503, json: { success: false, error: 'The worker is temporarily unavailable.' } }));
  await page.goto('/');
  await page.getByLabel('Website or domain').fill('example.com');
  await page.getByRole('button', { name: 'Start audit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Startup needs your attention' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit audit' }).click();
  await expect(page.getByLabel('Website or domain')).toHaveValue('example.com');
});

for (const width of [390, 768, 1440]) {
  test(`responsive product layout and keyboard controls at ${width}px`, async ({ page }) => {
    await mockBlogApi(page);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
    await page.getByLabel('Website or domain').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('combobox', { name: 'Audit focus', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    expect(await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--background').trim())).toBe('#000000');
    await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
  });
}
