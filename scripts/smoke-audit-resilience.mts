import assert from 'node:assert/strict';
import http from 'node:http';
import { auditRepository } from '../src/lib/supabase/audit-repository.ts';
import { runOneAudit } from '../src/workers/audit-worker.ts';

process.env.SEOINTEL_ALLOW_PRIVATE_TEST_TARGETS = 'true';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

let flakyRequests = 0;
const server = http.createServer((request, response) => {
  response.setHeader('content-type', request.url === '/robots.txt' ? 'text/plain' : 'text/html; charset=utf-8');
  if (request.url === '/robots.txt') return response.end('User-agent: *\nAllow: /');
  if (request.url === '/sitemap.xml') {
    response.statusCode = 404;
    return response.end('not found');
  }
  if (request.url === '/missing' || request.url === '/root-missing') {
    response.statusCode = 404;
    return response.end('<h1>Not found</h1>');
  }
  if (request.url === '/flaky') {
    flakyRequests += 1;
    if (flakyRequests === 1) {
      response.statusCode = 503;
      return response.end('<h1>Try again</h1>');
    }
    return response.end('<title>Recovered page</title><h1>Recovered page</h1>');
  }
  if (request.url === '/healthy') return response.end('<title>Healthy page</title><h1>Healthy page</h1>');
  if (request.url === '/source-a' || request.url === '/source-b') return response.end(`<title>Source page</title><h1>Source page</h1><a href="/missing">Broken destination from ${request.url}</a>`);
  return response.end('<title>Fixture home</title><meta name="description" content="Fixture description"><h1>Fixture home</h1><a href="/source-a">Source A</a><a href="/source-b">Source B</a><a href="/missing">Missing</a><a href="/flaky">Flaky</a>');
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;

async function queue(path: string) {
  return auditRepository.createAuditJob({
    submittedInput: `${origin}${path}`,
    normalizedUrl: `${origin}${path}`,
    hostname: '127.0.0.1',
    mode: 'quick',
    requestedMode: 'quick',
    effectiveMode: 'quick',
    plan: 'free',
  });
}

try {
  const warningAudit = await queue('/');
  assert.equal(await runOneAudit('resilience-worker'), true);
  const warningData = await auditRepository.getLiveData(warningAudit.id);
  assert.equal(warningData.audit?.status, 'completed_with_warnings');
  assert.equal(warningData.audit?.progress, 100);
  assert.equal(warningData.audit?.lockedBy, null);
  assert.equal(warningData.audit?.leaseExpiresAt, null);
  assert.ok(warningData.audit!.checksCompleted <= warningData.audit!.checksTotal, 'completed checks must fit the check budget');
  assert.ok(warningData.latestPages.some((page) => page.url.endsWith('/missing') && page.failureCode === 'HTTP_404'));
  const missingIssue = warningData.latestIssues.find((issue) => issue.title === 'Page returned 404 Not Found');
  assert.ok(missingIssue);
  assert.equal(missingIssue.affectedPageCount, 3);
  assert.deepEqual(new Set(missingIssue.sourceUrls).size, 3);
  assert.ok(warningData.latestPages.some((page) => page.url.endsWith('/flaky') && page.fetchStatus === 'success' && page.attemptCount === 2 && page.recoveredAfterRetry));
  assert.equal(flakyRequests, 2, 'retryable responses must retry once, not indefinitely');
  const reportScores = warningData.finalReport?.scores as { coverage?: { pagesAnalysed?: number; pagesFailed?: number }; warningSummary?: Record<string, number> } | undefined;
  assert.ok(reportScores?.coverage);
  assert.ok((reportScores?.coverage?.pagesAnalysed || 0) >= 2);
  assert.equal(reportScores?.coverage?.pagesFailed, 1);
  assert.equal(reportScores?.warningSummary?.HTTP_404, 1);

  const failedAudit = await queue('/root-missing');
  assert.equal(await runOneAudit('resilience-worker'), true);
  const failed = await auditRepository.getAudit(failedAudit.id);
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.progress, 100);
  assert.equal(failed?.lockedBy, null);
  assert.equal(failed?.leaseExpiresAt, null);

  const nextAudit = await queue('/healthy');
  assert.equal(await runOneAudit('resilience-worker'), true, 'worker must continue after a target-site failure');
  const next = await auditRepository.getAudit(nextAudit.id);
  assert.ok(next?.status === 'completed' || next?.status === 'completed_with_warnings');
  assert.equal(next?.progress, 100);

  const storageAudit = await queue('/healthy');
  await auditRepository.updateAudit(storageAudit.id, { pageLimit: 1000 });
  const saveFinalReport = auditRepository.setFinalReport;
  try {
    auditRepository.setFinalReport = async () => { throw new Error('Database report write failed: private diagnostic'); };
    await runOneAudit('storage-failure-worker');
  } finally {
    auditRepository.setFinalReport = saveFinalReport;
  }
  const interrupted = await auditRepository.getLiveData(storageAudit.id);
  assert.equal(interrupted.audit?.status, 'failed');
  assert.equal(interrupted.audit?.pageLimit, 50, 'display the effective Quick-mode worker allowance');
  assert.equal(interrupted.audit?.failureCounts?.AUDIT_PROCESSING_FAILED, 1);
  assert.match(interrupted.audit?.error || '', /Crawlio could not finish/);
  assert.doesNotMatch(interrupted.audit?.error || '', /private diagnostic|website request did not complete/i);
  assert.ok(interrupted.latestPages.length > 0, 'preserve collected evidence on storage failure');

  const staleAudit = await queue('/healthy');
  await auditRepository.updateAudit(staleAudit.id, {
    status: 'running',
    lockedBy: 'stale-worker',
    lockedAt: new Date(Date.now() - 120_000).toISOString(),
    leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  assert.equal(await runOneAudit('recovery-worker'), true);
  const recovered = await auditRepository.getLiveData(staleAudit.id);
  assert.ok(recovered.latestEvents.some((event) => event.type === 'audit_recovered'));
  assert.equal(recovered.audit?.progress, 100);
  assert.equal(recovered.audit?.lockedBy, null);

  console.log('Audit resilience smoke test passed.');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
