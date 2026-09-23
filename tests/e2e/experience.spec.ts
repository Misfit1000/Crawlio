import { expect, test } from '@playwright/test';
import { AUDIT_ID, auditSnapshot, expectNoHorizontalOverflow, mockBlogApi } from './helpers';

test('private projects require sign in without overflowing on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/projects');
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toHaveCount(0);
  await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
});

test('report filters survive refresh', async ({ page }) => {
  await page.route('**/api/tools/audit/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: auditSnapshot() }) }));
  await page.goto(`/audit/live/${AUDIT_ID}`);
  const filter = page.getByRole('combobox', { name: 'Filter by priority' });
  await filter.selectOption('high');
  await expect(page).toHaveURL(/priority=high/);
  await page.reload();
  await expect(filter).toHaveValue('high');
});

test('customer light and dark layouts at desktop and mobile widths', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockBlogApi(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`home-${width}-light.png`) });
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.screenshot({ path: testInfo.outputPath(`home-${width}-dark.png`) });
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
  }
});
