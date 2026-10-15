import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('visible previews gain bounded priority, old work ages ahead, and both claim paths share one browser budget', async () => {
  const db=new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text primary key,name text,public boolean); create table audits(id uuid primary key,normalized_url text,deleted_at timestamptz);');
    const old=await readFile(new URL('../../../supabase/migrations/037_audit_preview_and_admission.sql',import.meta.url),'utf8');
    await db.exec(old.slice(0,old.indexOf('-- This wrapper'))+'\ncommit;');
    await db.exec(old.slice(old.indexOf('create or replace function public.request_audit_preview'),old.indexOf('-- Return cleanup')));
    await db.exec(await readFile(new URL('../../../supabase/migrations/039_preview_demand_priority.sql',import.meta.url),'utf8'));
    const call=async(sql:string,args:unknown[]=[]) => (await db.query<{result:any}>(sql,args)).rows[0].result;
    const background=randomUUID(),visible=randomUUID();
    await db.query("insert into audits values($1,'https://background.example/',null),($2,'https://visible.example/',null)",[background,visible]);
    const first=await call('select request_audit_preview($1) result',[background]);
    const viewed=await call('select request_visible_audit_preview($1) result',[visible]);
    const job=await call("select claim_site_preview_prioritized('worker') result");
    assert.equal(job.id,viewed.id);
    assert.equal(await call("select claim_site_preview('legacy') result"),null,'legacy cannot claim while the prioritized path owns a browser');
    await call('select complete_site_preview($1,$2,$3) result',[job.id,job.generation,JSON.stringify({status:'unavailable',durationMs:1})]);
    await db.query("update site_preview_captures set retry_at=now()-interval '20 minutes' where id=$1",[first.id]);
    await db.query("update site_preview_captures set status='queued',retry_at=now() where id=$1",[viewed.id]);
    assert.equal((await call("select claim_site_preview_prioritized('worker') result")).id,first.id);
    assert.equal(await call("select reserved_ms result from preview_daily_usage"),20000);
    assert.equal(await call("select has_function_privilege('anon','claim_site_preview_prioritized(text)','execute') result"),false);
  } finally { await db.close(); }
});
