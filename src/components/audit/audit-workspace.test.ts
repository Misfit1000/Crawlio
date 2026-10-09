import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AuditPresentationSummary, ResourceAuditDocument, ResourceAuditIssue, ResourceAuditLiveData, ResourceAuditPage, ResourceAuditReport } from '../../lib/audit/resource-types';
import { buildHistoryEntry, flushAuditHistory, readAuditHistory, upsertAuditHistory } from '../../lib/audit/client-insights';
import { completePresentationSummary, samplePresentation } from './audit-presentation';

const timestamp = '2026-10-01T00:00:00.000Z';
const page = (index: number, statusCode = 200): ResourceAuditPage => ({ id: `p${index}`, url: `https://example.com/${index}`, statusCode, responseTimeMs: 0, pageSizeBytes: 0, title: 'Example', metaDescription: '', h1: '', fetchStatus: statusCode < 400 ? 'success' : 'failed', wordCount: 0, crawlDepth: index % 3, issueCount: 1, crawledAt: timestamp });
const issue = (index: number): ResourceAuditIssue => ({ id: `i${index}`, title: 'Missing title', category: 'seo', severity: 'high', description: '', affectedUrl: `https://example.com/${index}`, evidence: '', recommendation: 'Set a descriptive page title.', detectedAt: timestamp });
const audit = (status: ResourceAuditDocument['status'] = 'running'): ResourceAuditDocument => ({ id: 'test-audit', normalizedUrl: 'https://example.com/', hostname: 'example.com', status, updatedAt: timestamp, createdAt: timestamp, startedAt: timestamp, projectId: null, mode: 'quick', pagesCrawled: 1, pageLimit: 5, issuesFound: 1, criticalCount: 0, highCount: 1, mediumCount: 0, lowCount: 0 } as ResourceAuditDocument);
const summary: AuditPresentationSummary = { version: 1, scope: 'complete', analysedPages: 100, attemptedPages: 101, responseOutcomes: { success: 100, redirect: 0, clientError: 1, serverError: 0, unavailable: 0 }, delivery: { count: 100, totalResponseMs: 0, totalBytes: 0, averageResponseMs: 0, averagePageBytes: 0 }, pagesWithFindings: 100, depthCounts: { '0': 101 }, findingsBySection: { 'on-page': 100 }, topRecommendations: [{ key: 'title', title: 'Missing title', category: 'seo', severity: 'high', affectedPages: 100, recommendation: 'Set a title.' }], updatedAt: timestamp };

test('complete aggregates win over the bounded evidence sample, without changing stored scores', () => {
  const document = { ...audit('completed'), presentationSummary: summary };
  const report: ResourceAuditReport = { scores: { overall: 81, scoringVersion: '2.2' }, summary: '', topIssues: [], pages: [], exports: { json: '', issuesCsv: '', pagesCsv: '' }, generatedAt: timestamp, presentationSummary: { ...summary, updatedAt: '2026-10-01T00:00:01.000Z' } };
  assert.equal(completePresentationSummary(document, report), report.presentationSummary);
  assert.equal(report.scores.overall, 81);
  assert.equal(completePresentationSummary(audit(), null), null);
  assert.equal(completePresentationSummary({ ...document, presentationSummary: { ...summary, scope: 'sample' } as unknown as AuditPresentationSummary }, null), null);
});

test('sample outcomes are mutually exclusive and zero-valued delivery remains measured', () => {
  const sample = samplePresentation([page(0, 200), page(1, 301), page(2, 404), page(3, 503), page(4, 0)], [issue(0), issue(1)]);
  assert.deepEqual(sample.responseOutcomes, { success: 1, redirect: 1, clientError: 1, serverError: 1, unavailable: 1 });
  assert.equal(sample.delivery.averageResponseMs, 0);
  assert.equal(sample.delivery.averagePageBytes, 0);
  assert.equal(sample.topRecommendations.length, 1);
  assert.equal(sample.topRecommendations[0].affectedPages, 2);
  assert.equal(Object.values(sample.depthCounts).reduce((sum, count) => sum + count, 0), 5);
});

test('history is bounded, throttled, terminal-flushed and tolerant of unavailable storage', () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalNow = Date.now;
  const values = new Map<string, string>();
  const callbacks = new Map<number, () => void>();
  let writes = 0;
  let now = 10_000;
  let timerId = 0;
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { writes++; values.set(key, value); } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage, addEventListener() {}, setTimeout: (callback: () => void) => { callbacks.set(++timerId, callback); return timerId; }, clearTimeout: (id: number) => callbacks.delete(id) } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false, addEventListener() {} } });
  Date.now = () => now;
  try {
    const data: ResourceAuditLiveData = { audit: audit(), latestEvents: [], latestPages: Array.from({ length: 1000 }, (_, index) => page(index)), latestIssues: Array.from({ length: 900 }, (_, index) => issue(index)) };
    const entry = buildHistoryEntry(data)!;
    assert.equal(entry.pageSummaries.length, 48);
    assert.equal(entry.issueSignatures.length, 512);
    assert.equal(entry.topIssues?.length, 12);
    upsertAuditHistory(data);
    assert.equal(writes, 1);
    for (let index = 0; index < 30; index++) upsertAuditHistory({ ...data, audit: { ...data.audit!, updatedAt: new Date(now + index).toISOString() } });
    assert.equal(writes, 1);
    assert.equal(callbacks.size, 1);
    const report: ResourceAuditReport = { scores: { overall: 81, scoringVersion: '2.2' }, summary: '', topIssues: [], pages: [], exports: { json: '', issuesCsv: '', pagesCsv: '' }, generatedAt: timestamp };
    upsertAuditHistory({ ...data, audit: audit('completed'), finalReport: report });
    assert.equal(writes, 2);
    assert.equal(callbacks.size, 0);
    assert.equal(readAuditHistory()[0].score, 81);
    now += 6000;
    upsertAuditHistory(data);
    assert.equal(readAuditHistory()[0].status, 'completed');
    assert.equal(readAuditHistory()[0].score, 81);
    Object.defineProperty(globalThis.window, 'localStorage', { get() { throw new Error('Storage denied'); } });
    assert.doesNotThrow(() => upsertAuditHistory(data));
  } finally {
    flushAuditHistory();
    Date.now = originalNow;
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor); else Reflect.deleteProperty(globalThis, 'window');
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor); else Reflect.deleteProperty(globalThis, 'document');
  }
});
