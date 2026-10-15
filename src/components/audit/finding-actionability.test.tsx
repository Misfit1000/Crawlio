import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { load } from 'cheerio';
import { AuditFindingRow } from './AuditFindingRow';
import { useFindingWorkflow } from './useFindingWorkflow';
import { readChecklist, readFindingNotes } from '../../lib/audit/client-insights';
import { findingWorkflowKey, findingWorkflowResolutionDetail, findingWorkflowStatusLabel } from '../../lib/audit/finding-workflow';
import { findingComparisonInsights, groupFindingFixBatches, groupRecommendations } from '../../lib/audit/report-insights';
import { makeAuditScope } from '../../lib/audit/audit-scope';
import type { AuditComparison, ResourceAuditIssue } from '../../lib/audit/resource-types';

const issue = (id: string, overrides: Partial<ResourceAuditIssue> = {}): ResourceAuditIssue => ({
  id, severity: 'medium', category: 'metadata', title: 'Missing title', checkId: 'title.presence',
  description: 'No title was found.', recommendation: 'Add a descriptive page title.',
  affectedUrl: `https://example.com/${id}`, evidence: `Title missing on ${id}.`,
  detectedAt: '2026-10-01T00:00:00Z', ...overrides,
});

const comparison = (overrides: Partial<AuditComparison> = {}): AuditComparison => ({
  currentAuditId: 'current', baselineAuditId: 'baseline', normalizedUrl: 'https://example.com/',
  currentScore: null, baselineScore: null, scoreDelta: null,
  newIssues: [issue('new')], resolvedIssues: [issue('resolved')],
  persistentIssues: [{ current: issue('remaining'), baseline: issue('remaining') }], ...overrides,
});

function mockWindow(t: { after: (callback: () => void) => void }, search = '') {
  const previous = globalThis.window;
  const values = new Map<string, string>();
  globalThis.window = {
    location: { search },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  } as unknown as Window & typeof globalThis;
  t.after(() => { if (previous) globalThis.window = previous; else Reflect.deleteProperty(globalThis, 'window'); });
}

