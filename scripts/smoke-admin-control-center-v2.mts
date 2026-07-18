import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canApplyAuditAction,
  escapeCsvCell,
  getUserActionGuard,
  normalizeAdminResourceLink,
  retentionFingerprint,
  retentionPreviewIsUsable,
  rowsToCsv,
  validateBulkAuditSelection,
} from '../src/lib/admin/control-center';
import {
  invalidateAdminReadCache,
  readCachedAdminData,
  resetAdminReadCacheForTests,
} from '../src/lib/admin/read-cache';

const mode = process.argv[2] || 'all';
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const routeSource = read('src/api/admin/control-center.ts');
const clientSource = read('src/lib/admin/client.ts');
const dashboardSource = read('src/components/AdminDashboard.tsx');
const legacyDataService = read('src/services/supabaseDataService.ts');
const migration = read('supabase/migrations/020_admin_control_center.sql');
const contentView = read('src/components/admin/AdminContentHealthView.tsx');
const resourcesView = read('src/components/admin/AdminResourcesView.tsx');

function adminApiContract() {
  assert.match(routeSource, /profile\.role !== 'admin'/);
  assert.match(routeSource, /profile\.disabled/);
  assert.match(routeSource, /Cache-Control', 'private, no-store, max-age=0'/);
  assert.match(routeSource, /boundedPageSize/);
  assert.match(routeSource, /ADMIN_BULK_AUDIT_MAX/);
  assert.match(routeSource, /AUDIT_STATE_CONFLICT/);
  assert.match(routeSource, /Content-Disposition/);
  assert.match(routeSource, /rowsToCsv/);
  assert.doesNotMatch(routeSource, /res\.json\([^)]*SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(clientSource, /getAuthHeaders/);
  assert.doesNotMatch(clientSource, /from\(['"]user_profiles/);
  assert.match(dashboardSource, /AdminOperationsView/);
  assert.match(dashboardSource, /AdminUsersView/);
  assert.match(dashboardSource, /AdminResourcesView/);
  assert.doesNotMatch(dashboardSource, /window\.prompt/);
  assert.doesNotMatch(legacyDataService, /\.from\(['"]admin_actions['"]\)/);
  assert.doesNotMatch(legacyDataService, /getAllUsers|getAdminAudits|deleteAnyDocument/);
}

function userGuardrails() {
  const selfDemotion = getUserActionGuard({
    actorId: 'a',
    targetId: 'a',
    targetRole: 'admin',
    activeAdminCount: 2,
    action: 'update_access',
    nextRole: 'user',
  });
  assert.equal(selfDemotion.allowed, false);
  assert.equal(selfDemotion.code, 'ADMIN_SELF_PROTECTION');

  const lastAdmin = getUserActionGuard({
    actorId: 'a',
    targetId: 'b',
    targetRole: 'admin',
    activeAdminCount: 1,
    action: 'suspend',
  });
  assert.equal(lastAdmin.allowed, false);
  assert.equal(lastAdmin.code, 'LAST_ADMIN_PROTECTION');

  assert.equal(getUserActionGuard({
    actorId: 'a',
    targetId: 'a',
    targetRole: 'admin',
    activeAdminCount: 1,
    action: 'update_access',
  }).allowed, true);

  assert.equal(validateBulkAuditSelection([]).valid, false);
  assert.equal(validateBulkAuditSelection(Array.from({ length: 26 }, (_, index) => `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`)).valid, false);
  const validId = '00000000-0000-4000-8000-000000000001';
  const selection = validateBulkAuditSelection([validId, validId]);
  assert.equal(selection.valid, true);
  if (selection.valid) assert.equal(selection.ids.length, 1);
  assert.equal(canApplyAuditAction('running', 'cancel'), true);
  assert.equal(canApplyAuditAction('completed', 'cancel'), false);
  assert.equal(canApplyAuditAction('failed', 'retry'), true);
}

function exportAndLinkSafety() {
  assert.equal(escapeCsvCell('=HYPERLINK("https://invalid")'), `"'=HYPERLINK(""https://invalid"")"`);
  const csv = rowsToCsv([{ email: '=cmd', note: 'line 1\nline 2' }], ['email', 'note']);
  assert.match(csv, /'=cmd/);
  assert.match(csv, /"line 1\r?\nline 2"/);
  assert.equal(normalizeAdminResourceLink('http://github.com/example'), null);
  assert.equal(normalizeAdminResourceLink('https://evil.example/supabase.com'), null);
  assert.equal(normalizeAdminResourceLink('https://app.supabase.com/project/test')?.startsWith('https://app.supabase.com/'), true);
  assert.equal(normalizeAdminResourceLink('https://dashboard.render.com/web/test')?.startsWith('https://dashboard.render.com/'), true);
  assert.equal(normalizeAdminResourceLink('https://sentry.io/settings/?authToken=secret'), null);
  assert.equal(normalizeAdminResourceLink('https://vercel.com/project?code=temporary-secret'), null);
}

function retentionSafety() {
  const createdAt = '2026-07-18T00:00:00.000Z';
  const preview = { activityEvents: 12, diagnostics: 3, applied: false };
  const fingerprint = retentionFingerprint(preview, 'admin-id', createdAt);
  assert.equal(fingerprint.length, 64);
  assert.equal(fingerprint, retentionFingerprint(preview, 'admin-id', createdAt));
  const valid = retentionPreviewIsUsable({
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    expectedFingerprint: fingerprint,
    suppliedFingerprint: fingerprint,
    confirmation: 'APPLY RETENTION',
    reason: 'Routine cleanup',
  });
  assert.equal(valid.valid, true);
  assert.equal(retentionPreviewIsUsable({
    expiresAt: new Date(Date.now() - 1).toISOString(),
    expectedFingerprint: fingerprint,
    suppliedFingerprint: fingerprint,
    confirmation: 'APPLY RETENTION',
    reason: 'Routine cleanup',
  }).valid, false);
  assert.equal(retentionPreviewIsUsable({
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    expectedFingerprint: fingerprint,
    suppliedFingerprint: '0'.repeat(64),
    confirmation: 'APPLY RETENTION',
    reason: 'Routine cleanup',
  }).valid, false);
  assert.match(routeSource, /is\('applied_at', null\)/);
  assert.match(routeSource, /RETENTION_PREVIEW_INTEGRITY_FAILED/);
  assert.match(routeSource, /retentionFingerprint\(preview\.preview, preview\.admin_user_id, preview\.created_at\)/);
  assert.match(resourcesView, /APPLY RETENTION/);
}

function contentHealthContract() {
  for (const value of ['draft_review', 'overdue_schedule', 'missing_seo', 'publication_gate', 'stalled_job', 'failed_job', 'stale_article', 'image_licence']) {
    assert.match(routeSource, new RegExp(value));
  }
  assert.match(routeSource, /hold_publication/);
  assert.match(routeSource, /recover_job/);
  assert.match(routeSource, /validate_post/);
  assert.match(contentView, /Open post/);
  assert.match(contentView, /Deterministic checks passed/);
  assert.doesNotMatch(contentView, /Google indexing confirmed|ranking guaranteed|traffic gained/i);
}

function resourceInventoryContract() {
  assert.match(migration, /create or replace function public\.admin_resource_inventory/);
  assert.match(migration, /create or replace function public\.admin_operations_timeseries/);
  assert.match(routeSource, /usageAvailability/);
  assert.match(routeSource, /provider-dashboard-only/);
  assert.match(routeSource, /normalizeAdminResourceLinks/);
  assert.match(routeSource, /databaseDeployment\?\.api_schema_version === API_SCHEMA_VERSION/);
  assert.match(routeSource, /cachedAdminResponse/);
  assert.match(routeSource, /from\('user_profiles'\)\.select\(USER_LIST_FIELDS, \{ count: 'planned' \}\)/);
  assert.match(routeSource, /from\('audits'\)\.select\(AUDIT_LIST_FIELDS, \{ count: 'planned' \}\)/);
  assert.match(routeSource, /from\('admin_actions'\)\.select\([^;]+count: 'planned'/);
  assert.match(routeSource, /role', 'admin'\)\.eq\('disabled', false\)/);
  assert.match(clientSource, /pendingAdminGets/);
  assert.match(clientSource, /authHeaders\.Authorization \|\| 'anonymous'/);
  assert.doesNotMatch(routeSource, /serviceRoleKey\s*:/i);
}

async function loadEfficiencyContract() {
  resetAdminReadCacheForTests();
  let loads = 0;
  const first = await readCachedAdminData('overview:24h', 100, async () => {
    loads += 1;
    return { value: 1 };
  }, 1_000);
  const second = await readCachedAdminData('overview:24h', 100, async () => {
    loads += 1;
    return { value: 2 };
  }, 1_050);
  assert.equal(first.status, 'miss');
  assert.equal(second.status, 'hit');
  assert.equal(second.value.value, 1);
  assert.equal(loads, 1);

  resetAdminReadCacheForTests();
  let release!: (value: number) => void;
  const deferred = new Promise<number>((resolve) => { release = resolve; });
  const pendingFirst = readCachedAdminData('resources', 100, () => deferred, 2_000);
  const pendingSecond = readCachedAdminData('resources', 100, async () => 99, 2_000);
  release(42);
  const [loaded, shared] = await Promise.all([pendingFirst, pendingSecond]);
  assert.equal(loaded.status, 'miss');
  assert.equal(shared.status, 'shared');
  assert.equal(shared.value, 42);

  invalidateAdminReadCache('resources');
  const afterInvalidation = await readCachedAdminData('resources', 100, async () => 7, 2_010);
  assert.equal(afterInvalidation.status, 'miss');
  assert.equal(afterInvalidation.value, 7);

  resetAdminReadCacheForTests();
  let releaseStale!: (value: number) => void;
  const staleLoad = readCachedAdminData(
    'overview:24h',
    100,
    () => new Promise<number>((resolve) => { releaseStale = resolve; }),
    3_000,
  );
  invalidateAdminReadCache('overview:');
  const freshAfterInvalidation = readCachedAdminData('overview:24h', 100, async () => 12, 3_010);
  assert.equal((await freshAfterInvalidation).value, 12);
  releaseStale(11);
  assert.equal((await staleLoad).value, 11);
  const cachedFreshLoad = await readCachedAdminData('overview:24h', 100, async () => 13, 3_020);
  assert.equal(cachedFreshLoad.status, 'hit');
  assert.equal(cachedFreshLoad.value, 12);
}

function migrationContract() {
  for (const value of ['admin_user_notes', 'account_deletion_requests', 'admin_operation_previews']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${value}`));
    assert.match(migration, new RegExp(`alter table public\\.${value} enable row level security`));
  }
  assert.match(migration, /disabled_at timestamptz/);
  assert.match(migration, /disabled_reason text/);
  assert.match(migration, /create or replace function public\.is_active_user/);
  assert.match(migration, /create or replace function public\.guard_last_active_admin/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /if auth\.uid\(\) = old\.id then/);
  assert.match(migration, /create or replace function public\.admin_bulk_audit_operation/);
  assert.match(migration, /create or replace function public\.admin_user_plan_distribution/);
  assert.match(migration, /for update/);
  assert.match(migration, /role = 'admin'\s+and disabled = false/);
  assert.match(migration, /as restrictive/);
  assert.match(migration, /grant execute on function public\.admin_resource_inventory\(\) to service_role/);
  assert.match(migration, /grant execute on function public\.admin_bulk_audit_operation\(uuid\[\], text, integer\) to service_role/);
  assert.match(migration, /grant execute on function public\.admin_user_plan_distribution\(\) to service_role/);
  assert.match(migration, /Migration 016 intentionally removed all browser audit writes/);
  assert.doesNotMatch(migration, /create policy "browser clients can enqueue own audits only"/);
  assert.doesNotMatch(migration, /or public\.is_admin_user\(auth\.uid\(\)\)/);
  assert.match(routeSource, /\.eq\('request_source', 'self_service'\)/);
  assert.match(routeSource, /target\?\.role \|\| 'user'/);
  assert.match(routeSource, /DELETION_REQUEST_STATE_CONFLICT/);
  assert.match(routeSource, /client\.rpc\('admin_bulk_audit_operation'/);
  assert.match(migration, /api_schema_version = 13/);
  assert.doesNotMatch(migration, /api_schema_version = 14/);
}

const tests: Record<string, () => void | Promise<void>> = {
  api: adminApiContract,
  guardrails: userGuardrails,
  exports: exportAndLinkSafety,
  retention: retentionSafety,
  content: contentHealthContract,
  resources: resourceInventoryContract,
  load: loadEfficiencyContract,
  migration: migrationContract,
};

if (mode === 'all') {
  for (const test of Object.values(tests)) await test();
} else {
  const test = tests[mode];
  assert.ok(test, `Unknown admin smoke mode: ${mode}`);
  await test();
}

console.log(`Admin control center V2 smoke passed: ${mode}`);
