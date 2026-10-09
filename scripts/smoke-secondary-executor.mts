import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { makeAuditScope } from '../src/lib/audit/audit-scope';
import { analysisFrontierItem, analysisPageToRow } from '../src/lib/audit/scalable-item-analysis';
import type { ResourceAuditPage } from '../src/lib/audit/resource-types';

const db = new PGlite();
const migration = (file: string) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
const claimArguments = ['cloudflare:fixture', 'fixture-commit', 16, '2026.09', '2.2', '3.1'];
const failures: Array<{ name: string; error: unknown }> = [];
let passed = 0;
type Claim = { audit: { id: string; processing_version: number; executor_type?: string }; run: { generation: number; owner: string; analysed: number; executor_type?: string }; scoreGroups: Array<{ key: string; affected_pages: number }>; pending: boolean };

async function role<T>(name: 'anon' | 'authenticated' | 'service_role', operation: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${name}`);
  try { return await operation(); }
  finally { await db.exec('reset role'); }
}

async function check(name: string, operation: () => Promise<void>) {
  try {
    await db.exec('delete from audits; delete from audit_executor_health; delete from audit_scalable_workers;');
    await operation();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function secondary(args: unknown[] = claimArguments): Promise<Claim | null> {
  return role('service_role', async () => (await db.query<{ result: Claim | null }>(
    'select claim_secondary_audit($1,$2,$3,$4,$5,$6) result', args)).rows[0].result);
}

async function registerRender() {
  await db.exec(`insert into audit_scalable_workers(worker_id,commit_id,scope_commit_id,scope_version,deep_enabled)
    values('render:fixture','fixture-render','fixture-render',1,true)
    on conflict(worker_id) do update set seen_at=now(),scope_version=1,scope_commit_id=excluded.scope_commit_id,commit_id=excluded.commit_id;`);
}

async function render(): Promise<Claim | null> {
  return role('service_role', async () => (await db.query<{ result: Claim | null }>(
    'select claim_efficient_scoped_audit($1,true) result', ['render:fixture'])).rows[0].result);
}

async function enqueue(hostname: string, status = 'queued', priority = 10, processingVersion = 2) {
  const id = randomUUID();
  await db.query(`insert into audits(id,submitted_input,normalized_url,hostname,status,plan,effective_mode,queue_priority,page_limit,plan_page_limit,processing_version,audit_scope)
    values($1,$2,$2,$3,$4,'free','quick',$5,3,3,$6,$7)`,
  [id, `https://${hostname}/`, hostname, status, priority, processingVersion,
    processingVersion === 2 ? JSON.stringify(makeAuditScope('security', 'site')) : null]);
  return id;
}

function pagePayload(auditId: string, hostname: string) {
  const url = `https://${hostname}/`;
  const item = analysisFrontierItem(url, 'page');
  const page: ResourceAuditPage = { id: `fixture-page-${auditId}`, url, statusCode: 200, responseTimeMs: 100,
    pageSizeBytes: 500, title: 'Fixture', metaDescription: '', h1: 'Fixture', wordCount: 50,
    crawlDepth: 0, issueCount: 0, crawledAt: new Date().toISOString(), fetchStatus: 'success' };
  return { items: [{ key: item.key, page: analysisPageToRow(auditId, page), issues: [], checks: 1,
    groups: [{ key: 'security|fixture', category: 'security', title: 'Fixture', severity: 'low', rank: 2 }],
    children: [analysisFrontierItem(`https://${hostname}/next`, 'page', 1, url)] }] };
}

async function commit(auditId: string, worker: string, generation: number, payload: unknown) {
  return role('service_role', async () => (await db.query<{ result: Claim }>(
    'select scalable_audit_commit_efficient($1,$2,$3,$4) result',
    [auditId, worker, generation, JSON.stringify(payload)])).rows[0].result);
}

