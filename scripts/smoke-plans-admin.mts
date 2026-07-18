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
  (error) => error instanceof EntitlementError && error.message === 'Standard and Deep audits require a paid plan.' && error.upgradeRequired,
);

assert.equal(resolveEffectiveAuditMode('paid', 'standard'), 'standard');
assert.equal(resolveEffectiveAuditMode('paid', 'quick'), 'standard');
assert.equal(resolveEffectiveAuditMode('admin', 'quick'), 'standard');
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
assert.equal(DEFAULT_PLAN_LIMITS.admin.maxPagesStandard, 50);
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
const adminUsers = readFileSync(join(root, 'src/components/admin/AdminUsersView.tsx'), 'utf8');
const adminRoutes = readFileSync(join(root, 'src/api/admin/control-center.ts'), 'utf8');
assert.match(adminPanel, /user\.role !== 'admin'/);
assert.match(adminUsers, /runAdminUserAction/);
assert.match(adminPanel, /updatePlanLimit/);
assert.match(adminPanel, /getAdminWorkers/);
assert.match(adminRoutes, /ADMIN_SELF_PROTECTION|ADMIN_REASON_REQUIRED/);
assert.match(adminRoutes, /last active administrator|activeAdminCount/i);

const worker = readFileSync(join(root, 'src/workers/audit-worker.ts'), 'utf8');
assert.match(worker, /plan=\$\{audit\.plan\}/);
assert.match(worker, /priority=\$\{audit\.queuePriority\}/);
assert.doesNotMatch(worker, /<!doctype html>/i);

console.log('Plans and admin smoke test passed.');
