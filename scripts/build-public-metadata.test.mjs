import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load } from 'cheerio';
import { buildPublicMetadata } from './build-public-metadata.mjs';

const html = '<!doctype html><html><head><link rel="canonical" href="https://crawlio1.vercel.app/"><script type="application/ld+json">{"@type":"WebSite","url":"https://old.example/"}</script><script type="module" src="/assets/entry.js"></script></head></html>';
const robots = 'User-agent: *\nDisallow: /admin\nDisallow: /app/\nSitemap: https://old.example/sitemap.xml\n';

test('configured origin stays consistent across static discovery metadata without adding scripts', () => {
  const result = buildPublicMetadata(html, robots, { APP_URL: 'https://publisher.example/path', VERCEL_PROJECT_PRODUCTION_URL: 'other.example' });
  const $ = load(result.html);
  assert.equal($('link[rel="canonical"]').attr('href'), 'https://publisher.example/');
  assert.equal($('meta[property="og:url"]').attr('content'), 'https://publisher.example/');
  assert.equal(JSON.parse($('script[type="application/ld+json"]').text()).url, 'https://publisher.example/');
  assert.equal($('script').length, 2);
  assert.match(result.robots, /Disallow: \/admin\nDisallow: \/app\//);
  assert.match(result.robots, /Sitemap: https:\/\/publisher.example\/sitemap.xml/);
  assert.doesNotMatch(result.robots, /old.example/);
});

test('production/default origins are supported while unsafe configured URLs stop the build', () => {
  assert.match(buildPublicMetadata(html, robots, {}).robots, /crawlio1.vercel.app\/sitemap.xml/);
  assert.match(buildPublicMetadata(html, robots, { VERCEL_PROJECT_PRODUCTION_URL: 'production.example' }).robots, /production.example\/sitemap.xml/);
  for (const APP_URL of ['not-a-url', 'javascript:alert(1)', 'https://user:password@publisher.example']) {
    assert.throws(() => buildPublicMetadata(html, robots, { APP_URL }));
  }
});
