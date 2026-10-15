import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { makeEvidenceCacheRow } from './domain-evidence-cache';
import { parseOpenPageRankResponse, parseTrancoEvidence, allowlistMajestic } from './provider-evidence';
import { createDomainEvidenceService } from './public-link-signals';
import type { EvidenceRefreshCoordinator } from './refresh-coordinator';

test('shared refresh fences owners, budgets requests, retains RLS, measures first pages, and cleans independently', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table audits(id uuid primary key,status text default 'queued',pages_crawled int default 0,created_at timestamptz default now(),started_at timestamptz,completed_at timestamptz,deleted_at timestamptz);
      create table user_profiles(id uuid primary key,plan text,disabled boolean default false);
      create table domain_evidence_cache(domain text primary key,payload jsonb,fetched_at timestamptz,fresh_until timestamptz,stale_until timestamptz);
      create table site_preview_captures(id uuid,status text,desktop_bytes int,mobile_bytes int);
      create table preview_daily_usage(usage_day date primary key,reserved_ms int,consumed_ms int);`);
    await db.exec(await readFile(new URL('../../../supabase/migrations/038_resource_reliability.sql', import.meta.url), 'utf8'));
    const call = async <T>(sql: string, args: unknown[] = []) => (await db.query<{result:T}>(sql, args)).rows[0].result;
    const owner = randomUUID(), other = randomUUID(), domain = 'example.com';
    const claim = (name = domain, id = owner) => call<any>('select claim_domain_evidence_refresh($1,$2,true) result',[name,id]);
    assert.equal((await claim()).openPageRankAllowed,true);
    assert.equal((await claim(domain,other)).state,'busy');
    const at = new Date().toISOString();
    const payload = {
      version: 1 as const,
      openPageRank: parseOpenPageRankResponse({ as_of: at.slice(0,10), results: [{ domain, found: true, open_page_rank: 4, referring_domains: 10, history: [] }] },domain,at),
      tranco: parseTrancoEvidence({domain,ranks:[{date:at.slice(0,10),rank:100}]},domain,at),
      majestic: allowlistMajestic({domain,status:'not_listed',scope:'public_top_million',fetchedAt:at,datasetDate:null,found:false,globalRank:null,tldRank:null,referringSubnets:null,referringIps:null},domain),
    };
    const row=makeEvidenceCacheRow(domain,payload,Date.now());
    assert.equal(await call('select finish_domain_evidence_refresh($1,$2,$3,0) result',[domain,other,JSON.stringify(row)]),false);
    assert.equal(await call('select finish_domain_evidence_refresh($1,$2,$3,0) result',[domain,owner,JSON.stringify(row)]),true);
    assert.equal((await claim(domain,other)).state,'fresh');
    assert.equal(await call("select reserved result from provider_lookup_budgets where period='month'"),1);
    await db.exec("update provider_lookup_budgets set reserved=50 where period='minute'");
    const minute=await claim('minute.example');
    assert.equal(minute.reason,'minute_budget'); assert.equal(minute.openPageRankAllowed,false);
    await db.exec("update provider_lookup_budgets set reserved=27000 where period='month'");
    assert.equal((await claim('monthly.example')).reason,'monthly_budget');
    await db.exec("update domain_evidence_refresh set lease_until=now()-interval '1 second' where domain='monthly.example'");
    assert.equal((await claim('monthly.example',other)).state,'claimed');
    assert.equal(await call('select finish_domain_evidence_refresh($1,$2,null,0) result',['monthly.example',owner]),false);
    assert.equal(await call("select has_function_privilege('anon','claim_domain_evidence_refresh(text,uuid,boolean)','execute') result"),false);
    assert.equal(await call("select has_table_privilege('authenticated','provider_lookup_budgets','select') result"),false);
    const audit=randomUUID(), admin=randomUUID();
    await db.query('insert into audits(id,started_at) values($1,now())',[audit]);
    await db.query('update audits set pages_crawled=1 where id=$1',[audit]);
    const first=await call<string>('select first_page_at::text result from audits where id=$1',[audit]);
    assert.ok(first);
    await db.query("update audits set first_page_at=null,pages_crawled=2,status='completed',completed_at=now() where id=$1",[audit]);
    assert.equal(await call('select first_page_at::text result from audits where id=$1',[audit]),first);
    await assert.rejects(call('select admin_capacity_snapshot($1) result',[other]),/ADMIN_REQUIRED/);
    await db.query("insert into user_profiles(id,plan) values($1,'admin')",[admin]);
    const capacity=await call<any>('select admin_capacity_snapshot($1) result',[admin]);
    assert.equal(capacity.previews.remainingMs,480000); assert.equal(capacity.timings.admission.samples,0);
    assert.equal(capacity.timings.admission.p50Ms,null); assert.equal(capacity.timings.firstPage.samples,1);
    await db.exec("update domain_evidence_cache set stale_until=now()-interval '1 day'");
    const cleaned=await call<any>('select cleanup_resource_evidence() result');
    assert.equal(cleaned.evidence,1,'evidence cleanup runs with no preview rows');
    assert.equal((await call<any>('select cleanup_resource_evidence() result')).skipped,true);
  } finally { await db.close(); }
});

test('busy or unavailable coordination makes no external calls; an exhausted OPR budget keeps other sources usable', async () => {
  for (const state of ['busy','unavailable','budget'] as const) {
    let opr=0, other=0, finished=0;
    const coordinator: EvidenceRefreshCoordinator = {
      async claim() { if(state==='unavailable') throw new Error('offline'); return state==='busy' ? {state:'busy'} : {state:'claimed',openPageRankAllowed:false,reason:'monthly_budget'}; },
      async finish() { finished++; return true; },
    };
    const get=createDomainEvidenceService({coordinator,store:{read:async()=>null,write:async()=>{throw new Error('Unfenced write');}}, apiKey:()=> 'fixture',
      openPageRank:async()=>{opr++;throw new Error('Must not call');},
      tranco:async domain=>{other++;return parseTrancoEvidence({domain,ranks:[]},domain);},
      majestic:async()=>{other++;throw new Error('fixture absent');},
    });
    const value=await get('example.com');
    assert.equal(opr,0); assert.equal(other,state==='budget'?2:0); assert.equal(finished,state==='budget'?1:0);
    assert.equal(value.openPageRank?.score,null);
    assert.equal(value.refreshAvailability,state==='budget'?'monthly_budget':state==='busy'?'refresh_in_progress':'coordination_unavailable');
  }
});
