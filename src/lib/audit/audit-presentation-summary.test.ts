import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { auditRepository, issueToRow, pageToRow, reportToRow, toAuditDocument } from '../supabase/audit-repository';
import { AUDIT_PRESENTATION_SECTIONS, readAuditPresentationSummary } from './audit-presentation-summary';
import { classifyReportSection } from './report-insights';
import type { AuditPresentationSummary, ResourceAuditIssue, ResourceAuditPage, ResourceAuditReport } from './resource-types';

const emptySummary = (): AuditPresentationSummary => ({
  version: 1, scope: 'complete', analysedPages: 0, attemptedPages: 0,
  responseOutcomes: { success: 0, redirect: 0, clientError: 0, serverError: 0, unavailable: 0 },
  delivery: { count: 0, totalResponseMs: 0, totalBytes: 0, averageResponseMs: null, averagePageBytes: null },
  pagesWithFindings: 0, depthCounts: {}, findingsBySection: {}, topRecommendations: [], updatedAt: new Date().toISOString(),
});

test('only complete, internally consistent presentation summaries are mapped', () => {
  const summary = emptySummary();
  assert.equal(readAuditPresentationSummary(summary), summary);
  assert.equal(toAuditDocument({ id: 'new', presentation_summary: summary })?.presentationSummary, summary);
  assert.equal(toAuditDocument({ id: 'old', processing_version: 2 })?.presentationSummary, undefined);
  const report: ResourceAuditReport = { scores: { overall: 81, scoringVersion: '2.2', evidenceSample: true }, presentationSummary: summary,
    summary: 'Saved report', topIssues: [], pages: [], exports: { json: '', issuesCsv: '', pagesCsv: '' }, generatedAt: summary.updatedAt };
  assert.deepEqual(reportToRow('audit', report).presentation_summary, summary);
  assert.deepEqual(reportToRow('audit', report).scores, report.scores);
  assert.equal(Object.hasOwn(reportToRow('audit', { ...report, presentationSummary: undefined }), 'presentation_summary'), false);
  for (const value of [undefined, null, {}, { ...summary, version: 2 }, { ...summary, scope: 'sample' },
    { ...summary, attemptedPages: 1 }, { ...summary, analysedPages: -1 },
    { ...summary, responseOutcomes: {} }, { ...summary, depthCounts: { '101': 0 } },
    { ...summary, findingsBySection: { seo: 1 } }, { ...summary, updatedAt: 'invalid' },
    { ...summary, delivery: { ...summary.delivery, averageResponseMs: 0 } },
    { ...summary, topRecommendations: Array(11).fill({ key: 'x', title: 'x', category: 'seo', severity: 'low', affectedPages: 1, recommendation: 'Fix' }) }]) {
    assert.equal(readAuditPresentationSummary(value), undefined);
  }
  assert.equal(Object.isFrozen(AUDIT_PRESENTATION_SECTIONS), true);
});

