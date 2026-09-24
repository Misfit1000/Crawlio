import { expect, test } from '@playwright/test';
import { AUDIT_ID, auditSnapshot, expectNoHorizontalOverflow, mockBlogApi } from './helpers';

test('conceptual scene is pauseable, responsive, and has no invented scores', async ({ page }, testInfo) => {
  await mockBlogApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Pause animation' }).click();
  await expect(page.getByRole('button', { name: 'Play animation' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.audit-concept')).not.toContainText('/100');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => document.documentElement.classList.toggle('dark', value === 'dark'), theme);
      await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`homepage-${width}-${theme}.png`), fullPage: true });
    }
  }
});

test('guest audit reuses the opening snapshot and stops on permanent access failure', async ({ page }) => {
  let requests = 0;
  await page.route(/\/api\/tools\/audit\/(result|status)\//, route => {
    requests++;
    return route.fulfill(requests === 1
      ? { contentType: 'application/json', body: JSON.stringify({ success: true, data: auditSnapshot('running') }) }
      : { status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Access revoked' }) });
  });
  await page.goto(`/audit/live/${AUDIT_ID}`);
  await expect(page.getByRole('heading', { name: 'Your website, page by page' })).toBeVisible();
  await page.waitForTimeout(600);
  expect(requests).toBe(1);
  await expect.poll(() => requests, { timeout: 12000 }).toBe(2);
  await page.waitForTimeout(7000);
  expect(requests).toBe(2);
});

test('observed page map displays evidence at each responsive width', async ({ page }, testInfo) => {
  await page.route('**/api/tools/audit/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: auditSnapshot() }) }));
  await page.route('**/api/tools/domain/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Unavailable' }) }));
  await page.goto(`/audit/live/${AUDIT_ID}`);
  const map = page.getByRole('region', { name: 'Your website, page by page' });
  await map.getByRole('button', { name: /Example Domain/ }).click();
  await expect(map).toContainText('200');
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
    await map.screenshot({ path: testInfo.outputPath(`page-map-${width}.png`) });
  }
});
