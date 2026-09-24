import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getAuditModeConfig } from '../src/lib/audit/audit-config.ts';
import { AUDIT_PROFILES } from '../src/lib/audit/audit-profiles.ts';
import { DEFAULT_PLAN_LIMITS } from '../src/lib/billing/entitlements.ts';
import {
  PUBLIC_AUDIT_PLANS,
  PUBLIC_PLAN_COMPARISON,
  createPublicPlanComparison,
  createPublicPlanProjection,
  mergePublicPlanPresentation,
} from '../src/lib/plans/public-plan-presentation.ts';

const publicLimits = Object.fromEntries(PUBLIC_AUDIT_PLANS.map((plan) => [plan.id, plan.pagesPerAudit]));
assert.deepEqual(publicLimits, { free: 5, plus: 50, pro: 75 });
assert.equal(publicLimits.free, DEFAULT_PLAN_LIMITS.free.maxPagesQuick);
assert.equal(publicLimits.plus, DEFAULT_PLAN_LIMITS.paid.maxPagesStandard);
assert.equal(publicLimits.pro, DEFAULT_PLAN_LIMITS.agency.maxPagesDeep);
assert.equal(publicLimits.free, AUDIT_PROFILES.free_quick.pageLimit);
assert.equal(publicLimits.plus, AUDIT_PROFILES.paid_standard.pageLimit);
assert.equal(publicLimits.pro, AUDIT_PROFILES.agency_deep.pageLimit);
assert.equal(publicLimits.plus, getAuditModeConfig('standard').pageLimit);
assert.equal(publicLimits.pro, getAuditModeConfig('deep').pageLimit);
assert.equal(DEFAULT_PLAN_LIMITS.admin.maxPagesDeep, AUDIT_PROFILES.admin_deep.pageLimit);
assert.equal(DEFAULT_PLAN_LIMITS.admin.maxPagesDeep, 100);

const pagesRow = PUBLIC_PLAN_COMPARISON.find((row) => row.label === 'Pages per audit');
assert.deepEqual(pagesRow?.values, ['5', '50', '75']);
assert.ok(PUBLIC_AUDIT_PLANS.every((plan) => plan.features.length >= 5 && plan.features.length <= 8));
assert.ok(PUBLIC_AUDIT_PLANS.find((plan) => plan.id === 'plus')?.recommended);

const projection = createPublicPlanProjection([
  { plan: 'free', daily_audits: 4, monthly_audits: 40, max_pages_quick: 6, allowed_modes: ['quick'], exports_enabled: true, pdf_enabled: false, scheduled_audits_enabled: false },
  { plan: 'paid', daily_audits: 30, monthly_audits: 600, max_pages_quick: 40, max_pages_standard: 50, allowed_modes: ['quick', 'standard'], exports_enabled: true, pdf_enabled: true, scheduled_audits_enabled: false },
  { plan: 'agency', daily_audits: 120, monthly_audits: 3600, max_pages_deep: 75, allowed_modes: ['quick', 'standard', 'deep'], exports_enabled: true, pdf_enabled: true, scheduled_audits_enabled: true },
  { plan: 'admin', daily_audits: 999999, max_pages_deep: 1000, priority: 999 },
]);
assert.deepEqual(projection.plans.map((plan) => plan.id), ['free', 'plus', 'pro']);
assert.deepEqual(projection.plans.map((plan) => plan.sourcePlan), ['free', 'paid', 'agency']);
assert.equal(projection.plans.some((plan: any) => plan.priority != null || plan.concurrency != null), false);
const dynamicPlans = mergePublicPlanPresentation(projection);
assert.equal(dynamicPlans[0].pagesPerAudit, 6);
assert.equal(dynamicPlans[1].allowance, '30 daily · 600 monthly');
assert.equal(createPublicPlanComparison(dynamicPlans).find((row) => row.label === 'Scheduled audits')?.values[2], 'Yes');

const [landing, settings, admin, migration, docs, worker] = await Promise.all([
  readFile('src/components/LandingPage.tsx', 'utf8'),
  readFile('src/components/Settings.tsx', 'utf8'),
  readFile('src/components/admin/AdminPlans.tsx', 'utf8'),
  readFile('supabase/migrations/018_full_audit_50_page_limit.sql', 'utf8'),
  readFile('docs/product/plans-and-limits.md', 'utf8'),
  readFile('src/workers/audit-worker.ts', 'utf8'),
]);
assert.match(landing, /loadPublicPlanProjection/);
assert.match(landing, /mergePublicPlanPresentation/);
assert.match(landing, /rootMargin: '800px 0px'/);
assert.doesNotMatch(landing, /Mapped to the current paid plan/);
assert.doesNotMatch(landing, /Deep mode requires an available configured audit engine/);
assert.doesNotMatch(JSON.stringify(PUBLIC_AUDIT_PLANS), /larger report|expanded issue/i, 'dormant internal capacity flags must not become pricing claims');
assert.match(settings, /maxPages: 50/);
assert.match(admin, /value=\{plan\.maxPagesStandard\}/);
assert.match(migration, /max_pages_standard\s*=\s*50/);
assert.match(docs, /50 pages/);
assert.match(worker, /Math\.min\(profile\.pageLimit, admittedPageLimit\)/, 'worker must honor the admitted row limit without exceeding its profile ceiling');

console.log('Public plan presentation smoke test passed: Free 5, Plus 50, Pro 75, Admin Deep 100.');
