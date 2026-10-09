import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expectNoHorizontalOverflow, mockBlogApi } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockBlogApi(page);
});

test('healthy homepage stays lightweight and primary choices are visible', async ({ page }) => {
  const apiRequests: string[] = [];
  const heavyScripts: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
    if (request.resourceType() === 'script' && /@supabase|supabase-vendor|sentry-vendor|editor-vendor|AdminDashboard|BlogManualEditor|pdfkit/.test(request.url())) heavyScripts.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Crawlio website audits.');
  await expect(page.getByRole('combobox', { name: 'Focus', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Coverage', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Audit depth', exact: true })).toBeVisible();
  expect(apiRequests).toEqual([]);
  expect(heavyScripts).toEqual([]);
  await page.getByRole('combobox', { name: 'Focus', exact: true }).selectOption('security');
  await expect(page.getByRole('radio', { name: 'This page', exact: true })).toBeChecked();
  await expect(page.getByText('Only the selected check group.', { exact: false })).toBeVisible();
  await page.getByRole('combobox', { name: 'Focus', exact: true }).selectOption('custom');
  await expect(page.getByRole('checkbox')).toHaveCount(8);
});

test('responsive themes, focus, and reduced motion remain accessible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark mode' }).click();
      await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
      expect(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor)).toBe(theme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(results.violations.filter(item => ['serious', 'critical'].includes(item.impact || '')), `${width}px ${theme}`).toEqual([]);
      if (theme === 'dark') await page.getByRole('button', { name: 'Switch to light mode' }).click();
    }
  }
  await page.getByRole('textbox', { name: 'Website or domain' }).focus();
  expect(await page.getByRole('textbox', { name: 'Website or domain' }).evaluate(node => getComputedStyle(node).boxShadow)).toBe('none');
  expect(await page.locator('.clarity-url-row').evaluate(node => getComputedStyle(node).outlineWidth)).toBe('2px');
  expect(await page.locator('.clarity-flow-left').evaluate(node => parseFloat(getComputedStyle(node).animationDuration))).toBeLessThan(0.01);
});

test('mobile menu supports Escape and restores keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Toggle navigation' });
  await trigger.click();
  await page.getByRole('navigation', { name: 'Mobile public navigation' }).getByRole('link', { name: 'Tools', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await page.getByRole('navigation', { name: 'Mobile public navigation' }).getByRole('link', { name: 'Tools', exact: true }).click();
  await expect(page).toHaveURL('/tools');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  expect(await page.getByRole('heading', { level: 1 }).evaluate(node => getComputedStyle(node).outlineStyle)).toBe('none');
});

test('standalone public tools and legal pages retain readable layouts', async ({ page }) => {
  for (const route of ['/audits', '/audits/security', '/tools/metadata', '/tools/structured-data', '/tools/robots', '/tools/headers', '/pricing', '/reports/example', '/privacy', '/terms', '/acceptable-use', '/cookies', '/contact']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});
