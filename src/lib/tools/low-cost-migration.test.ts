import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('migration keeps documents private, off hot run metadata and in the atomic commit', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table audits(id uuid primary key); create table audit_pages(id text primary key);
      create table audit_crawl_runs(audit_id uuid primary key references audits,metadata jsonb not null default '{}');
      create table audit_export_jobs(format text constraint audit_export_jobs_format_check check(format in ('json','pages.csv','issues.csv')));`);
    const sql = readFileSync(new URL('../../../supabase/migrations/031_low_cost_tools.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql);
    const id = '00000000-0000-4000-8000-000000000001';
    await db.query('insert into audits values($1)', [id]);
    await db.query("insert into audit_crawl_runs values($1,$2)", [id, { robots: { allow: [] }, robotsEvidence: { state: 'available', raw: 'User-agent: *\nDisallow: /secret' } }]);
    const run = await db.query<{ metadata: Record<string, unknown> }>('select metadata from audit_crawl_runs');
    assert.equal(run.rows[0].metadata.robotsEvidence, undefined); assert.ok(run.rows[0].metadata.robots);
    const document = await db.query<{ robots: { raw: string } }>('select robots from audit_tool_documents'); assert.match(document.rows[0].robots.raw, /Disallow/);
    const privileges = await db.query<{ anon: boolean; authenticated: boolean; rls: boolean }>(`select has_table_privilege('anon','audit_tool_documents','select') as anon,has_table_privilege('authenticated','audit_tool_documents','select') as authenticated,(select relrowsecurity from pg_class where relname='audit_tool_documents') as rls`);
    assert.deepEqual(privileges.rows[0], { anon: false, authenticated: false, rls: true });
    await db.exec("insert into audit_export_jobs values('sitemap.xml')");
    await assert.rejects(db.query('insert into audit_pages values($1,$2)', ['bad', { content: 'x'.repeat(5000) }]));
    await db.query('delete from audits where id=$1', [id]).catch(() => undefined);
  } finally { await db.close(); }
});
