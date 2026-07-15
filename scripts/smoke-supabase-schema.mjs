import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve('supabase/migrations/001_resource_light_audit.sql');
const sql = readFileSync(migrationPath, 'utf8');
const privatePoliciesPath = resolve('supabase/migrations/006_private_audit_read_policies.sql');
const privatePoliciesSql = readFileSync(privatePoliciesPath, 'utf8');
const historyMigrationSql = readFileSync(resolve('supabase/migrations/008_audit_history_comparison.sql'), 'utf8');
const previewMigrationSql = readFileSync(resolve('supabase/migrations/009_audit_page_preview_metadata.sql'), 'utf8');
const resilienceMigrationSql = readFileSync(resolve('supabase/migrations/010_audit_resilience_and_failures.sql'), 'utf8');
const productionMigrationSql = readFileSync(resolve('supabase/migrations/011_production_robustness.sql'), 'utf8');
const admissionLockdownSql = readFileSync(resolve('supabase/migrations/016_server_only_audit_admission.sql'), 'utf8');

for (const table of ['audits', 'audit_events', 'audit_pages', 'audit_issues', 'audit_reports']) {
  assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'), `${table} table is missing`);
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} RLS is missing`);
  assert.match(sql, new RegExp(`alter publication supabase_realtime add table public\\.${table}`, 'i'), `${table} realtime publication is missing`);
}

for (const indexName of [
  'audits_status_created_at_idx',
  'audits_lease_expires_at_idx',
  'audit_events_audit_created_at_idx',
  'audit_pages_audit_crawled_at_idx',
  'audit_issues_audit_detected_at_idx',
]) {
  assert.match(sql, new RegExp(`create index if not exists ${indexName}\\b`, 'i'), `${indexName} is missing`);
}

assert.match(sql, /browser clients can enqueue audits only/i, 'initial browser enqueue policy is missing');
assert.match(sql, /audit rows are readable by browser clients/i, 'browser audit read policy is missing');
for (const table of ['audits', 'audit_events', 'audit_pages', 'audit_issues', 'audit_reports']) {
  assert.match(privatePoliciesSql, new RegExp(`owners and admins can read ${table.replace('audit_', 'audit ')}`, 'i'), `${table} owner read policy is missing`);
}
assert.match(privatePoliciesSql, /drop policy if exists "users can read own or guest audits"/i, 'permissive guest audit policy is not removed');
assert.equal(/for select\s+to anon/i.test(privatePoliciesSql), false, 'private audit read policies must not grant anon table reads');
for (const indexName of ['audits_user_created_at_idx', 'audits_user_hostname_created_at_idx', 'audits_user_status_created_at_idx', 'audit_issues_comparison_key_idx']) {
  assert.match(historyMigrationSql, new RegExp(`create index if not exists ${indexName}\\b`, 'i'), `${indexName} is missing`);
}
for (const column of ['canonical_url', 'site_name', 'favicon_url', 'open_graph_image', 'theme_color', 'screenshot_url']) {
  assert.match(previewMigrationSql, new RegExp(`add column if not exists ${column}\\b`, 'i'), `${column} preview metadata column is missing`);
}
assert.match(previewMigrationSql, /never require iframe embedding/i, 'preview migration must document the non-iframe contract');
assert.match(resilienceMigrationSql, /completed_with_warnings/i, 'warning completion status is missing');
for (const column of ['warning_count', 'failure_counts', 'fetch_status', 'failure_code', 'attempt_count', 'recovered_after_retry', 'finding_key', 'source_urls']) {
  assert.match(resilienceMigrationSql, new RegExp(`add column if not exists ${column}\\b`, 'i'), `${column} resilience column is missing`);
}
assert.match(resilienceMigrationSql, /create table if not exists public\.audit_diagnostics\b/i, 'internal diagnostics table is missing');
assert.match(resilienceMigrationSql, /alter table public\.audit_diagnostics enable row level security/i, 'diagnostics RLS is missing');
assert.match(resilienceMigrationSql, /No anon or authenticated policy is created/i, 'service-role-only diagnostics boundary is undocumented');
assert.equal(/alter publication supabase_realtime add table public\.audit_diagnostics/i.test(resilienceMigrationSql), false, 'internal diagnostics must not be published to browser realtime');
for (const table of ['deployment_versions', 'audit_admissions', 'api_rate_limit_windows', 'api_error_logs', 'data_retention_policies']) {
  assert.match(productionMigrationSql, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'), `${table} production table is missing`);
  assert.match(productionMigrationSql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} production RLS is missing`);
}
for (const fn of ['admit_audit_submission', 'consume_api_rate_limit', 'consume_user_audit_quota', 'delete_user_owned_data', 'run_data_retention_cleanup']) {
  assert.match(productionMigrationSql, new RegExp(`create or replace function public\\.${fn}\\b`, 'i'), `${fn} production function is missing`);
  assert.match(productionMigrationSql, new RegExp(`grant execute on function public\\.${fn}`, 'i'), `${fn} service-role grant is missing`);
}
assert.match(productionMigrationSql, /recovery_attempts/i, 'bounded stale recovery metadata is missing');
for (const policy of ['browser clients can enqueue audits only', 'browser clients can enqueue own audits only', 'admins can update audits']) {
  assert.match(admissionLockdownSql, new RegExp(`drop policy if exists "${policy}"`, 'i'), `${policy} must be removed by migration 016`);
}
assert.match(admissionLockdownSql, /revoke insert, update, delete on public\.audits from anon, authenticated/i, 'Direct browser audit mutations must be revoked');
assert.match(admissionLockdownSql, /api_schema_version = 12/i, 'Database compatibility version must advance with the admission policy change');
for (const bannedTerm of ['fire' + 'base', 'fire' + 'store']) {
  assert.equal(sql.toLowerCase().includes(bannedTerm), false, `migration should not contain ${bannedTerm} references`);
}

console.log('Supabase schema smoke test passed.');
