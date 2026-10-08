import { expect, test, type Page } from '@playwright/test';
import { AUDIT_ID, auditSnapshot, expectNoHorizontalOverflow, mockBlogApi } from './helpers';
import type { AuditPresentationSummary, ResourceAuditPage } from '../../src/lib/audit/resource-types';

const summary: AuditPresentationSummary = { version: 1, scope: 'complete', analysedPages: 100, attemptedPages: 100, responseOutcomes: { success: 97, redirect: 1, clientError: 1, serverError: 1, unavailable: 0 }, delivery: { count: 100, totalResponseMs: 0, totalBytes: 0, averageResponseMs: 0, averagePageBytes: 0 }, pagesWithFindings: 80, depthCounts: { '0': 1, '1': 99 }, findingsBySection: { 'on-page': 70, security: 30 }, topRecommendations: [{ key: 'missing-title', title: 'Missing page title', category: 'on_page', severity: 'high', affectedPages: 80, recommendation: 'Add descriptive page titles.' }], updatedAt: '2026-10-01T00:00:00.000Z' };

async function mockAudit(page: Page, { complete = true, running = false } = {}) {
  await mockBlogApi(page);
  await page.route('**/api/tools/domain/**', route => route.fulfill({ status: 503, json: { success: false, error: 'Fixture has no optional domain evidence.' } }));
  const snapshot = auditSnapshot(running ? 'running' : 'completed');
  const first = auditSnapshot().latestPages[0];
  snapshot.latestPages = Array.from({ length: 60 }, (_, index) => ({ ...first, id: `page-${index}`, url: `https://example.com/${index}`, title: `Page ${index}`, crawlDepth: index ? 1 : 0, sourceUrl: index ? 'https://example.com/0' : undefined }));
  const result = { ...snapshot, latestPages: snapshot.latestPages as ResourceAuditPage[], audit: { ...snapshot.audit, processingVersion: 2, presentationSummary: complete ? summary : undefined }, finalReport: snapshot.finalReport ? { ...snapshot.finalReport, scores: { ...snapshot.finalReport.scores, scoringVersion: '2.2' }, presentationSummary: complete ? summary : undefined } : null };
  const requests: string[] = [];
  await page.route('**/api/tools/audit/**', async route => {
    const url = route.request().url();
    requests.push(url);
    if (url.includes('/evidence/')) {
      const query = new URL(url).searchParams;
      const items = url.includes('/evidence/pages') ? result.latestPages.slice(0, 50) : query.get('section') === 'security' ? [] : auditSnapshot().latestIssues;
      return route.fulfill({ json: { success: true, data: { items, total: items.length, nextCursor: query.has('cursor') ? null : 'next-page' } } });
    }
    if (url.includes('/finding-workflow')) return route.fulfill({ status: 401, json: { success: false, error: 'Guest workflow.' } });
    return route.fulfill({ json: { success: true, data: result } });
  });
  await page.addInitScript(() => localStorage.setItem('crawlio-theme-v1', 'dark'));
  return { result, requests };
}

