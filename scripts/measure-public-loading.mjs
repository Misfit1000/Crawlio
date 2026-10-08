import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = new URL(process.argv[2] || 'https://crawlio1.vercel.app').origin;
if (!['https://crawlio1.vercel.app', 'http://localhost:4173', 'http://127.0.0.1:4173'].includes(origin)) throw new Error('Use the production site or local development server.');
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.loadingObservation = { lcp: null, cls: 0 };
    new PerformanceObserver(list => {
      window.loadingObservation.lcp = list.getEntries().at(-1)?.startTime ?? null;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.loadingObservation.cls += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  let requests = [];
  let responses = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  page.on('response', response => responses.push({ path: new URL(response.url()).pathname, cache: response.headers()['x-vercel-cache'] || null, status: response.status() }));
  const visits = [];
  for (const kind of ['fresh', 'repeat']) {
    requests = []; responses = [];
    if (kind === 'fresh') await page.goto(origin, { waitUntil: 'load' });
    else await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1000);
    const measured = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const resources = performance.getEntriesByType('resource');
      return {
        domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
        lcpMs: window.loadingObservation.lcp == null ? null : Math.round(window.loadingObservation.lcp),
        cls: Number(window.loadingObservation.cls.toFixed(4)),
        transferredBytes: navigation.transferSize + resources.reduce((sum, item) => sum + item.transferSize, 0),
        scriptEncodedBytes: resources.filter(item => item.initiatorType === 'script').reduce((sum, item) => sum + item.encodedBodySize, 0),
      };
    });
    visits.push({ kind, ...measured, browserRequests: requests.length, apiRequests: requests.filter(value => value.startsWith('/api/')), requestedScripts: requests.filter(value => value.endsWith('.js')), cdnResponses: responses.filter(value => value.cache), note: 'Unthrottled local browser sample, not field Core Web Vitals or origin execution counts.' });
  }
  const requestCount = requests.length;
  if (process.argv[3]) {
    await mkdir(path.dirname(process.argv[3]), { recursive: true });
    await page.screenshot({ path: process.argv[3].replace(/\.json$/, '-homepage.jpg'), type: 'jpeg' });
  }
  await page.getByRole('navigation', { name: 'Public navigation' }).getByRole('link', { name: 'Pricing', exact: true }).click();
  await page.waitForTimeout(1000);
  const observation = { origin, observedAt: new Date().toISOString(), visits, pricingRequests: requests.slice(requestCount).filter(value => value.startsWith('/api/')) };
  if (process.argv[3]) {
    await mkdir(path.dirname(process.argv[3]), { recursive: true });
    await writeFile(process.argv[3], JSON.stringify(observation, null, 2));
  }
  console.log(JSON.stringify(observation));
} finally { await browser.close(); }
