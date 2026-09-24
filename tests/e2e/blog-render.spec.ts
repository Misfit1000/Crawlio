import { expect, test } from '@playwright/test';
import { renderBlogListingHtml } from '../../src/lib/blog/public-render';
import { renderBlogArticleHtml } from '../../src/lib/blog/render';
import type { BlogPost } from '../../src/lib/blog/types';
import { expectNoHorizontalOverflow } from './helpers';

const post = {
  id: 'example-guide',
  slug: 'fix-broken-internal-links',
  title: 'How to fix broken internal links',
  excerpt: 'Find affected pages, repair destinations, and verify the next crawl.',
  tagline: 'A practical workflow for recovering broken site navigation.',
  contentHtml: '<h2>Find the affected pages</h2><p>Review the source URL and failed destination before editing the link.</p>',
  contentText: 'Find the affected pages. Review the source URL and failed destination before editing the link.',
  tags: ['Technical SEO'],
  topicCluster: 'Technical SEO',
  status: 'published',
  publishedAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
  readingTimeMinutes: 3,
  fixtureTest: false,
  language: 'en',
  ogImageUrl: '',
  imageVariants: [],
  sources: [],
  relatedArticles: [],
} as BlogPost;

test('crawlable blog listing and article follow the customer theme without overflow', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      for (const [kind, html] of [
        ['listing', renderBlogListingHtml({ origin: 'https://example.com', posts: [post], topics: [], total: 1, page: 1, pageSize: 9 })],
        ['article', renderBlogArticleHtml(post, 'https://example.com')],
      ] as const) {
        await page.setContent(html);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
        const background = await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(background).toBe(colorScheme === 'dark' ? 'rgb(18, 20, 22)' : 'rgb(246, 247, 249)');
        await page.screenshot({ path: testInfo.outputPath(`server-blog-${kind}-${width}-${colorScheme}.png`) });
      }
    }
  }
});
