import { chromium, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [baseUrl, outputDirectory] = process.argv.slice(2);
if (!baseUrl || !outputDirectory) {
  throw new Error('Usage: npx tsx scripts/measure-experience.mts <base-url> <output-directory>');
}

const output = resolve(outputDirectory);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });

async function measure(page: Page, label: string) {
  const requests: string[] = [];
  const onRequest = (request: { url(): string }) => requests.push(request.url());
  page.on('request', onRequest);
  const started = performance.now();
  const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('h1').first().waitFor();
  await page.waitForTimeout(1_000);
  const elapsedMs = Math.round(performance.now() - started);
  const metrics = await page.evaluate(() => {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const scripts = resources.filter((resource) => resource.initiatorType === 'script' || /\/assets\/.*\.js(?:$|\?)/.test(resource.name));
    return {
      transferredJsBytes: scripts.reduce((sum, resource) => sum + resource.transferSize, 0),
      decodedJsBytes: scripts.reduce((sum, resource) => sum + resource.decodedBodySize, 0),
      scriptRequests: scripts.length,
      domContentLoadedMs: Math.round(navigation?.domContentLoadedEventEnd || 0),
      transferBytes: resources.reduce((sum, resource) => sum + resource.transferSize, 0),
      resources: resources.length,
    };
  });
  page.off('request', onRequest);
  return { label, status: response?.status() || null, requests: requests.length, elapsedMs, ...metrics };
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const cold = await measure(page, 'cold');
  const repeat = await measure(page, 'repeat');
  await context.close();

  const captures = [];
  for (const width of [390, 768, 1440]) {
    for (const theme of ['light', 'dark'] as const) {
      const captureContext = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const capturePage = await captureContext.newPage();
      await capturePage.addInitScript((mode) => localStorage.setItem('crawlio-theme-v1', mode), theme);
      await capturePage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await capturePage.locator('h1').first().waitFor();
      await capturePage.waitForTimeout(350);
      const name = `homepage-${width}-${theme}.png`;
      await capturePage.screenshot({ path: resolve(output, `hero-${width}-${theme}.png`), animations: 'disabled' });
      await capturePage.evaluate(async () => {
        for (let position = 0; position < document.documentElement.scrollHeight; position += window.innerHeight * 0.8) {
          window.scrollTo(0, position);
          await new Promise((done) => setTimeout(done, 35));
        }
        window.scrollTo(0, 0);
      });
      await capturePage.screenshot({ path: resolve(output, name), fullPage: true, animations: 'disabled' });
      captures.push({ width, theme, file: name, horizontalOverflow: await capturePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth) });
      await captureContext.close();
    }
  }
  const result = { baseUrl, measuredAt: new Date().toISOString(), cold, repeat, captures };
  await writeFile(resolve(output, 'measurements.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