try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean);`);
  const baseline = await migration('001_resource_light_audit.sql');
  await db.exec(baseline.slice(baseline.indexOf('create or replace function'), baseline.indexOf('alter publication')));
  await db.exec(await migration('009_audit_page_preview_metadata.sql'));
  await db.exec(await migration('010_audit_resilience_and_failures.sql'));
  await db.exec(`alter table audits drop constraint audits_status_check;
    alter table audits add column plan text default 'free',add column effective_mode text default 'quick',add column queue_priority int default 10,
      add column started_at timestamptz,add column worker_runtime text,add column admin_priority_boost int default 0,add column admin_priority_expires_at timestamptz;
    create table plan_limits(plan text primary key,allowed_modes jsonb,max_pages_quick int,max_pages_standard int,max_pages_deep int);
    create table platform_settings(id text,key text,value jsonb,updated_at timestamptz);
    create table audit_admissions(audit_id uuid,user_id uuid,guest_key_hash text,ip_hash text,normalized_domain text,normalized_url text,audit_mode text,decision text,decision_code text,created_at timestamptz default now());
    create table deployment_versions(component text primary key,application_version text not null,commit_identifier text not null,
      build_timestamp timestamptz not null default now(),api_schema_version integer not null,audit_engine_version text not null,
      scoring_version text not null,check_registry_version text not null,metadata jsonb not null default '{}',updated_at timestamptz not null default now());
    insert into deployment_versions(component,application_version,commit_identifier,api_schema_version,audit_engine_version,scoring_version,check_registry_version)
      values('api','1.0.0-beta','fixture-api',16,'2026.09','2.2','3.1'),('database','1.0.0-beta','migration-035',16,'2026.09','2.2','3.1');`);
  for (const file of ['025_scalable_audits.sql', '026_scalable_frontier_hash.sql', '027_audit_presentation.sql',
    '033_performance_optimization.sql', '034_focused_audits.sql', '035_performance_efficiency.sql']) {
    await db.exec(await migration(file));
  }
  await db.exec(`create function claim_audit_for_executor(text,text) returns uuid language sql security definer as $$ select null::uuid $$;
    grant execute on function claim_audit_for_executor(text,text) to public,anon,authenticated,service_role;`);
  const versionsBefore = (await db.query('select * from deployment_versions order by component')).rows;
  const secondaryMigration = await migration('036_secondary_executor.sql');
  await db.exec(secondaryMigration);
  await db.exec(secondaryMigration);
  assert.deepEqual((await db.query('select * from deployment_versions order by component')).rows, versionsBefore,
    'migration 036 must preserve schema 16 and existing engine/version metadata');
  console.log('PASS migration 036 applies twice without downgrading deployment metadata');

  await check('anon/authenticated cannot claim, finish, invoke the prototype RPC, or read executor health', async () => {
    for (const caller of ['anon', 'authenticated'] as const) {
      await role(caller, async () => {
        await assert.rejects(db.query('select claim_secondary_audit($1,$2,$3,$4,$5,$6)', claimArguments), /permission denied/);
        await assert.rejects(db.query('select secondary_executor_slice_finished($1)', [claimArguments[0]]), /permission denied/);
        await assert.rejects(db.query('select claim_audit_for_executor($1,$2)', ['cloudflare', 'fixture']), /permission denied/);
        await assert.rejects(db.query('select * from audit_executor_health'), /permission denied/);
      });
    }
    await role('service_role', () => assert.rejects(db.query('select claim_audit_for_executor($1,$2)', ['cloudflare', 'fixture']), /permission denied/));
    const rls = await db.query<{ enabled: boolean }>("select relrowsecurity enabled from pg_class where oid='public.audit_executor_health'::regclass");
    assert.equal(rls.rows[0].enabled, true);
  });

  await check('incompatible worker contracts are rejected before claim or registration', async () => {
    const id = await enqueue('compatibility.example');
    for (const [index, value] of [[0, 'render:wrong-executor'], [1, 'x'.repeat(41)], [2, 15], [3, '2026.07'], [4, '2.1'], [5, '3.0']] as const) {
      const args = [...claimArguments]; args[index] = value;
      await assert.rejects(secondary(args), /SECONDARY_EXECUTOR_INCOMPATIBLE/);
    }
    assert.equal((await db.query<{ generation: number }>('select generation from audit_crawl_runs where audit_id=$1', [id])).rows[0].generation, 0);
    assert.equal((await db.query<{ count: number }>('select count(*)::int count from audit_scalable_workers')).rows[0].count, 0);
  });

  await check('null or empty compatibility inputs fail closed with the compatibility error', async () => {
    await enqueue('missing-contract.example');
    for (let index = 0; index < claimArguments.length; index++) {
      const args: unknown[] = [...claimArguments]; args[index] = null;
      await assert.rejects(secondary(args), (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /SECONDARY_EXECUTOR_INCOMPATIBLE/, `null compatibility field ${index}: ${message}`);
        return true;
      });
    }
    const emptyCommit = [...claimArguments]; emptyCommit[1] = '';
    await assert.rejects(secondary(emptyCommit), /SECONDARY_EXECUTOR_INCOMPATIBLE/);
  });

  await check('deployed API incompatibility rejects a secondary claim', async () => {
    await enqueue('deployed-version.example');
    await db.exec("update deployment_versions set api_schema_version=15 where component='api'");
    try { await assert.rejects(secondary(), /SECONDARY_EXECUTOR_INCOMPATIBLE/); }
    finally { await db.exec("update deployment_versions set api_schema_version=16 where component='api'"); }
  });

  await check('missing deployed API metadata does not silently authorize an unverified worker', async () => {
    await enqueue('unverified-deployment.example');
    await db.exec("update deployment_versions set component='missing-api' where component='api'");
    try { await assert.rejects(secondary(), /SECONDARY_EXECUTOR_INCOMPATIBLE/); }
    finally { await db.exec("update deployment_versions set component='api' where component='missing-api'"); }
  });

  for (const first of ['render', 'cloudflare'] as const) {
    await check(`${first}-owned host excludes the other executor while unrelated hosts remain claimable`, async () => {
      await registerRender();
      const ownerId = await enqueue('shared.example', 'queued', 999);
      const sameHostId = await enqueue('www.shared.example', 'queued', 900);
      const otherId = await enqueue('separate.example', 'queued', 10);
      const owner = first === 'render' ? await render() : await secondary();
      assert.equal(owner?.audit.id, ownerId);
      const other = first === 'render' ? await secondary() : await render();
      assert.equal(other?.audit.id, otherId);
      const sameHost = await db.query<{ status: string; generation: number }>(
        'select a.status,r.generation from audits a join audit_crawl_runs r on r.audit_id=a.id where a.id=$1', [sameHostId]);
      assert.equal(sameHost.rows[0].status, 'queued');
      assert.equal(sameHost.rows[0].generation, 0);
      assert.equal(first === 'render' ? await secondary() : await render(), null);
    });
  }

  await check('expired Cloudflare generations cannot commit, renew, or release Render ownership', async () => {
    await registerRender();
    const id = await enqueue('generation.example');
    const old = (await secondary())!;
    assert.equal(old.audit.id, id);
    await db.query("update audit_crawl_runs set lease_until=now()-interval '1 second' where audit_id=$1", [id]);
    const current = (await render())!;
    assert.equal(current.audit.id, id);
    assert.equal(current.run.generation, old.run.generation + 1);
    await assert.rejects(commit(id, String(claimArguments[0]), old.run.generation, { items: [] }), /AUDIT_OWNERSHIP_LOST/);
    await role('service_role', async () => {
      await assert.rejects(db.query('select renew_scalable_audit_lease($1,$2,$3)', [id, claimArguments[0], old.run.generation]), /AUDIT_OWNERSHIP_LOST/);
      const finish = await db.query<{ finished: boolean }>('select scalable_audit_finish_slice($1,$2,$3) finished', [id, claimArguments[0], old.run.generation]);
      assert.equal(finish.rows[0].finished, false);
    });
    const actual = (await db.query<{ owner: string; generation: number }>('select owner,generation from audit_crawl_runs where audit_id=$1', [id])).rows[0];
    assert.deepEqual(actual, { owner: 'render:fixture', generation: current.run.generation });
  });

  await check('a released Cloudflare slice resumes on Render with complete evidence and no duplicate counting', async () => {
    await registerRender();
    const host = 'handoff.example';
    const id = await enqueue(host);
    const initial = (await secondary())!;
    assert.equal(initial.audit.id, id);
    const payload = pagePayload(id, host);
    const saved = await commit(id, String(claimArguments[0]), initial.run.generation, payload);
    assert.equal(saved.run.analysed, 1);
    assert.equal(saved.pending, true);
    assert.equal((await commit(id, String(claimArguments[0]), initial.run.generation, payload)).run.analysed, 1);
    await role('service_role', async () => {
      assert.equal((await db.query<{ finished: boolean }>('select scalable_audit_finish_slice($1,$2,$3) finished', [id, claimArguments[0], initial.run.generation])).rows[0].finished, true);
      await db.query('select secondary_executor_slice_finished($1)', [claimArguments[0]]);
    });
    const resumed = (await render())!;
    assert.equal(resumed.audit.id, id);
    assert.equal(resumed.run.owner, 'render:fixture');
    assert.equal(resumed.run.generation, initial.run.generation + 1);
    assert.equal(resumed.run.analysed, 1);
    assert.equal(resumed.pending, true);
    assert.deepEqual(resumed.scoreGroups.map(group => ({ key: group.key, affected_pages: group.affected_pages })), [{ key: 'security|fixture', affected_pages: 1 }]);
    assert.equal((await db.query<{ count: number }>('select count(*)::int count from audit_pages where audit_id=$1', [id])).rows[0].count, 1);
    await assert.rejects(commit(id, String(claimArguments[0]), initial.run.generation, payload), /AUDIT_OWNERSHIP_LOST/);
    const health = (await db.query<{ status: string; completed_slices: number; current_audit_id: string | null }>(
      'select status,completed_slices,current_audit_id from audit_executor_health where worker_id=$1', [claimArguments[0]])).rows[0];
    assert.deepEqual(health, { status: 'idle', completed_slices: 1, current_audit_id: null });
  });

  await check('Render handoff updates executor attribution to match the actual owner', async () => {
    await registerRender();
    const id = await enqueue('attribution.example');
    const initial = (await secondary())!;
    await db.query('select scalable_audit_finish_slice($1,$2,$3)', [id, claimArguments[0], initial.run.generation]);
    assert.equal((await render())?.audit.id, id);
    const attribution = (await db.query<{ public_executor: string; run_executor: string }>(
      'select a.executor_type public_executor,r.executor_type run_executor from audits a join audit_crawl_runs r on r.audit_id=a.id where a.id=$1', [id])).rows[0];
    assert.deepEqual(attribution, { public_executor: 'render', run_executor: 'render' });
  });

  await check('terminal and legacy jobs are never claimed by durable executors', async () => {
    await registerRender();
    for (const status of ['completed', 'completed_with_warnings', 'failed', 'cancelled', 'abandoned']) {
      await enqueue(`${status.replaceAll('_', '-')}.example`, status);
    }
    await enqueue('legacy.example', 'queued', 10, 1);
    assert.equal(await secondary(), null);
    assert.equal(await render(), null);
    assert.equal((await db.query<{ count: number }>('select count(*)::int count from audit_crawl_runs where generation<>0')).rows[0].count, 0);
  });

  assert.deepEqual((await db.query('select * from deployment_versions order by component')).rows, versionsBefore);
  console.log(`Secondary executor SQL: ${passed} passed, ${failures.length} failed. No external services were contacted.`);
  if (failures.length) throw new Error(failures.map(failure => `${failure.name}: ${failure.error instanceof Error ? failure.error.message : String(failure.error)}`).join('\n'));
} finally {
  await db.close();
}