let workspacePromise: Promise<React.ComponentType<any>> | undefined;
function loadWorkspace() {
  // Compile only this component for Node rendering; CSS is irrelevant to these assertions.
  return workspacePromise ??= build({
    entryPoints: [fileURLToPath(new URL('./FindingWorkspace.tsx', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
  }).then(result => {
    const module = { exports: {} as any };
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
    return module.exports.default;
  });
}

test('fix batches count unique affected URLs, not source links or overlapping reported reach', () => {
  const issues = [issue('one', { evidence: '', affectedPageCount: 50, sourceUrls: ['https://source.test/'] }),
    issue('two', { severity: 'high' }), issue('duplicate', { affectedUrl: 'https://example.com/two' }),
    issue('unknown', { affectedUrl: '' })];
  const [batch] = groupFindingFixBatches(issues);
  assert.equal(batch.issues.length, 4);
  assert.equal(batch.affectedCount, 2);
  assert.deepEqual(batch.affectedUrls, ['https://example.com/one', 'https://example.com/two']);
  assert.equal(batch.severity, 'high');
  assert.equal(batch.representative.id, 'two');
  assert.equal(issues[0].evidence, '', 'batch grouping must not mutate immutable audit evidence');
});

test('different checks, failure types and recommended fixes cannot silently share a fix batch', () => {
  const inputs = [issue('a'), issue('b', { checkId: 'title.length' }),
    issue('c', { failureCode: 'CHECK_UNAVAILABLE' }), issue('d', { recommendation: 'Remove a duplicate title.' })];
  assert.equal(groupFindingFixBatches(inputs).length, 4);
  assert.equal(new Set(groupFindingFixBatches(inputs).map(batch => batch.id)).size, 4);
  assert.equal(groupRecommendations([issue('a', { title: 'Title: missing' }), issue('b', { title: 'Title missing' })]).length, 2);
});

test('grouped export inputs retain all stored evidence and URLs despite bounded UI rendering', () => {
  const inputs = Array.from({ length: 75 }, (_, index) => issue(String(index)));
  const [group] = groupRecommendations(inputs);
  assert.equal(group.evidence.length, 75);
  assert.equal(group.affectedUrls.length, 75);
  assert.equal(group.affectedCount, 75);
});

test('manual fixed status never implies audit verification', () => {
  assert.equal(findingWorkflowStatusLabel('fixed'), 'Marked fixed');
  assert.match(findingWorkflowResolutionDetail('fixed')!, /user or administrator/);
  assert.match(findingWorkflowResolutionDetail('fixed')!, /not audit-verified/);
  assert.equal(findingWorkflowResolutionDetail('in_progress'), null);
});

test('comparison labels require explicit matching evidence and the correct current audit', () => {
  const insights = findingComparisonInsights(comparison(), 'current')!;
  assert.deepEqual(insights.counts, { new: 1, resolved: 1, remaining: 1 });
  assert.equal(insights.changes.get(findingWorkflowKey(issue('new'))), 'new');
  assert.equal(insights.changes.get(findingWorkflowKey(issue('remaining'))), 'remaining');
  assert.equal(insights.changes.get(findingWorkflowKey(issue('resolved'))), 'resolved');
  assert.equal(insights.changes.get(findingWorkflowKey(issue('not-loaded'))), undefined);
  assert.equal(findingComparisonInsights(comparison(), 'different'), null);
  assert.equal(findingComparisonInsights(comparison({ baselineAuditId: 'current' }), 'current'), null);
  assert.equal(findingComparisonInsights(null, 'current'), null);
});

test('aggregate comparisons expose counts but never synthesize per-finding changes or missing zeroes', () => {
  const insights = findingComparisonInsights(comparison({ aggregateOnly: true, issueCounts: { new: 0, resolved: 32, persistent: 8 } }), 'current')!;
  assert.equal(insights.changes.size, 0);
  assert.deepEqual(insights.counts, { new: 0, resolved: 32, remaining: 8 });
  const unknown = findingComparisonInsights(comparison({ aggregateOnly: true }), 'current')!;
  assert.deepEqual(unknown.counts, { new: null, resolved: null, remaining: null });
});

test('report rows expose representative evidence and preserve controls without mounting closed evidence lists', () => {
  const $ = load(renderToStaticMarkup(<AuditFindingRow severity="high" category="metadata" title="Missing title"
    evidence={Array.from({ length: 50 }, (_, index) => `Evidence ${index}`)}
    affectedUrls={['https://example.com/a', 'https://example.com/a', 'https://example.com/b']}
    workflowStatus="fixed" comparisonChange="resolved" statusControl={<button>Existing status control</button>} />));
  assert.match($.text(), /2 affected URLs/);
  assert.match($.text(), /Representative evidence: Evidence 0/);
  assert.doesNotMatch($.text(), /Evidence 49/);
  assert.equal($('li').length, 0, 'closed details must not mount potentially large evidence lists');
  assert.equal($('button').text(), 'Existing status control');
  assert.match($.text(), /not audit-verified resolution/);
  assert.match($.text(), /Review crawl coverage/);
});

test('workspace batches preserve mixed statuses, scope, filters and bounded individual rendering', async t => {
  mockWindow(t);
  const Workspace = await loadWorkspace();
  const inputs = Array.from({ length: 55 }, (_, index) => issue(String(index)));
  const statuses = { [findingWorkflowKey(inputs[0])]: 'fixed', [findingWorkflowKey(inputs[1])]: 'in_progress' };
  const $ = load(renderToStaticMarkup(<Workspace auditId="current" issues={inputs} statuses={statuses} comparison={comparison()} />));
  assert.equal($('.audit-finding-work-row').length, 1);
  assert.match($.text(), /55 affected URLs/);
  assert.match($.text(), /1 Marked fixed/);
  assert.match($.text(), /1 in progress/);
  assert.match($.text(), /not audit-verified resolution/);
  assert.match($.text(), /Whole-comparison totals, not the current filters/);

  window.location.search = '?group=individual';
  const individual = load(renderToStaticMarkup(<Workspace issues={inputs} />));
  assert.equal(individual('.audit-finding-work-row').length, 20);
  assert.match(individual.text(), /Page 1 of 3/);
  window.location.search = '?finding=does-not-match';
  assert.match(renderToStaticMarkup(<Workspace issues={inputs} />), /No findings match/);
  window.location.search = '';
  const scoped = load(renderToStaticMarkup(<Workspace issues={[...inputs, issue('security', { category: 'security', title: 'Missing HSTS', checkId: 'security' })]} scope={makeAuditScope('seo')} />));
  assert.doesNotMatch(scoped.text(), /Missing HSTS/);
});

test('paginated evidence batches describe only the currently loaded filtered page', async t => {
  mockWindow(t);
  const Workspace = await loadWorkspace();
  const $ = load(renderToStaticMarkup(<Workspace issues={[issue('a'), issue('b')]}
    evidenceFilters={{ query: '', category: 'all', severity: 'all', section: 'all', onChange() {} }} />));
  assert.match($.text(), /2 affected URLs loaded/);
  assert.match($.text(), /this loaded evidence page only/);
  assert.equal($('input[type="search"]').length, 1);
  assert.equal($('select[aria-label="Filter all findings by report section"]').length, 1);
});

test('rapid device workflow updates retain every batch member and do not fabricate resolution metadata', async t => {
  mockWindow(t);
  let workflow!: ReturnType<typeof useFindingWorkflow>;
  function Harness() { workflow = useFindingWorkflow('device-audit', []); return null; }
  renderToStaticMarkup(<Harness />);
  const first = await workflow.update('first', { status: 'fixed', notes: 'Changed metadata.' });
  await workflow.update('second', { status: 'in_progress', notes: 'Review template.' });
  await workflow.update('first', { notes: 'Ready for repeat audit.' });
  assert.deepEqual(readChecklist('device-audit'), { first: 'fixed', second: 'in_progress' });
  assert.deepEqual(readFindingNotes('device-audit'), { first: 'Ready for repeat audit.', second: 'Review template.' });
  assert.equal(first.resolvedAt, null);
  assert.equal(first.resolvedBy, null);
});

test('browser batch selection, bounded drawers, focus restoration and lazy report evidence work', {
  skip: process.env.CRAWLIO_FINDING_BROWSER_TEST !== 'true',
}, async t => {
  const fixtureIssues = Array.from({ length: 45 }, (_, index) => issue(String(index), {
    affectedUrl: `https://example.com/${index === 1 ? 0 : index}`,
    sourceUrls: Array.from({ length: 35 }, (_, source) => `https://example.com/source-${source}`),
  }));
  const result = await build({
    stdin: { resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'tsx', contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import FindingWorkspace from './FindingWorkspace';
      import { AuditFindingRow } from './AuditFindingRow';
      const issues = ${JSON.stringify(fixtureIssues)};
      window.findingFixture = { updates: [], notes: [] };
      function Fixture() {
        const [statuses, setStatuses] = useState({});
        const [records, setRecords] = useState({});
        return <><FindingWorkspace auditId="current" issues={issues} statuses={statuses} workflowRecords={records}
          onStatusChange={(key, status) => {
            window.findingFixture.updates.push(key);
            setStatuses(value => ({ ...value, [key]: status }));
          }}
          onWorkflowSave={async (key, patch) => {
            window.findingFixture.notes.push(patch.notes);
            const record = { findingKey: key, notes: patch.notes };
            setRecords(value => ({ ...value, [key]: record }));
            return record;
          }} />
          <AuditFindingRow severity="high" category="metadata" title="Report batch"
            evidence={Array.from({ length: 13 }, (_, index) => 'Stored evidence ' + index)}
            affectedUrls={Array.from({ length: 13 }, (_, index) => 'https://example.com/report-' + index)} />
        </>;
      }
      createRoot(document.getElementById('root')).render(<Fixture />);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', minify: true,
    loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://finding-fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }));
  await page.goto('http://finding-fixture.test/');
  await page.addScriptTag({ content: result.outputFiles[0].text });
  const workspace = page.locator('section[aria-labelledby="finding-workspace-title"]');
  await workspace.getByRole('checkbox', { name: /45 loaded findings in fix batch/ }).check();
  await workspace.getByRole('combobox').filter({ has: page.locator('option', { hasText: 'Bulk status...' }) }).selectOption('fixed');
  assert.equal(await page.evaluate(() => (window as any).findingFixture.updates.length), 44, 'duplicate workflow keys must be saved only once');
  await workspace.getByRole('button', { name: 'Open details for Missing title' }).click();
  const dialog = page.getByRole('dialog');
  const members = dialog.getByRole('region', { name: 'Fix batch members' });
  assert.equal(await members.locator('li').count(), 20);
  await members.getByRole('button', { name: 'Next members' }).click();
  assert.equal(await members.locator('li').count(), 20);
  await members.getByRole('button', { name: 'Next members' }).click();
  assert.equal(await members.locator('li').count(), 5);
  await members.getByRole('button', { name: /https:\/\/example.com\/40/ }).click();
  assert.match(await dialog.textContent() || '', /not audit-verified resolution/);
  await dialog.getByRole('button', { name: 'Next URLs' }).click();
  assert.match(await dialog.textContent() || '', /URL page 2 of 2/);
  await dialog.getByRole('textbox', { name: 'Implementation note' }).fill('Template updated, awaiting repeat audit.');
  await dialog.getByRole('button', { name: 'Save details' }).click();
  assert.deepEqual(await page.evaluate(() => (window as any).findingFixture.notes), ['Template updated, awaiting repeat audit.']);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open details for Missing title');
  await workspace.getByRole('button', { name: 'Individual findings (45)' }).click();
  assert.equal(await workspace.locator('.audit-finding-work-row').count(), 20);
  await workspace.getByRole('button', { name: 'Next', exact: true }).click();
  assert.equal(await workspace.locator('.audit-finding-work-row').count(), 20);
  const report = page.locator('.audit-report-finding');
  assert.equal(await report.locator('li').count(), 0);
  await report.locator('summary').click();
  await report.locator('li').first().waitFor();
  assert.equal(await report.locator('li').count(), 20);
  await report.getByRole('button', { name: 'Next evidence' }).click();
  assert.equal(await report.locator('li').count(), 6);
  await report.locator('summary').click();
  await report.locator('li').first().waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
});
