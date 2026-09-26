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
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''));
    expect(serious, serious.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
  });

  test('quick navigation preserves protected routes from the keyboard', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Quick navigation' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill('Settings');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/app/settings');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeFocused();
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('guest audit integration', () => {
  test('audit infographic pauses and settles when the audit completes', async ({ page }) => {
    let completed = false;
    await mockBlogApi(page);
    await page.route('**/api/tools/audit/start', (route) => route.fulfill({ json: { success: true, data: { auditId: AUDIT_ID, status: 'running', pageLimit: 5 } } }));
    for (const endpoint of ['status', 'result']) {
      await page.route(`**/api/tools/audit/${endpoint}/${AUDIT_ID}**`, (route) => route.fulfill({ json: { success: true, data: auditSnapshot(completed ? 'completed' : 'running') } }));
    }
    await page.goto('/');
    await page.getByLabel('Website or domain').fill('example.com');
    await page.getByRole('button', { name: 'Start audit', exact: true }).click();
    const map = page.getByRole('region', { name: 'Your website, page by page' });
    await map.scrollIntoViewIfNeeded();
    await expect(map).toHaveAttribute('data-active', 'true');
    await map.getByRole('button', { name: 'Pause animation' }).click();
    await expect(map).toHaveAttribute('data-active', 'false');
    await map.getByRole('button', { name: 'Resume animation' }).click();
    await expect(map).toHaveAttribute('data-active', 'true');
    completed = true;
    await expect(map).toContainText('Collected evidence', { timeout: 12000 });
    await expect(map).toHaveAttribute('data-active', 'false');
    await expect(map.getByRole('button', { name: 'Pause animation' })).toHaveCount(0);
  });

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
    await page.route(`**/api/tools/audit/status/${AUDIT_ID}**`, (route) => {
      statusCalls += 1;
      terminal = statusCalls >= 3;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: auditSnapshot(terminal ? 'completed' : 'running') }) });
    });
    await page.route(`**/api/tools/audit/${AUDIT_ID}/finding-workflow`, (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Sign in to persist finding workflow.' }) }));
    await page.route('**/api/tools/domain/link-signals?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { domain: 'example.com', found: true, globalRank: 12345, tldRank: 8012, referringSubnets: 420, referringIps: 760, datasetDate: '16 Jul 2026', fetchedAt: '2026-07-16T00:00:00.000Z', source: 'Majestic Million', sourceUrl: 'https://majestic.com/reports/majestic-million', license: 'CC BY 3.0', scope: 'public_top_million', linkStatus: 'measured', webRankStatus: 'measured', webRank: 23456, previousWebRank: 25000, webRankChange: 1544, webRankHistory: [{ date: '2026-07-16', rank: 23456 }, { date: '2026-06-16', rank: 25000 }], partial: false, attributions: [{ label: 'Majestic Million', url: 'https://majestic.com/reports/majestic-million', license: 'CC BY 3.0' }, { label: 'Tranco', url: 'https://tranco-list.eu/' }] } }) }));

    await page.goto('/');
    await page.getByLabel('Website or domain').fill('example.com');
    await page.getByRole('button', { name: 'Start audit' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(page).toHaveURL(`/audit/live/${AUDIT_ID}`);
    await expect.poll(() => starts).toBe(1);
    await expect(page.getByText(/Waiting to start|Checking your site/).first()).toBeVisible();
    await expect(page.getByText('Report ready', { exact: true }).first()).toBeVisible({ timeout: 12_000 });
    await expect(page.getByText('Final score').first()).toBeVisible();
    await expect(page.getByText('82', { exact: true }).first()).toBeVisible();
    const summary = page.getByRole('region', { name: 'Audit summary' });
    await expect(summary).toContainText('Pages analysed');
    await expect(summary).toContainText('2');
    await expect(summary).toContainText('5');
    const domainStrength = page.getByRole('region', { name: 'Domain strength' });
    await expect(domainStrength).toContainText('Crawlio Domain Strength');
    await expect(domainStrength).toContainText('#23,456');
    await expect(domainStrength).toContainText('420');
    await expect(domainStrength).not.toContainText('Outside top million');
    await expect(page.getByText('Checking your site')).toHaveCount(0);
    const evidenceMap = page.getByRole('region', { name: 'Your website, page by page' });
    await expect(evidenceMap).toContainText('Collected evidence');
    await expect(evidenceMap).toHaveAttribute('data-active', 'false');
    await expect(evidenceMap.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    await evidenceMap.scrollIntoViewIfNeeded();
    await evidenceMap.screenshot({ path: 'test-results/audit-evidence-desktop.png' });
    await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(domainStrength).toBeVisible();
    await expect(domainStrength).toContainText('Measured strength factors');
    await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await evidenceMap.scrollIntoViewIfNeeded();
    await evidenceMap.screenshot({ path: 'test-results/audit-evidence-mobile-dark.png' });

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
