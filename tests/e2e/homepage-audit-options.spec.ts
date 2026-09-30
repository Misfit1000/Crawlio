import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { AUDIT_ID, auditSnapshot, expectNoHorizontalOverflow, mockBlogApi, publicPlanFixture } from './helpers';

test('guest options load on interaction and respect configured Free limits', async ({ page }) => {
  await mockBlogApi(page);
  let planRequests = 0;
  const projection = publicPlanFixture();
  projection.plans[0].pageLimits.quick = 23;
  projection.plans[0].pagesPerAudit = 23;
  await page.route('**/api/tools/plans/public', (route) => {
    planRequests += 1;
    return route.fulfill({ json: { success: true, data: projection } });
  });
  await page.goto('/');
  const form = page.getByRole('form', { name: 'Start a website audit' });
  await expect(form.getByRole('group', { name: 'Audit type' })).toBeVisible();
  await expect(form.getByRole('radio', { name: 'Quick', exact: true })).toBeChecked();
  await expect(form).toContainText('Focused checks');
  expect(planRequests).toBe(0);

  await form.locator('legend').click();
  await expect(form).toContainText('Up to 23 pages');
  await page.getByLabel('Website or domain').fill('example.com');
  await expect(form.getByRole('radio', { name: 'Quick', exact: true })).toBeEnabled();
  await expect(form.getByRole('radio', { name: 'Standard', exact: true })).toBeDisabled();
  await expect(form.getByRole('radio', { name: 'Deep', exact: true })).toBeDisabled();
  await expect(form).toContainText('Not included');
  await page.locator('#pricing').scrollIntoViewIfNeeded();
  await expect(page.locator('#pricing')).toContainText('Up to 23 analysed pages');
  expect(planRequests).toBe(1);
});

for (const mode of ['quick', 'standard', 'deep'] as const) {
  test(`homepage submits the selected ${mode} mode with keyboard-accessible controls`, async ({ page }) => {
    await mockBlogApi(page);
    const projection = publicPlanFixture();
    Object.assign(projection.plans[0], {
      allowedModes: ['quick', 'standard', 'deep'],
      availableModes: ['quick', 'standard', 'deep'],
      pageLimits: { quick: 19, standard: 53, deep: 127 },
      pagesPerAudit: 127,
    });
    await page.route('**/api/tools/plans/public', (route) => route.fulfill({ json: { success: true, data: projection } }));
    let submitted: { url: string; mode: string } | undefined;
    await page.route('**/api/tools/audit/start', (route) => {
      submitted = route.request().postDataJSON();
      return route.fulfill({ json: { success: true, data: { auditId: AUDIT_ID, status: 'queued' } } });
    });
    for (const endpoint of ['status', 'result']) {
      await page.route(`**/api/tools/audit/${endpoint}/${AUDIT_ID}**`, (route) => route.fulfill({ json: { success: true, data: auditSnapshot('queued') } }));
    }
    await page.goto('/');
    await page.getByLabel('Website or domain').fill('example.com');
    const quick = page.getByRole('radio', { name: 'Quick', exact: true });
    await expect(quick).toBeEnabled();
    await quick.focus();
    for (let index = 0; index < ['quick', 'standard', 'deep'].indexOf(mode); index += 1) await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: mode[0].toUpperCase() + mode.slice(1), exact: true })).toBeChecked();
    await expect(page.getByRole('form', { name: 'Start a website audit' })).toContainText(`Up to ${projection.plans[0].pageLimits[mode]} successfully analysed pages`);
    await page.getByRole('button', { name: 'Start audit', exact: true }).click();
    await expect(page).toHaveURL(`/audit/live/${AUDIT_ID}`);
    expect(submitted).toEqual({ url: 'example.com', mode });
  });
}

test('unavailable modes and failed plan loading cannot start an audit', async ({ page }) => {
  await mockBlogApi(page);
  let unavailable = true;
  const projection = publicPlanFixture();
  projection.plans[0].allowedModes = ['quick', 'deep'];
  projection.plans[0].pageLimits.deep = 125;
  await page.route('**/api/tools/plans/public', (route) => unavailable
    ? route.fulfill({ status: 503, json: { success: false, error: 'Unavailable' } })
    : route.fulfill({ json: { success: true, data: projection } }));
  await page.goto('/');
  await page.getByLabel('Website or domain').fill('example.com');
  const form = page.getByRole('form', { name: 'Start a website audit' });
  await expect(form).toContainText('Audit options could not be loaded');
  await expect(form.getByRole('button', { name: 'Start audit', exact: true })).toBeDisabled();
  unavailable = false;
  await form.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Start audit', exact: true })).toBeEnabled();
  await expect(form.getByRole('radio', { name: 'Deep', exact: true })).toBeDisabled();
  await expect(form).toContainText('Unavailable');
  await expect(form).not.toContainText('Up to 125 pages');
});

test('a plan without Quick selects its first available mode', async ({ page }) => {
  await mockBlogApi(page);
  const projection = publicPlanFixture();
  Object.assign(projection.plans[0], {
    allowedModes: ['standard'], availableModes: ['standard'],
    pageLimits: { quick: 0, standard: 500, deep: 0 }, pagesPerAudit: 500,
  });
  await page.route('**/api/tools/plans/public', (route) => route.fulfill({ json: { success: true, data: projection } }));
  await page.goto('/');
  await page.getByLabel('Website or domain').fill('example.com');
  await expect(page.getByRole('radio', { name: 'Standard', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Quick', exact: true })).toBeDisabled();
  await expect(page.getByRole('form', { name: 'Start a website audit' })).toContainText('Up to 500 successfully analysed pages');
  await expect(page.getByRole('button', { name: 'Start audit', exact: true })).toBeEnabled();
});

test('a plan with no operational modes does not offer a runnable fallback', async ({ page }) => {
  await mockBlogApi(page);
  const projection = publicPlanFixture();
  projection.plans[0].availableModes = [];
  await page.route('**/api/tools/plans/public', (route) => route.fulfill({ json: { success: true, data: projection } }));
  await page.goto('/');
  await page.getByLabel('Website or domain').fill('example.com');
  const form = page.getByRole('form', { name: 'Start a website audit' });
  await expect(form).toContainText('No audit types are currently available');
  await expect(form.getByRole('button', { name: 'Start audit', exact: true })).toBeDisabled();
  for (const name of ['Quick', 'Standard', 'Deep']) await expect(form.getByRole('radio', { name, exact: true })).toBeDisabled();
});

for (const width of [390, 768, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`audit selector fits ${width}px in ${theme} mode`, async ({ page }) => {
      await mockBlogApi(page);
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/');
      await page.getByLabel('Website or domain').fill('example.com');
      await expect(page.getByRole('radio', { name: 'Quick', exact: true })).toBeEnabled();
      if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark mode' }).click();
      await expect(expectNoHorizontalOverflow(page)).resolves.toBe(true);
      const form = page.getByRole('form', { name: 'Start a website audit' });
      const bounds = await form.boundingBox();
      expect(bounds?.width).toBeLessThanOrEqual(width);
      for (const name of ['Quick', 'Standard', 'Deep']) await expect(form.locator('label').filter({ hasText: name }).last()).toBeVisible();
      if (width === 390) {
        const results = await new AxeBuilder({ page }).include('#start-audit').analyze();
        expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
      }
      await form.screenshot({ path: `test-results/homepage-audit-selector-${width}-${theme}.png` });
    });
  }
}
