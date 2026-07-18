import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateTransparentAuditScore } from '../src/lib/audit/audit-scoring.ts';
import { getAuditLiveScore } from '../src/lib/audit/audit-live-score.ts';
import {
  buildProvisionalAuditScore,
  PROVISIONAL_SCORE_MIN_INTERVAL_MS,
  PROVISIONAL_SCORE_PAGE_INTERVAL,
  shouldPublishProvisionalScore,
} from '../src/lib/audit/audit-provisional-score.ts';
import type { ResourceAuditDocument, ResourceAuditIssue, ResourceAuditPage, ResourceAuditReport } from '../src/lib/audit/resource-types.ts';

const pages: ResourceAuditPage[] = Array.from({ length: 5 }, (_value, index) => ({
  id: `page-${index}`, url: `https://example.com/page-${index}`, statusCode: 200, responseTimeMs: 120,
  pageSizeBytes: 24_000, title: `Page ${index}`, metaDescription: 'A useful description', h1: `Page ${index}`,
  wordCount: 500, crawlDepth: 1, issueCount: index === 0 ? 1 : 0, crawledAt: '2026-07-15T10:00:00.000Z',
}));
const issues: ResourceAuditIssue[] = [{
  id: 'issue-1', severity: 'high', category: 'on-page', title: 'Missing page title', description: 'Title missing',
  affectedUrl: pages[0].url, evidence: 'No title', recommendation: 'Add a descriptive title', detectedAt: '2026-07-15T10:00:00.000Z',
}];

const canonical = calculateTransparentAuditScore({
  issues, pages,
  unavailableChecks: { mobile: ['Browser-rendered device metrics were not collected.'], technical: [] },
});
const provisional = buildProvisionalAuditScore({
  issues, pages, pagesAnalysed: 5, pagesDiscovered: 30, pageLimit: 50,
  unavailableChecks: [], updatedAt: '2026-07-15T10:00:05.000Z',
});
assert.equal(provisional.overallScore, canonical.overall, 'provisional scoring must use the canonical scoring result');
assert.equal(provisional.scoreState, 'provisional');
for (const value of [provisional.overallScore, ...Object.values(provisional.categoryScores)]) {
  if (value != null) assert.ok(Number.isFinite(value) && value >= 0 && value <= 100);
}

assert.equal(shouldPublishProvisionalScore({ pagesAnalysed: 0, lastPublishedPages: 0, nowMs: 500, lastPublishedAtMs: 0 }), false);
assert.equal(shouldPublishProvisionalScore({ pagesAnalysed: 1, lastPublishedPages: 0, nowMs: 500, lastPublishedAtMs: 0 }), true);
assert.equal(shouldPublishProvisionalScore({ pagesAnalysed: 5, lastPublishedPages: 1, nowMs: 2_000, lastPublishedAtMs: 500 }), false);
assert.equal(shouldPublishProvisionalScore({ pagesAnalysed: 6, lastPublishedPages: 1, nowMs: 1_500, lastPublishedAtMs: 500 }), false);
assert.equal(shouldPublishProvisionalScore({ pagesAnalysed: 6, lastPublishedPages: 1, nowMs: 2_000, lastPublishedAtMs: 500 }), true);
assert.equal(shouldPublishProvisionalScore({ pagesAnalysed: 8, lastPublishedPages: 6, nowMs: 2_100, lastPublishedAtMs: 2_000, force: true }), true);
assert.equal(shouldPublishProvisionalScore({ pagesAnalysed: 6, lastPublishedPages: 6, nowMs: 3_500, lastPublishedAtMs: 2_000, force: true }), false);

function countScoreUpdates(pageCount: number) {
  let updates = 0;
  let lastPublishedPages = 0;
  let lastPublishedAtMs = 0;
  for (let page = 1; page <= pageCount; page += 1) {
    const nowMs = page * PROVISIONAL_SCORE_MIN_INTERVAL_MS;
    if (shouldPublishProvisionalScore({ pagesAnalysed: page, lastPublishedPages, nowMs, lastPublishedAtMs })) {
      updates += 1;
      lastPublishedPages = page;
      lastPublishedAtMs = nowMs;
    }
  }
  return updates;
}
assert.equal(PROVISIONAL_SCORE_PAGE_INTERVAL, 5);
assert.equal(countScoreUpdates(25), 5);
assert.equal(countScoreUpdates(75), 15);
assert.ok(countScoreUpdates(75) < 75 / 2, 'score writes must remain far below page/check events');

const baseAudit = {
  id: 'score-audit', status: 'running', pagesCrawled: 5, pagesDiscovered: 30, pageLimit: 50,
  warningCount: 2, updatedAt: '2026-07-15T10:00:05.000Z', completedAt: null,
} as ResourceAuditDocument;
const scoreEvent = {
  id: 'score-event', type: 'score_updated', timestamp: provisional.updatedAt, message: 'Preliminary score updated', data: provisional,
};
const restored = getAuditLiveScore({ audit: baseAudit, events: [scoreEvent] });
assert.equal(restored.scoreState, 'provisional');
assert.equal(restored.overallScore, provisional.overallScore);
assert.equal(restored.pagesAnalysed, 5);

const finalReport = {
  scores: { overall: 71, seo: 72, technical: 69, unavailableChecks: ['Mobile field data unavailable'] },
  summary: 'Final report', topIssues: [], pages, exports: { json: '', issuesCsv: '', pagesCsv: '' },
  generatedAt: '2026-07-15T10:01:00.000Z',
} satisfies ResourceAuditReport;
const final = getAuditLiveScore({
  audit: { ...baseAudit, status: 'completed', completedAt: finalReport.generatedAt } as ResourceAuditDocument,
  events: [scoreEvent], finalReport,
});
assert.equal(final.scoreState, 'final');
assert.equal(final.overallScore, 71, 'the stored canonical report must replace provisional event data');
assert.equal(final.categoryScores.onPage, 72);
assert.equal(final.unavailableCount, 1);

const unavailable = getAuditLiveScore({ audit: { ...baseAudit, pagesCrawled: 2 } as ResourceAuditDocument, events: [] });
assert.equal(unavailable.scoreState, 'unavailable');
assert.equal(unavailable.overallScore, null);

const invalidEvent = { ...scoreEvent, data: { ...provisional, overallScore: Number.NaN, categoryScores: { onPage: 900 } } };
const sanitized = getAuditLiveScore({ audit: baseAudit, events: [invalidEvent] });
assert.equal(sanitized.overallScore, null);
assert.equal(sanitized.categoryScores.onPage, 100);

const worker = await readFile('src/workers/audit-worker.ts', 'utf8');
assert.match(worker, /buildProvisionalAuditScore/);
assert.match(worker, /calculateTransparentAuditScore/);
assert.match(worker, /type: 'score_updated'/);
assert.match(worker, /maybePublishProvisionalScore\(\{ force: true \}\)/);
assert.match(worker, /await writer\.flush\(false\)/);
assert.doesNotMatch(worker, /estimatedScore/);

console.log('Live audit scoring smoke test passed: first score at page 1, then every 5 additional pages.');
