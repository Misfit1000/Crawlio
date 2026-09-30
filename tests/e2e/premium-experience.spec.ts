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
  const snapshot = auditSnapshot();
  Object.assign(snapshot.audit, { processingVersion: 2, pageLimit: 1000, pagesDiscovered: 30, pagesCrawled: 24, issuesFound: 48, highCount: 1, mediumCount: 47 });
  snapshot.latestPages = Array.from({ length: 24 }, (_, index) => ({ ...snapshot.latestPages[0], id: `page-${index}`, url: `https://example.com/page-${index}`, title: index ? `Observed page ${index}` : 'Example Domain', crawlDepth: Math.floor(index / 8), issueCount: index % 7 }));
  Object.assign(snapshot.finalReport!.scores, { seo: 78, scoringVersion: '2.2' });
  await page.route('**/api/tools/audit/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: route.request().url().includes('/evidence/') ? { items: snapshot.latestIssues, nextCursor: null, total: 48 } : snapshot }) }));
  await page.route('**/api/tools/domain/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Unavailable' }) }));
  await page.goto(`/audit/live/${AUDIT_ID}`);
  const map = page.getByRole('region', { name: 'Your website, page by page' });
  await map.locator('.page-map-node').filter({ hasText: 'Example Domain' }).click();
  await expect(map).toContainText('200');
  await expect(page.getByRole('progressbar', { name: 'Plan allowance used', exact: true })).toHaveAttribute('aria-valuenow', '2');
  await expect(page.getByRole('region', { name: 'Audit summary' }).getByRole('progressbar', { name: 'Discovered pages analysed', exact: true })).toHaveAttribute('aria-valuenow', '80');
  await expect(page.getByRole('region', { name: 'Audit summary' })).toContainText('Final score');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value === 'dark'), theme);
      if (theme === 'dark') expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim())).toBe('#000000');
      await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
      await map.screenshot({ path: testInfo.outputPath(`page-map-${width}-${theme}.png`) });
      await page.getByRole('region', { name: 'Audit summary' }).screenshot({ path: testInfo.outputPath(`audit-summary-${width}-${theme}.png`) });
    }
  }
});
