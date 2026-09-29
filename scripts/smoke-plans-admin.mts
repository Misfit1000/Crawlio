import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PLAN_LIMITS,
  EntitlementError,
  canStartAudit,
  resolveEffectiveAuditMode,
} from '../src/lib/billing/entitlements.ts';
import { getAuditProfile, isSeoIssueAllowedForProfile } from '../src/lib/audit/audit-profiles.ts';
import { planPageCeiling } from '../src/lib/audit/scalable-policy.ts';

const root = process.cwd();

assert.equal(existsSync(join(root, 'supabase/migrations/003_plans_admin_limits.sql')), true);
assert.equal(existsSync(join(root, 'src/lib/billing/entitlements.ts')), true);
assert.equal(existsSync(join(root, 'src/lib/audit/audit-profiles.ts')), true);
assert.equal(existsSync(join(root, 'docs/product/plans-and-limits.md')), true);
assert.equal(existsSync(join(root, 'docs/admin/admin-panel.md')), true);

const freeDecision = await canStartAudit(null, 'quick', { guestKey: 'guest:smoke' });
assert.equal(freeDecision.plan, 'free');
assert.equal(freeDecision.effectiveMode, 'quick');
assert.equal(freeDecision.pageLimit, 5);

await assert.rejects(
  () => canStartAudit(null, 'standard', { guestKey: 'guest:standard' }),
  (error) => error instanceof EntitlementError && error.message === 'This audit mode is not enabled for your plan.' && error.upgradeRequired,
);

assert.equal(resolveEffectiveAuditMode('paid', 'standard'), 'standard');
assert.equal(resolveEffectiveAuditMode('paid', 'quick'), 'quick');
assert.equal(resolveEffectiveAuditMode('admin', 'quick'), 'quick');
assert.equal(resolveEffectiveAuditMode('free', 'standard', { allowedModes: ['quick', 'standard'] }), 'standard');
assert.equal(resolveEffectiveAuditMode('agency', 'deep', { deepAuditEnabled: true }), 'deep');
assert.equal(resolveEffectiveAuditMode('admin', 'deep', { deepAuditEnabled: true }), 'deep');
assert.throws(() => resolveEffectiveAuditMode('agency', 'deep'), /Deep Audit requires a dedicated always-on worker/);

assert.ok(DEFAULT_PLAN_LIMITS.paid.priority > DEFAULT_PLAN_LIMITS.free.priority);
assert.ok(DEFAULT_PLAN_LIMITS.agency.priority > DEFAULT_PLAN_LIMITS.paid.priority);
assert.equal(DEFAULT_PLAN_LIMITS.free.allowedModes.includes('standard'), false);
assert.equal(DEFAULT_PLAN_LIMITS.paid.allowedModes.includes('standard'), true);
assert.equal(DEFAULT_PLAN_LIMITS.agency.allowedModes.includes('deep'), true);

const freeProfile = getAuditProfile('free', 'quick');
const paidProfile = getAuditProfile('paid', 'standard');
const agencyProfile = getAuditProfile('agency', 'deep');
assert.equal(freeProfile.pageLimit, 5);
assert.equal(DEFAULT_PLAN_LIMITS.paid.maxPagesStandard, 50);
assert.equal(DEFAULT_PLAN_LIMITS.agency.maxPagesStandard, 50);
assert.equal(DEFAULT_PLAN_LIMITS.admin.maxPagesStandard, 1000);
assert.equal(DEFAULT_PLAN_LIMITS.admin.maxPagesQuick, 1000);
assert.equal(DEFAULT_PLAN_LIMITS.admin.maxPagesDeep, 1000);
for (const plan of ['free', 'paid', 'agency']) assert.equal(planPageCeiling(plan), 500);
assert.equal(planPageCeiling('admin'), 5000);
assert.equal(paidProfile.pageLimit, 50);
assert.equal(agencyProfile.pageLimit, 75);
assert.equal(isSeoIssueAllowedForProfile(freeProfile, { category: 'performance', id: 'heavy-js' }), false);
assert.equal(isSeoIssueAllowedForProfile(freeProfile, { category: 'on-page', id: 'title-missing' }), true);

const migration = readFileSync(join(root, 'supabase/migrations/003_plans_admin_limits.sql'), 'utf8');
assert.match(migration, /create table if not exists public\.plan_limits/i);
assert.match(migration, /create table if not exists public\.admin_actions/i);
assert.match(migration, /guard_user_profile_self_update/i);
assert.match(migration, /public\.is_admin_user/i);
assert.match(migration, /audits_status_priority_created_at_idx/i);

const adminPanel = readFileSync(join(root, 'src/components/AdminDashboard.tsx'), 'utf8');
assert.match(adminPanel, /user\.role !== 'admin'/);
assert.match(readFileSync(join(root, 'src/components/admin/AdminUsers.tsx'), 'utf8'), /updateUserAdminFields/);
const adminPlans = readFileSync(join(root, 'src/components/admin/AdminPlans.tsx'), 'utf8');
assert.match(adminPlans, /updatePlanLimit/);
assert.match(adminPlans, /allowedModes/);
assert.equal((adminPlans.match(/max=\{planPageCeiling\(plan.plan\)\}/g) || []).length, 3);
assert.doesNotMatch(adminPlans, /AUDIT_MODE_PAGE_CEILINGS/);
const auditForm = readFileSync(join(root, 'src/components/SeoAudit.tsx'), 'utf8');
const analyzerForm = readFileSync(join(root, 'src/components/WebsiteAnalyzer.tsx'), 'utf8');
const authContext = readFileSync(join(root, 'src/contexts/AuthContext.tsx'), 'utf8');
const api = readFileSync(join(root, 'src/api/index.ts'), 'utf8');
assert.match(auditForm, /useAuditEntitlements/);
assert.match(analyzerForm, /useAuditEntitlements/);
assert.doesNotMatch(auditForm, /canUseStandard|canUseDeep/);
assert.doesNotMatch(analyzerForm, /canUseStandard|canUseDeep/);
assert.match(authContext, /auditEntitlements/);
assert.match(api, /allowed_modes/);
assert.match(api, /AUDIT_MODE_PAGE_CEILINGS/);
assert.equal((api.match(/max_pages_(?:quick|standard|deep): \[0, planPageCeiling\(String\(req.params.plan\)\)\]/g) || []).length, 3);
assert.match(api, /SCALABLE_AUDIT_UNAVAILABLE/);
assert.match(api, /INVALID_AUDIT_MODE/);
assert.match(readFileSync(join(root, 'src/components/admin/AdminWorkers.tsx'), 'utf8'), /getAdminWorkers/);

const worker = readFileSync(join(root, 'src/workers/audit-worker.ts'), 'utf8');
assert.match(worker, /plan=\$\{audit\.plan\}/);
assert.match(worker, /priority=\$\{audit\.queuePriority\}/);
assert.doesNotMatch(worker, /<!doctype html>/i);

console.log('Plans and admin smoke test passed.');
