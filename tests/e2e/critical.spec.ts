import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { AUDIT_ID, auditSnapshot, expectNoHorizontalOverflow, mockBlogApi } from './helpers';

test.describe('public product journeys', () => {
  test.beforeEach(async ({ page }) => mockBlogApi(page));

  test('homepage navigation, pricing, blog, theme, and layout work', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('website');
    await page.getByRole('navigation', { name: 'Public navigation' }).getByRole('link', { name: 'Pricing' }).click();
    await expect(page.locator('#pricing')).toBeInViewport();
    await expect(page.locator('#pricing')).toContainText('Up to 5 analysed pages');
    await expect(page.locator('#pricing')).toContainText('Up to 50 analysed pages');
    await expect(page.locator('#pricing')).toContainText('Up to 75 analysed pages');
    await expect(page.locator('#pricing')).not.toContainText('deployment');
    await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);

    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('button', { name: 'Switch to light mode' }).click();

    await page.goto('/blog');
    await expect(page.getByRole('heading', { name: 'Practical SEO engineering guides' })).toBeVisible();
  });

  test('mobile navigation is usable without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    const mobileNav = page.getByRole('navigation', { name: 'Mobile public navigation' });
    await expect(mobileNav).toBeVisible();
    await mobileNav.getByRole('link', { name: 'Pricing' }).click();
    await expect(page.locator('#pricing')).toBeInViewport();
    await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
  });

  test('homepage has no serious automated accessibility violations', async ({ page }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze();
    const serious = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''));
    expect(serious, serious.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
  });
});

test.describe('guest audit integration', () => {
  test('double submit creates one audit and terminal report survives refresh', async ({ page }) => {
    let starts = 0;
    let statusCalls = 0;
    let terminal = false;
    await page.route('**/api/tools/audit/start', async (route) => {
      starts += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ success: true, data: { auditId: AUDIT_ID, status: 'queued', pageLimit: 5 } }) });
    });
    await page.route(`**/api/tools/audit/result/${AUDIT_ID}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: auditSnapshot(terminal ? 'completed' : 'queued') }) }));
    await page.route(`**/api/tools/audit/status/${AUDIT_ID}`, (route) => {
      statusCalls += 1;
      terminal = statusCalls >= 3;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: auditSnapshot(terminal ? 'completed' : 'running') }) });
    });
    await page.route(`**/api/tools/audit/${AUDIT_ID}/finding-workflow`, (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Sign in to persist finding workflow.' }) }));

    await page.goto('/');
    await page.getByLabel('Website or domain').fill('example.com');
    await page.getByRole('button', { name: 'Start audit' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(page).toHaveURL(`/audit/live/${AUDIT_ID}`);
    await expect.poll(() => starts).toBe(1);
    await expect(page.getByText('Checking your site').first()).toBeVisible();
    await expect(page.getByText('Report ready', { exact: true }).first()).toBeVisible({ timeout: 12_000 });
    await expect(page.getByText('Final score').first()).toBeVisible();
    await expect(page.getByText('82', { exact: true }).first()).toBeVisible();
    const summary = page.getByRole('region', { name: 'Audit summary' });
    await expect(summary).toContainText('Pages analysed');
    await expect(summary).toContainText('2');
    await expect(summary).toContainText('5');
    await expect(page.getByText('Checking your site')).toHaveCount(0);
    await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);

    await page.reload();
    await expect(page.getByText('Report ready', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Final score').first()).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL('/');
    await page.goForward();
    await expect(page).toHaveURL(`/audit/live/${AUDIT_ID}`);
  });
});

test.describe('authentication and authorization boundaries', () => {
  test('invalid sign in is safe and admin content does not flash', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByLabel('Email').fill('invalid@example.com');
    await page.locator('#login-password').fill('incorrect-password');
    await page.getByRole('dialog', { name: 'Sign in' }).getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Admin control center' })).toHaveCount(0);
  });
});
