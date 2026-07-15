import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import http from 'node:http';
import express from 'express';
import { apiRouter } from '../src/api/index';
import { auditRepository } from '../src/lib/supabase/audit-repository';
import type { ResourceAuditReport } from '../src/lib/audit/resource-types';

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

function listen(server: http.Server) {
  return new Promise<any>((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
}

function close(server: http.Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const guestId = 'pdf-smoke-guest';
const guestKeyHash = createHash('sha256').update(`guest-session:${guestId}`).digest('hex');
const longUrl = `https://example.com/services/${'long-path-segment-'.repeat(18)}`;
const longRecommendation = `Rewrite the page section using a specific heading and a clear explanation for visitors. ${'Keep the wording useful, concise, and tied to the page purpose. '.repeat(12)}`;

async function createCompletedAudit(plan: 'free' | 'paid') {
  const audit = await auditRepository.createAuditJob({
    submittedInput: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    hostname: 'example.com',
    mode: plan === 'paid' ? 'standard' : 'quick',
    requestedMode: plan === 'paid' ? 'standard' : 'quick',
    effectiveMode: plan === 'paid' ? 'standard' : 'quick',
    plan,
    processingTier: plan,
    pageLimit: plan === 'paid' ? 25 : 5,
    queuePriority: plan === 'paid' ? 50 : 10,
    guestKeyHash,
  });

  await auditRepository.appendPage(audit.id, {
    url: longUrl,
    statusCode: 200,
    responseTimeMs: 312,
    pageSizeBytes: 145230,
    title: 'Long service page title for PDF layout verification',
    metaDescription: 'A detailed page description used to verify metadata preview wrapping inside the generated PDF report.',
    h1: 'Service page',
    wordCount: 1240,
    crawlDepth: 2,
    issueCount: 1,
    crawledAt: new Date().toISOString(),
  });
  await auditRepository.appendIssue(audit.id, {
    severity: 'high',
    category: 'On-page SEO',
    title: 'The primary heading does not describe the page clearly enough for visitors and search engines',
    description: 'The heading is generic and does not identify the service or page purpose.',
    affectedUrl: longUrl,
    evidence: 'The first heading is "Welcome" and provides no subject context.',
    recommendation: longRecommendation,
  });
  await auditRepository.appendEvent(audit.id, {
    type: 'audit_completed',
    timestamp: new Date().toISOString(),
    message: 'Audit completed and report data stored.',
    progress: 100,
  });

  const report: ResourceAuditReport = {
    scores: { overall: 78, seo: 74, technical: 82, performance: 69, crawlability: 88, security: 91 },
    summary: 'The site is generally healthy, with a small number of high-priority content and performance fixes.',
    topIssues: [],
    pages: [],
    exports: { json: '', issuesCsv: '', pagesCsv: '' },
    generatedAt: new Date().toISOString(),
  };
  await auditRepository.setFinalReport(audit.id, report);
  await auditRepository.updateAudit(audit.id, {
    status: 'completed',
    progress: 100,
    pagesCrawled: 1,
    pagesDiscovered: 1,
    checksCompleted: 8,
    checksTotal: 8,
    issuesFound: 1,
    highCount: 1,
    completedAt: new Date().toISOString(),
  });
  return audit.id;
}

const app = express();
app.use('/api/tools', apiRouter);
const server = http.createServer(app);
const address = await listen(server);

try {
  const paidAuditId = await createCompletedAudit('paid');
  const freeAuditId = await createCompletedAudit('free');
  const headers = { 'x-crawlio-guest-id': guestId };

  const paidResponse = await fetch(`http://127.0.0.1:${address.port}/api/tools/audit/export/${paidAuditId}/pdf`, { headers });
  assert.equal(paidResponse.status, 200);
  assert.match(paidResponse.headers.get('content-type') || '', /application\/pdf/);
  assert.match(paidResponse.headers.get('content-disposition') || '', /attachment; filename="crawlio-example.com-audit.pdf"/);
  const paidBuffer = Buffer.from(await paidResponse.arrayBuffer());
  assert.equal(paidBuffer.subarray(0, 4).toString(), '%PDF');
  assert.match(paidBuffer.subarray(Math.max(0, paidBuffer.length - 32)).toString(), /%%EOF/);
  assert.ok(paidBuffer.length > 5000, 'PDF should contain a formatted multi-section report.');
  if (process.env.PDF_SMOKE_OUTPUT) await writeFile(process.env.PDF_SMOKE_OUTPUT, paidBuffer);

  const freeResponse = await fetch(`http://127.0.0.1:${address.port}/api/tools/audit/export/${freeAuditId}/pdf`, { headers });
  assert.equal(freeResponse.status, 403);
  const freeBody = await freeResponse.json();
  assert.equal(freeBody.upgradeRequired, true);

  const deniedResponse = await fetch(`http://127.0.0.1:${address.port}/api/tools/audit/export/${paidAuditId}/pdf`, {
    headers: { 'x-crawlio-guest-id': 'different-guest' },
  });
  assert.equal(deniedResponse.status, 404);

  console.log(`Audit PDF smoke test passed (${paidBuffer.length} bytes).`);
} finally {
  await close(server);
}