test('migration aggregates unique evidence atomically and finalizes full retained recommendations', async () => {
  const db = new PGlite();
  const migration = (name: string) => readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8');
  const rpc = async <T = any>(name: string, args: unknown[]): Promise<T> => {
    const result = await db.query<{ result: T }>(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args);
    return result.rows[0].result;
  };
  const key = (url: string) => createHash('sha256').update(`page:${url}`).digest('hex');
  const createAudit = async (id: string, host: string) => {
    const root = `https://${host}/`;
    await db.query(`insert into audits(id,submitted_input,normalized_url,hostname,plan,page_limit,processing_version)
      values($1,$2,$2,$3,'paid',100,2)`, [id, root, host]);
    return root;
  };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean);`);
    const baseline = await migration('001_resource_light_audit.sql');
    await db.exec(baseline.slice(baseline.indexOf('create or replace function'), baseline.indexOf('alter publication')));
    await db.exec(await migration('009_audit_page_preview_metadata.sql'));
    await db.exec(await migration('010_audit_resilience_and_failures.sql'));
    await db.exec(`alter table audits drop constraint audits_status_check;
      alter table audits add column plan text default 'paid',add column effective_mode text default 'standard',
        add column queue_priority integer default 50,add column started_at timestamptz,add column worker_runtime text;
      create table plan_limits(plan text primary key,allowed_modes jsonb,max_pages_quick int,max_pages_standard int,max_pages_deep int);`);
    await db.exec(await migration('025_scalable_audits.sql'));
    await db.exec(await migration('026_scalable_frontier_hash.sql'));
    const legacyId = randomUUID();
    await createAudit(legacyId, 'legacy.example');
    const resumedId = randomUUID();
    const resumedRoot = await createAudit(resumedId, 'resumed.example');
    await db.query(`update audits set status='cancelled' where id=$1`, [resumedId]);
    await db.query(`insert into audit_reports(audit_id,scores,summary,top_issues,pages,exports)
      values($1,'{"overall":17,"scoringVersion":"2.1","evidenceSample":true}','{"text":"Historical"}','[]','[]','{}')`, [legacyId]);
    await db.query(`update audits set status='completed' where id=$1`, [legacyId]);
    await db.exec(await migration('027_audit_presentation.sql'));
    const legacy = await db.query<any>(`select a.presentation_summary audit_summary,r.presentation_summary run_summary,
      p.presentation_summary report_summary,p.scores from audits a join audit_crawl_runs r on r.audit_id=a.id
      join audit_reports p on p.audit_id=a.id where a.id=$1`, [legacyId]);
    assert.deepEqual(legacy.rows[0], { audit_summary: null, run_summary: null, report_summary: null,
      scores: { overall: 17, scoringVersion: '2.1', evidenceSample: true } });

    const classifications = [
      { category: 'seo', title: 'Title missing', description: '' },
      { category: 'technical', title: 'Status code', description: '' },
      { category: 'seo', title: 'Canonical URL', description: 'redirect' },
      { category: 'crawlability', title: 'Broken link', description: '' },
      { category: 'seo', title: 'Page size', description: 'mobile schema robots' },
      { category: 'seo', title: 'Viewport', description: 'schema index' },
      { category: 'seo', title: 'HTTPS redirect', description: 'slow' },
      { category: 'seo', title: 'Schema markup', description: 'index' },
      { category: 'security', title: 'Header', description: 'Accessible name' },
      ...AUDIT_PRESENTATION_SECTIONS.flatMap(category => [
        { category, title: 'Fixture', description: 'ARIA cookie robots status code' },
        { category, title: 'Fixture', description: 'HSTS crawl depth slow viewport' },
      ]),
    ];
    for (const issue of classifications) {
      assert.equal(await rpc('classify_audit_report_section', [issue.category, issue.title, issue.description]), classifyReportSection(issue));
    }

    const id = randomUUID();
    const root = await createAudit(id, 'presentation.example');
    let claim = await rpc('claim_scalable_audit', ['worker', true]);
    assert.equal(claim.audit.id, id);
    assert.ok(readAuditPresentationSummary(claim.run.presentation_summary));
    const commit = (payload: unknown, generation = claim.run.generation) => rpc('scalable_audit_commit', [id, 'worker', generation, JSON.stringify(payload)]);
    const issue = (suffix: string, url: string, title: string, category = 'seo', severity: ResourceAuditIssue['severity'] = 'high') => issueToRow(id, {
      id: `${id}-${suffix}`, title, category, severity, description: 'Measured finding', affectedUrl: url,
      recommendation: `Fix ${title}`, evidence: 'Measured', detectedAt: new Date().toISOString(),
    });
    const item = (suffix: string, url: string, statusCode: number, fetchStatus: ResourceAuditPage['fetchStatus'], depth: number, issues: ReturnType<typeof issue>[], ms = 0, bytes = 0) => ({
      key: key(url), page: pageToRow(id, { id: `${id}-page-${suffix}`, url, statusCode, fetchStatus,
        responseTimeMs: ms, pageSizeBytes: bytes, title: 'Fixture', metaDescription: '', h1: '',
        wordCount: 100, crawlDepth: depth, issueCount: issues.length, crawledAt: new Date().toISOString() }),
      issues, groups: [{ key: 'seo|fixture', category: 'seo', title: 'Fixture', severity: 'low', rank: 2 }], checks: 1, children: [],
    });
    const urls = Array.from({ length: 36 }, (_, n) => n === 0 ? root : `${root}${n}`);
    const seed = { items: [{ key: key(root), discoveryOnly: true, children: urls.slice(1).map(url => ({ key: key(url), url, kind: 'page', depth: 1 })) }] };
    const seeded = await commit(seed);
    assert.equal(seeded.presentation_summary.attemptedPages, 0);
    const titleIssue = issue('title-0', root, 'Missing title', 'seo', 'medium');
    const rootItem = item('0', root, 200, 'success', 0, [titleIssue, titleIssue, issue('security', root, 'HSTS header')], 100, 1000);
    const first = await commit({ items: [rootItem] });
    assert.deepEqual((await commit({ items: [rootItem] })).presentation_summary, first.presentation_summary);
    const retry = await commit({ items: [{ key: key(urls[1]), retryAt: new Date(Date.now() + 1_000).toISOString() }] });
    assert.deepEqual(retry.presentation_summary, first.presentation_summary);
    const fixtures = [
      item('1', urls[1], 301, 'success', 1, [issue('title-1', urls[1], 'Missing title', 'seo', 'medium')], 20, 2000),
      item('2', urls[2], 404, 'failed', 2, [issue('404', urls[2], 'HTTP error', 'crawlability')]),
      item('3', urls[3], 503, 'failed', 2, [issue('503', urls[3], 'HTTP error', 'crawlability')]),
      item('4', urls[4], 0, 'blocked', 3, [issue('blocked', urls[4], 'Robots blocked', 'crawlability', 'info')]),
      item('5', urls[5], 200, 'success', 1, [], 300, 3000),
    ];
    for (const fixture of fixtures) await commit({ items: [fixture] });
    const measured = (await commit({})).presentation_summary as AuditPresentationSummary;
    assert.ok(readAuditPresentationSummary(measured));
    assert.equal(measured.analysedPages, 3);
    assert.equal(measured.attemptedPages, 6);
    assert.deepEqual(measured.responseOutcomes, { success: 2, redirect: 1, clientError: 1, serverError: 1, unavailable: 1 });
    assert.deepEqual(measured.delivery, { count: 3, totalResponseMs: 420, totalBytes: 6000, averageResponseMs: 140, averagePageBytes: 2000 });
    assert.equal(measured.pagesWithFindings, 5);
    assert.deepEqual(measured.depthCounts, { '0': 1, '1': 2, '2': 2, '3': 1 });
    assert.deepEqual(measured.findingsBySection, { 'on-page': 2, security: 1, crawlability: 3 });
    assert.deepEqual(measured.topRecommendations, []);

    const alias = `${root}alias`;
    await commit({ items: [{ key: key(urls[6]), discoveryOnly: true, children: [{ key: key(alias), url: alias, kind: 'page', depth: 1 }] }] });
    assert.deepEqual((await commit({ items: [{ ...rootItem, key: key(alias) }] })).presentation_summary, measured);
    const invalid = item('invalid', urls[6], 200, 'success', 1, [{ ...issue('bad', urls[6], 'Invalid'), severity: 'urgent' as ResourceAuditIssue['severity'] }]);
    await assert.rejects(commit({ items: [invalid] }), /severity|check constraint/);
    assert.deepEqual((await commit({})).presentation_summary, measured, 'failed transactions roll back presentation aggregates');
    await assert.rejects(commit({}, claim.run.generation + 1), /AUDIT_OWNERSHIP_LOST/);
    assert.equal(await rpc('scalable_audit_finish_slice', [id, 'worker', claim.run.generation, null, null]), true);
    claim = await rpc('claim_scalable_audit', ['worker', true]);
    assert.deepEqual(claim.audit.presentation_summary, measured, 'existing claim snapshot carries persisted aggregates');

    for (let n = 6; n < urls.length; n++) {
      const findings = [issue(`wide-${n}`, urls[n], 'Widespread finding')];
      if (n === 6) {
        findings.push(issue('wide-duplicate-url', urls[n], 'Widespread finding'));
        findings.push(...Array.from({ length: 12 }, (_, group) => issue(`low-${group}`, urls[n], `Low finding ${group}`, 'seo', 'low')));
      }
      await commit({ items: [item(String(n), urls[n], 200, 'success', 1, findings, 10, 100)] });
    }
    const auditRow = await db.query<any>('select * from audits where id=$1', [id]);
    assert.equal(toAuditDocument(auditRow.rows[0])?.presentationSummary?.attemptedPages, 36);
    const scoreGroups = await db.query<{ affected_pages: number }>('select affected_pages from audit_score_groups where audit_id=$1', [id]);
    assert.equal(scoreGroups.rows[0].affected_pages, 36, 'presentation does not alter score-group idempotency');
    const expectedScores = { overall: 81, scoringVersion: '2.2', evidenceSample: true };
    assert.equal(await rpc('scalable_audit_finish_slice', [id, 'worker', claim.run.generation,
      JSON.stringify({ scores: expectedScores, summary: { text: 'Complete' }, pages: [], top_issues: [], exports: {}, presentation_summary: { topRecommendations: ['untrusted'] } }), 'crawl_queue_exhausted']), true);
    const stored = await db.query<any>(`select p.*,a.presentation_summary audit_summary from audit_reports p join audits a on a.id=p.audit_id where p.audit_id=$1`, [id]);
    const savedSummary = readAuditPresentationSummary(stored.rows[0].presentation_summary)!;
    assert.ok(savedSummary);
    assert.deepEqual(stored.rows[0].scores, expectedScores, 'finalization does not recalculate scores');
    assert.deepEqual(stored.rows[0].audit_summary, savedSummary);
    assert.equal(savedSummary.topRecommendations.length, 10);
    assert.equal(savedSummary.topRecommendations[0].title, 'Widespread finding');
    assert.equal(savedSummary.topRecommendations[0].affectedPages, 30, 'recommendations cover all findings, distinct by affected page');
    assert.equal(savedSummary.topRecommendations[0].recommendation, 'Fix Widespread finding');
    assert.deepEqual(stored.rows[0].top_issues, [], 'sample payload is not used to derive recommendations');
    await assert.rejects(commit({ items: [rootItem] }), /AUDIT_OWNERSHIP_LOST/);

    // Runs created before 027 cannot claim complete aggregate coverage on resume.
    await db.query(`update audits set status='queued' where id=$1`, [resumedId]);
    const resumed = await rpc('claim_scalable_audit', ['worker', true]);
    assert.equal(resumed.audit.id, resumedId);
    assert.equal(resumed.run.presentation_summary, null);
    const resumedItem = item('resumed', resumedRoot, 200, 'success', 0, [], 100, 1000);
    const resumedRun = await rpc('scalable_audit_commit', [resumedId, 'worker', resumed.run.generation, JSON.stringify({ items: [resumedItem] })]);
    assert.equal(resumedRun.analysed, 1);
    assert.equal(resumedRun.presentation_summary, null);
    assert.equal(await rpc('scalable_audit_finish_slice', [resumedId, 'worker', resumed.run.generation,
      JSON.stringify({ scores: expectedScores, summary: { text: 'Sample' }, pages: [], top_issues: [], exports: {} }), 'crawl_queue_exhausted']), true);
    const resumedReport = await db.query<any>('select presentation_summary,scores from audit_reports where audit_id=$1', [resumedId]);
    assert.deepEqual(resumedReport.rows[0], { presentation_summary: null, scores: expectedScores });

    await db.exec(await migration('027_audit_presentation.sql'));
    const afterReapply = await db.query<any>('select presentation_summary from audit_reports where audit_id=$1', [id]);
    assert.deepEqual(afterReapply.rows[0].presentation_summary, savedSummary, 'reapplying the additive migration does not rewrite historical data');

    const securityPage = await db.query<{ id: string }>(`select id from audit_issues i where audit_id=$1
      and public.audit_report_section(i)='security' and id>$2 order by id limit 1`, [id, `${id}-5`]);
    assert.deepEqual(securityPage.rows.map(row => row.id), [`${id}-security`]);
    await db.exec('set enable_seqscan=off');
    const plan = await db.query<any>(`explain select id from audit_issues i where audit_id=$1
      and public.audit_report_section(i)='security' and id>$2 order by id limit 51`, [id, `${id}-5`]);
    assert.match(plan.rows.map(row => row['QUERY PLAN']).join('\n'), /audit_issues_section_cursor/);
    await db.exec('reset enable_seqscan');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(rpc('classify_audit_report_section', ['seo', 'Missing title', '']), /permission denied/);
      await assert.rejects(rpc('scalable_audit_top_recommendations', [id]), /permission denied/);
      await assert.rejects(commit({}), /permission denied/);
      await db.exec('reset role');
    }
  } finally {
    await db.close();
  }
});

test('report mapper preserves the saved aggregate without promoting historical samples', async context => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://summary-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  const summary = emptySummary();
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return new Response(JSON.stringify({ scores: { overall: 17, evidenceSample: true }, summary: { text: 'Saved' },
      generated_at: summary.updatedAt, ...(url.searchParams.get('audit_id') === 'eq.new' ? { presentation_summary: summary } : {}) }),
    { headers: { 'content-type': 'application/json' } });
  });
  try {
    assert.deepEqual((await auditRepository.getFinalReport('new'))?.presentationSummary, summary);
    assert.equal((await auditRepository.getFinalReport('old'))?.presentationSummary, undefined);
    assert.equal((await auditRepository.getFinalReport('old'))?.scores.overall, 17);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
