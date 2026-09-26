import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../src/lib/seo/checks/all-checks.ts';
import { parseHtml } from '../src/lib/seo/html-parser.ts';
import { run as runAccessibilityChecks } from '../src/lib/seo/checks/accessibility.ts';
import { findingEffort, groupRecommendations } from '../src/lib/audit/report-insights.ts';
import { issueBucket } from '../src/lib/audit/client-insights.ts';
import type { ResourceAuditIssue } from '../src/lib/audit/resource-types.ts';
import { HostRequestScheduler } from '../src/workers/host-request-scheduler.ts';

const brokenHtml = `<!doctype html><html><head>
  <meta name="viewport" content="width=device-width, maximum-scale=1, user-scalable=no">
  <script src="/one.js"></script><script type="module" src="/two.js"></script>
</head><body><div id="root"><main><a href="/empty"></a><button><svg></svg></button><input id="email">
  <div id="duplicate"></div><div id="duplicate"></div><div aria-describedby="missing">Field</div>
  <button tabindex="2">Out of order</button><div aria-hidden="true"><button>Hidden action</button></div></main><main></main></div></body></html>`;
const parsed = parseHtml(brokenHtml, 'https://example.com/');
assert.equal(parsed.accessibility.unnamedLinks, 1);
assert.equal(parsed.accessibility.unnamedButtons, 1);
assert.equal(parsed.accessibility.unlabeledFields, 1);
assert.equal(parsed.accessibility.mainLandmarks, 2);
assert.equal(parsed.accessibility.duplicateIds, 1);
assert.equal(parsed.accessibility.brokenAriaReferences, 1);
assert.equal(parsed.accessibility.positiveTabindex, 1);
assert.equal(parsed.accessibility.hiddenFocusableElements, 1);
assert.equal(parsed.accessibility.zoomRestricted, true);
assert.equal(parsed.likelyJavascriptShell, true);

const checks = runAccessibilityChecks({ ...parsed, url: 'https://example.com/' });
const checkIds = new Set(checks.map((check) => check.id));
for (const id of ['a11y-document-language', 'a11y-unnamed-links', 'a11y-unlabeled-fields', 'a11y-multiple-main-landmarks', 'a11y-duplicate-ids', 'a11y-broken-aria-references', 'a11y-positive-tabindex', 'a11y-hidden-focusable', 'a11y-zoom-restricted', 'javascript-shell-limited-evidence']) {
  assert.ok(checkIds.has(id), `${id} must be reported from measured HTML evidence`);
}

const issue = (patch: Partial<ResourceAuditIssue>): ResourceAuditIssue => ({
  id: 'finding', severity: 'high', category: 'Accessibility', title: 'Form fields without detectable labels',
  description: 'A measured form label is missing.', affectedUrl: 'https://example.com/', evidence: '1 form field has no detectable label.',
  recommendation: 'Associate the field with a label element.', detectedAt: new Date(0).toISOString(), ...patch,
});
assert.equal(issueBucket(issue({})), 'accessibility');
assert.equal(findingEffort(issue({})).label, 'Quick change');
const grouped = groupRecommendations([issue({ id: 'one' }), issue({ id: 'two', affectedUrl: 'https://example.com/contact' })]);
assert.equal(grouped.length, 1);
assert.equal(grouped[0].affectedCount, 2);

let clock = 1_000;
const scheduler = new HostRequestScheduler(2, 0, () => clock, 3, 10_000);
assert.equal(scheduler.recordFailure('https://example.com/a'), false);
assert.equal(scheduler.recordFailure('https://example.com/b'), false);
assert.equal(scheduler.recordFailure('https://example.com/c'), true);
assert.equal(scheduler.isOpen('https://example.com/next'), true);
assert.equal(scheduler.isOpen('https://other.example/'), false);
clock += 10_001;
assert.equal(scheduler.isOpen('https://example.com/recovered'), false);
scheduler.recordFailure('https://example.com/again');
scheduler.recordSuccess('https://example.com/healthy');
assert.equal(scheduler.isOpen('https://example.com/final'), false);

const migration = readFileSync('supabase/migrations/023_product_maturity.sql', 'utf8');
assert.match(migration, /checkpoint_state jsonb/i);
assert.match(migration, /octet_length\(checkpoint_state::text\) <= 262144/i);
assert.match(migration, /project_data_imports[\s\S]*row_count integer[\s\S]*between 0 and 5000/i);
assert.match(migration, /revoke all on public\.project_data_imports from anon, authenticated/i);
assert.match(migration, /validate_finding_workflow_assignment[\s\S]*new\.assigned_to <> new\.user_id/i);
assert.match(migration, /audit_history_summaries/i);
assert.match(migration, /project_audit_summaries/i);
assert.match(migration, /api_schema_version = 14/i);

const worker = readFileSync('src/workers/audit-worker.ts', 'utf8');
assert.match(worker, /recoveredPages/);
assert.match(worker, /checkpointPagesCrawled/);
assert.match(worker, /checkpointState: null/);
assert.match(worker, /slice\(0, 100\)/, 'checkpoint queue must remain bounded');
const importRoutes = readFileSync('src/api/import-routes.ts', 'utf8');
assert.match(importRoutes, /Authentication required/);
assert.match(importRoutes, /private, no-store/);
const accessibilityLayer = readFileSync('src/components/accessibility/AccessibilityLayer.tsx', 'utf8');
assert.match(accessibilityLayer, /aria-live="polite"/);
assert.match(accessibilityLayer, /event\.key !== 'Tab'/);
assert.match(accessibilityLayer, /Ctrl\/Cmd\+K|ctrlKey \|\| event\.metaKey/i);

console.log('Product maturity smoke test passed.');
