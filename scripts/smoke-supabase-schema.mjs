import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve('supabase/migrations/001_resource_light_audit.sql');
const sql = readFileSync(migrationPath, 'utf8');

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
for (const bannedTerm of ['fire' + 'base', 'fire' + 'store']) {
  assert.equal(sql.toLowerCase().includes(bannedTerm), false, `migration should not contain ${bannedTerm} references`);
}

console.log('Supabase schema smoke test passed.');
