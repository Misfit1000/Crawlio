import { expect, test, type Page } from '@playwright/test';
import { AUDIT_ID, auditSnapshot, expectNoHorizontalOverflow, mockBlogApi } from './helpers';

async function mockReport(page: Page) {
  await mockBlogApi(page);
  const snapshot = auditSnapshot();
  const evidence = { version: 1, contentType: 'text/html', metaRobots: '', xRobotsTag: '', robotsAllowed: true, redirected: false,
    ogTitle: 'Observed social title', ogDescription: 'Observed social description', securityHeaders: { 'x-content-type-options': false } };
  const result = { ...snapshot, latestPages: snapshot.latestPages.map(item => ({ ...item, toolEvidence: evidence })) };
  const calls: string[] = [];
  await page.route('**/api/tools/domain/**', route => route.fulfill({ status: 503, json: { success: false, error: 'Optional source unavailable.' } }));
  await page.route('**/api/tools/audit/**', route => {
    const url = route.request().url(); calls.push(url);
    if (url.endsWith('/tool-evidence')) return route.fulfill({ json: { success: true, data: { robots: { state: 'available', raw: 'User-agent: *\nDisallow: /private', fetchedAt: '2026-10-02T00:00:00Z', warnings: [], truncated: false, statusCode: 200 } } } });
    if (url.endsWith('/shares')) return route.fulfill({ json: { success: true, data: { shares: [{ id: 'permission-1', expiresAt: '2026-10-09T00:00:00Z', revokedAt: null }] } } });
    if (url.includes('/shares/')) return route.fulfill({ json: { success: true } });
    if (url.includes('/finding-workflow')) return route.fulfill({ status: 401, json: { success: false } });
    return route.fulfill({ json: { success: true, data: result } });
  });
  return calls;
}

test('public tools work locally with keyboard controls and bounded responsive layouts', async ({ page }) => {
  await mockBlogApi(page);
  const apiCalls: string[] = [];
  const privateRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/')) apiCalls.push(request.url());
    if (request.url().includes('private-tool-fixture.invalid')) privateRequests.push(request.url());
  });
  await page.goto('/tools');
  await expect(page.getByRole('heading', { name: 'Free SEO tools', exact: true })).toBeVisible();
  const before = apiCalls.length;
  await page.getByLabel('Page URL', { exact: true }).fill('https://private-tool-fixture.invalid/guide?token=do-not-transmit');
  await page.getByLabel('Page title', { exact: true }).fill('A useful technical SEO guide');
  await page.getByLabel('Meta description', { exact: true }).fill('Real metadata supplied locally for a preview.');
  await expect(page.locator('p').filter({ hasText: /^A useful technical SEO guide$/ })).toBeVisible();
  await page.getByRole('tab', { name: 'SERP / social' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Structured data', exact: true })).toBeFocused();
  await page.getByLabel('Schema JSON').fill(JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: 'Real article title' }));
  await page.getByRole('button', { name: 'Validate and build' }).click();
  await expect(page.getByRole('textbox', { name: 'HTML JSON-LD embed', exact: true })).toHaveValue(/Real article title/);
  await page.getByLabel('Robots document').fill('User-agent: *\nDisallow: /private\nAllow: /private/open$');
  await page.getByLabel('Path or page URL').fill('/private/open');
  await page.getByRole('button', { name: 'Evaluate rules' }).click();
  await expect(page.getByRole('table')).toContainText('Permitted by rule');
  await expect(page.getByRole('table')).toContainText('Line 3: allow');
  expect(apiCalls.length).toBe(before);
  expect(privateRequests).toHaveLength(0);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { document.documentElement.classList.toggle('dark', value === 'dark'); }, theme);
      await expect.poll(() => page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor)).toBe(theme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(246, 247, 249)');
      await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
      await page.getByRole('tab', { name: 'SERP / social' }).click();
      await page.screenshot({ path: test.info().outputPath(`tools-${width}-${theme}.png`), fullPage: true });
    }
  }
});

test('report tools use audited values, fetch retained robots only on demand and export an explicit subset', async ({ page }) => {
  const calls = await mockReport(page);
  await page.goto(`/audit/live/${AUDIT_ID}`);
  await expect(page.getByRole('heading', { name: 'example.com', exact: true })).toBeVisible();
  expect(calls.some(url => url.endsWith('/tool-evidence'))).toBe(false);
  await page.getByText('Audit tools: previews, robots, sitemap, crawl analysis and print', { exact: true }).click();
  await expect(page.getByLabel('Page title', { exact: true })).toHaveValue('Example Domain');
  await page.getByLabel('Page title', { exact: true }).fill('Local override');
  await page.getByRole('button', { name: 'Reset preview to audited values' }).click();
  await expect(page.getByLabel('Page title', { exact: true })).toHaveValue('Example Domain');
  await page.getByRole('button', { name: 'Robots rules', exact: true }).click();
  expect(calls.some(url => url.endsWith('/tool-evidence'))).toBe(false);
  await page.getByRole('button', { name: 'Load retained robots evidence' }).click();
  await expect(page.getByLabel('Robots document')).toHaveValue('User-agent: *\nDisallow: /private');
  expect(calls.filter(url => url.endsWith('/tool-evidence'))).toHaveLength(1);
  await page.getByRole('button', { name: 'Sitemap', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download loaded subset' }).click();
  expect((await download).suggestedFilename()).toBe('crawlio-loaded-subset-sitemap.xml');
  await page.getByRole('button', { name: 'Executive summary', exact: true }).click();
  await expect(page.locator('[data-print-sheet]')).toContainText('82/100');
  await page.evaluate(() => { window.print = () => undefined; });
  await page.getByRole('button', { name: 'Print executive summary' }).click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#crawlio-print-summary')).toBeVisible();
  await expect(page.locator('#root')).toBeHidden();
  await page.pdf({ path: test.info().outputPath('executive-summary.pdf'), format: 'A4' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: 'Score badge', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enable public badge' })).toBeDisabled();
  await page.getByRole('button', { name: 'Manage existing public permissions' }).click();
  await expect(page.getByText('Report/badge permission', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByText('No active report or badge permissions.')).toBeVisible();
  await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
});
