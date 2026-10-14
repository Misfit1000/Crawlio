import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createPreviewServer } from '../../admin/__checks__/workspace-preview.mjs';
import { startAuditUiFixture } from '../../audit/__checks__/audit-ui-fixture.mts';
import { AUDIT_ID, mockBlogApi } from '../../../../tests/e2e/helpers';
import { renderBlogArticleHtml } from '../../../lib/blog/render';
import type { BlogPost } from '../../../lib/blog/types';

const output = 'test-results/spacious-final';
await mkdir(output, { recursive: true });
const { server: workspace } = await createPreviewServer({ port: 5202 });
await workspace.listen();
const audits = await startAuditUiFixture(5203);
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
const context = await browser.newContext({ reducedMotion: 'reduce' });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
await mockBlogApi(page);
const screens = [
  ['homepage', 'http://127.0.0.1:5178/', 'Website audits.'],
  ['dashboard', 'http://127.0.0.1:5202/app', 'Your website, at a glance.'],
  ['projects', 'http://127.0.0.1:5202/app/projects', 'Projects'],
  ['admin', 'http://127.0.0.1:5202/admin', 'Operations overview'],
  ['live-audit', `http://127.0.0.1:5203/audit/live/${AUDIT_ID}?fixture=running`, 'Auditing example.com'],
  ['report', `http://127.0.0.1:5203/app/audits/${AUDIT_ID}/overview`, 'example.com'],
] as const;

try {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      await page.addInitScript(value => localStorage.setItem('crawlio-theme-v1', value), theme);
      for (const [name, address, heading] of screens) {
        const url = new URL(address);
        if (url.port === '5202') url.searchParams.set('theme', theme === 'dark' ? 'black' : 'light');
        await page.goto(url.href);
        await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
        if (name === 'dashboard' || name === 'projects') await expect(page.getByRole('table', { name: 'Website projects and their latest recorded audit.' })).toBeVisible();
        if (name === 'dashboard') await expect(page.locator('.project-metrics').getByText('Pages checked', { exact: true })).toBeVisible();
        if (name === 'admin') await expect(page.getByRole('heading', { name: 'Audit activity', exact: true })).toBeVisible();
        if (name === 'live-audit') await expect(page.getByRole('heading', { name: 'Pages discovered', exact: true })).toBeVisible();
        await expect.poll(() => page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor)).toBe(theme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${name}, ${width}px, ${theme}: no page overflow`);
        if (width === 1440 && ['dashboard', 'admin'].includes(name)) {
          const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
          assert.deepEqual(accessibility.violations.filter(item => ['serious', 'critical'].includes(item.impact || '')).map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], `${name} ${theme}: WCAG A/AA`);
        }
        await page.screenshot({ path: `${output}/${name}-${width}-${theme}.png`, fullPage: true });
      }
    }
  }
  const articleContext = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: 'dark' });
  const articlePage = await articleContext.newPage();
  const article = { slug: 'fixture-guide', title: 'Make every page easier to discover', excerpt: 'A synthetic article for local design review.', tagline: 'Start with clear, crawlable navigation.', contentHtml: '<h2>Find the missing paths</h2><p>Review source pages and destinations before changing internal links.</p>', contentText: 'Review source pages and destinations before changing internal links.', sources: [], relatedArticles: [], imageVariants: [], tags: [], readingTimeMinutes: 3, language: 'en', status: 'draft', publishedAt: null, updatedAt: new Date().toISOString(), fixtureTest: true } as BlogPost;
  await articlePage.route('**/__blog-theme-check', route => route.fulfill({ contentType: 'text/html', body: renderBlogArticleHtml(article, 'http://127.0.0.1:5178') }));
  await articlePage.goto('http://127.0.0.1:5178/__blog-theme-check');
  await expect(articlePage.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
  await articlePage.screenshot({ path: `${output}/article-mobile-light.png`, fullPage: true });
  await articlePage.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect.poll(() => articlePage.locator('body').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(0, 0, 0)');
  await articlePage.reload();
  await expect(articlePage.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
  assert.equal(await articlePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await articlePage.screenshot({ path: `${output}/article-mobile-dark.png`, fullPage: true });
  await articleContext.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const route of ['/admin/users', '/admin/audits', '/admin/queue', '/admin/workers', '/admin/diagnostics', '/admin/settings', '/admin/plans', '/admin/blog']) {
    await page.goto(`http://127.0.0.1:5202${route}?theme=black`);
    await expect(page.locator('h1')).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${route}: no overflow`);
    await page.screenshot({ path: `${output}/${route.slice(1).replaceAll('/', '-')}.png`, fullPage: true });
  }
  const recording = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: `${output}/motion`, size: { width: 1440, height: 1000 } } });
  const motionPage = await recording.newPage();
  await mockBlogApi(motionPage);
  await motionPage.goto('http://127.0.0.1:5178/');
  await motionPage.locator('.clarity-audit-scene').scrollIntoViewIfNeeded();
  await motionPage.waitForTimeout(2500);
  await motionPage.getByRole('button', { name: 'Pause audit illustration' }).click();
  await expect(motionPage.locator('.clarity-audit-scene')).toHaveAttribute('data-paused', 'true');
  await recording.close();
  assert.deepEqual(errors, [], 'No UI runtime errors');
  console.log('PASS: six major screens at 390/768/1440 in both themes, visible mobile metrics, dashboard/admin accessibility, all admin route layouts, persistent server-blog theme, and motion pause. Screenshots contain synthetic fixture data.');
} finally {
  await browser.close();
  await audits.close();
  await workspace.close();
}
