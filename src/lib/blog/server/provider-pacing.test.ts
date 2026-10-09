import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('provider cooldown is part of a lease-fenced checkpoint, bounded and server-only', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table blog_generation_jobs (
        id uuid primary key, execution_target text, workflow_stage text, state text,
        stage_outputs jsonb default '{}', stage_progress integer, status_message text,
        stage_attempt_count integer, locked_by text, locked_at timestamptz,
        lease_expires_at timestamptz, next_retry_at timestamptz, last_safe_error_code text,
        error text, last_stage_at timestamptz, updated_at timestamptz, completed_at timestamptz
      );
      create table blog_dispatcher_state (
        id text primary key, last_successful_stage_at timestamptz, dispatched_stages integer default 0,
        last_safe_error_code text, consecutive_rate_limits integer default 2,
        provider_pause_until timestamptz, updated_at timestamptz
      );
      insert into blog_dispatcher_state(id) values ('vercel');
      insert into blog_generation_jobs(id,execution_target,workflow_stage,state,locked_by,lease_expires_at)
      values ('00000000-0000-4000-8000-000000000001','vercel','section_drafting','drafting','owner',now()+interval '1 minute');
    `);
    const sql = await readFile(new URL('../../../../supabase/migrations/030_blog_provider_pacing.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    const complete = (owner: string, until: string) => db.query(`
      select * from complete_vercel_blog_stage(
        '00000000-0000-4000-8000-000000000001',$1,'section_drafting','section_drafting','drafting',
        jsonb_build_object('nextProviderRequestAt',$2::text,'draftedSections',jsonb_build_array(jsonb_build_object('index',0))),47,'Saved section')`, [owner, until]);
    assert.equal((await complete('expired-owner', new Date().toISOString())).rows.length, 0);
    assert.equal((await db.query<{ dispatched_stages: number }>('select dispatched_stages from blog_dispatcher_state')).rows[0].dispatched_stages, 0);
    assert.equal((await complete('owner', new Date(Date.now()+3_600_000).toISOString())).rows.length, 1);
    const saved = (await db.query<{ dispatched_stages: number; consecutive_rate_limits: number; bounded: boolean; future: boolean }>(`
      select dispatched_stages,consecutive_rate_limits,provider_pause_until<=now()+interval '15 minutes' as bounded,
      provider_pause_until>now() as future from blog_dispatcher_state`)).rows[0];
    assert.equal(saved.dispatched_stages, 1);
    assert.equal(saved.consecutive_rate_limits, 0);
    assert.equal(saved.bounded, true);
    assert.equal(saved.future, true);
    assert.equal((await complete('owner', new Date().toISOString())).rows.length, 0);
    const permissions = (await db.query<{ anon: boolean; authenticated: boolean; server: boolean }>(`
      select has_function_privilege('anon','complete_vercel_blog_stage(uuid,text,text,text,text,jsonb,integer,text)','execute') as anon,
      has_function_privilege('authenticated','complete_vercel_blog_stage(uuid,text,text,text,text,jsonb,integer,text)','execute') as authenticated,
      has_function_privilege('service_role','complete_vercel_blog_stage(uuid,text,text,text,text,jsonb,integer,text)','execute') as server`)).rows[0];
    assert.deepEqual(permissions, { anon: false, authenticated: false, server: true });
  } finally { await db.close(); }
});