test('complete chart aggregates, addressable modes, global filters and page evidence work', async ({ page }) => {
  const { requests } = await mockAudit(page);
  await page.goto(`/audit/live/${AUDIT_ID}`);
  await expect(page.getByRole('heading', { name: 'example.com', exact: true })).toBeVisible();
  await expect(page.locator('[data-presentation-scope]')).toHaveAttribute('data-presentation-scope', 'complete');
  await expect(page.getByText('100 analysed / 100 attempted pages', { exact: false })).toBeVisible();
  await page.getByText('Delivery and crawl details', { exact: true }).click();
  await expect(page.getByText('0 ms', { exact: true })).toBeVisible();
  await expect(page.getByText('80 affected pages', { exact: true })).toBeVisible();
  await expect(page.locator('.audit-map-node')).toHaveCount(48);
  await expect(page.locator('.audit-evidence-map')).toHaveAttribute('data-active', 'false');
  await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
  await page.screenshot({ path: test.info().outputPath('overview-desktop.png'), fullPage: true });
  await page.getByRole('navigation', { name: 'Audit workspace views' }).getByRole('link', { name: 'Findings', exact: true }).click();
  await expect(page).toHaveURL(/view=findings/);
  await expect(page.getByRole('searchbox')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Filter all findings by report section' }).selectOption('security');
  await expect.poll(() => requests.some(url => url.includes('/evidence/issues?') && new URL(url).searchParams.get('section') === 'security')).toBe(true);
  await expect(page.getByText('No findings match the selected filters.')).toBeVisible();
  await page.getByRole('navigation', { name: 'Audit workspace views' }).getByRole('link', { name: 'Pages', exact: true }).click();
  await expect(page).toHaveURL(/view=pages/);
  await page.getByRole('button', { name: 'Page 0 https://example.com/0' }).click();
  const drawer = page.getByRole('dialog', { name: 'Page 0' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('Stored page evidence');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Audit workspace views' }).getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page).toHaveURL(/view=activity/);
  await expect(page.getByRole('heading', { name: 'Audit activity', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Audit activity', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/view=pages/);
});

test('historical samples remain explicit and Vanta Black has no navy panels on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAudit(page, { complete: false });
  await page.goto(`/audit/live/${AUDIT_ID}`);
  await expect(page.locator('[data-presentation-scope]')).toHaveAttribute('data-presentation-scope', 'sample');
  await expect(page.locator('[data-presentation-scope]')).toContainText('not full audit totals');
  if (!await page.locator('html').evaluate(node => node.classList.contains('dark'))) await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(0, 0, 0)');
  expect(await page.locator('.audit-customer-workspace').evaluate(root => [...root.querySelectorAll('*')].filter(node => {
    const color = getComputedStyle(node).backgroundColor.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
    return color && Number(color[3]) < 80 && Number(color[3]) > Number(color[1]) + 8 && Number(color[3]) > Number(color[2]) + 8;
  }).length)).toBe(0);
  await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
  await page.screenshot({ path: test.info().outputPath('overview-mobile.png'), fullPage: true });
  await page.getByRole('navigation', { name: 'Audit workspace views' }).getByRole('link', { name: 'Pages', exact: true }).click();
  await page.getByRole('button', { name: 'Page 0 https://example.com/0' }).click();
  await expect(page.getByRole('dialog', { name: 'Page 0' })).toBeVisible();
  await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
});

test('map pauses for offscreen, reduced motion, preference and manual pause without evidence calls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  const { result, requests } = await mockAudit(page, { running: true });
  await page.goto(`/audit/live/${AUDIT_ID}`);
  const map = page.locator('.audit-evidence-map');
  await map.scrollIntoViewIfNeeded();
  await expect(map).toHaveAttribute('data-active', 'true');
  const evidenceCalls = requests.filter(url => url.includes('/evidence/')).length;
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await expect(map).toHaveAttribute('data-active', 'false');
  await page.getByRole('button', { name: 'Resume animation', exact: true }).click();
  await expect(map).toHaveAttribute('data-active', 'true');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(map).toHaveAttribute('data-active', 'false');
  await map.scrollIntoViewIfNeeded();
  await expect(map).toHaveAttribute('data-active', 'true');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(map).toHaveAttribute('data-active', 'false');
  await page.evaluate(() => { Reflect.deleteProperty(document, 'hidden'); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(map).toHaveAttribute('data-active', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(map).toHaveAttribute('data-active', 'false');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(map).toHaveAttribute('data-active', 'true');
  await page.evaluate(() => document.documentElement.dataset.motion = 'reduced');
  await expect(map).toHaveAttribute('data-active', 'false');
  expect(requests.filter(url => url.includes('/evidence/')).length).toBe(evidenceCalls);
  await page.evaluate(() => { delete document.documentElement.dataset.motion; });
  await expect(map).toHaveAttribute('data-active', 'true');
  result.latestPages.push({ ...result.latestPages[0], id: 'page-arrival', url: 'https://example.com/new-arrival', title: 'New arrival', crawlDepth: 2, sourceUrl: 'https://example.com/0' });
  result.audit.updatedAt = '2026-10-01T00:00:02.000Z';
  await expect(map.locator('.audit-map-arrival')).toHaveCount(1, { timeout: 12000 });
  await expect(map.locator('.audit-map-link-arrival')).toHaveCount(1);
  result.audit.status = 'completed';
  result.finalReport = { ...auditSnapshot().finalReport!, scores: { ...auditSnapshot().finalReport!.scores, scoringVersion: '2.2' }, presentationSummary: summary };
  await expect(map).toHaveAttribute('data-active', 'false', { timeout: 12000 });
  await expect(map.getByRole('button', { name: 'Pause animation', exact: true })).toHaveCount(0);
});

test('active findings await final recommendations and unavailable delivery is not zero bytes', async ({ page }) => {
  const { result } = await mockAudit(page, { running: true });
  result.audit.issuesFound = 30;
  result.audit.presentationSummary = { ...summary, topRecommendations: [], delivery: { count: 0, totalResponseMs: 0, totalBytes: 0, averageResponseMs: null, averagePageBytes: null } };
  result.latestPages[0] = { ...result.latestPages[0], fetchStatus: 'failed', statusCode: 404, responseTimeMs: 0, pageSizeBytes: 0 };
  await page.goto(`/audit/live/${AUDIT_ID}`);
  await expect(page.getByText('Recommendations are prepared at finalization.', { exact: false })).toBeVisible();
  await expect(page.getByText('0 B', { exact: true })).toHaveCount(0);
  await page.getByText('Delivery and crawl details', { exact: true }).click();
  await expect(page.locator('.audit-overview-charts').getByText('Not measured', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'View findings', exact: true }).click();
  await expect(page.getByRole('button', { name: /Missing page title https/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Audit workspace views' }).getByRole('link', { name: 'Pages', exact: true }).click();
  await page.getByRole('button', { name: 'Page 0 https://example.com/0' }).click();
  const drawer = page.getByRole('dialog', { name: 'Page 0' });
  await expect(drawer.getByText('0 B', { exact: true })).toHaveCount(0);
  await expect(drawer.getByText('Not measured', { exact: true })).toHaveCount(3);
});
