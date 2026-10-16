import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('assignment repair preserves workflow rows and rejects another account as assignee', async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
      create table public.audit_finding_workflow(id integer primary key, user_id uuid not null, due_at timestamptz, status text, notes text);
      insert into public.audit_finding_workflow values (1,'00000000-0000-0000-0000-000000000001',null,'in_progress','Preserve this note');
    `);
    const migration = readFileSync(new URL('../../../supabase/migrations/040_finding_workflow_assignment.sql', import.meta.url), 'utf8');
    await database.exec(migration);
    await database.exec(migration);
    await database.exec("update public.audit_finding_workflow set assigned_to = user_id where id = 1");
    const { rows } = await database.query<{ status: string; notes: string; assigned_to: string }>('select status, notes, assigned_to from public.audit_finding_workflow');
    assert.deepEqual(rows, [{ status: 'in_progress', notes: 'Preserve this note', assigned_to: '00000000-0000-0000-0000-000000000001' }]);
    await assert.rejects(database.exec("update public.audit_finding_workflow set assigned_to='00000000-0000-0000-0000-000000000002' where id = 1"), /only be assigned to its audit owner/);
    const permissions = await database.query<{ browser_access: boolean }>("select has_function_privilege('anon','public.validate_finding_workflow_assignment()','execute') or has_function_privilege('authenticated','public.validate_finding_workflow_assignment()','execute') as browser_access");
    assert.equal(permissions.rows[0].browser_access, false);
  } finally {
    await database.close();
  }
});
