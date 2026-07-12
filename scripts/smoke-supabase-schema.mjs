import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve('supabase/migrations/001_resource_light_audit.sql');
const sql = readFileSync(migrationPath, 'utf8');
const privatePoliciesPath = resolve('supabase/migrations/006_private_audit_read_policies.sql');
const privatePoliciesSql = readFileSync(privatePoliciesPath, 'utf8');
const historyMigrationSql = readFileSync(resolve('supabase/migrations/008_audit_history_comparison.sql'), 'utf8');
const previewMigrationSql = readFileSync(resolve('supabase/migrations/009_audit_page_preview_metadata.sql'), 'utf8');

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

assert.match(sql, /browser clients can enqueue audits only/i, 'safe browser enqueue policy is missing');
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
for (const bannedTerm of ['fire' + 'base', 'fire' + 'store']) {
  assert.equal(sql.toLowerCase().includes(bannedTerm), false, `migration should not contain ${bannedTerm} references`);
}

console.log('Supabase schema smoke test passed.');
