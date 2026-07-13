import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createEmptyAuditLiveData,
  isFinalReportPending,
  mergeAuditLiveData,
  waitForPersistedFinalReport,
} from '../src/lib/audit/audit-lifecycle';
import {
  TERMINAL_AUDIT_STATUSES,
  hasUsableAuditReport,
  isTerminalAuditStatus,
} from '../src/lib/audit/audit-time';
import type { AuditStatus, ResourceAuditLiveData } from '../src/lib/audit/resource-types';

function snapshot(status: AuditStatus, report = false): ResourceAuditLiveData {
  return {
    ...createEmptyAuditLiveData(),
    audit: {
      id: 'audit-stability-test',
      status,
      normalizedUrl: 'https://example.com/',
      hostname: 'example.com',
    } as ResourceAuditLiveData['audit'],
    latestEvents: [{ id: 'event-1', type: 'status', timestamp: new Date().toISOString(), message: 'Checks finished.' }],
    finalReport: report ? {
      scores: { overall: 82 },
      summary: 'Stored report',
      topIssues: [],
      pages: [],
      exports: { json: '{}', issuesCsv: '', pagesCsv: '' },
      generatedAt: new Date().toISOString(),
    } : null,
  };
}

assert.deepEqual(
  [...TERMINAL_AUDIT_STATUSES].sort(),
  ['abandoned', 'cancelled', 'completed', 'completed_with_warnings', 'failed'].sort(),
);
for (const status of TERMINAL_AUDIT_STATUSES) assert.equal(isTerminalAuditStatus(status), true);
assert.equal(isTerminalAuditStatus('queued'), false);
assert.equal(isTerminalAuditStatus('running'), false);
assert.equal(hasUsableAuditReport('completed'), true);
assert.equal(hasUsableAuditReport('completed_with_warnings'), true);
assert.equal(hasUsableAuditReport('failed'), false);

const completedBeforeReport = snapshot('completed');
assert.equal(isFinalReportPending(completedBeforeReport), true);

let reportReads = 0;
const delayedReport = await waitForPersistedFinalReport(
  completedBeforeReport,
  async () => {
    reportReads += 1;
    return snapshot('completed', reportReads >= 2);
  },
  { delays: [0, 0, 0], wait: async () => undefined },
);
assert.equal(delayedReport.exhausted, false);
assert.equal(delayedReport.attempts, 2);
assert.equal(delayedReport.data.finalReport?.summary, 'Stored report');
assert.equal(delayedReport.data.latestEvents.length, 1);

const preserved = mergeAuditLiveData(snapshot('completed', true), {
  ...createEmptyAuditLiveData(),
  audit: snapshot('completed').audit,
});
assert.equal(preserved.finalReport?.summary, 'Stored report');
assert.equal(preserved.latestEvents.length, 1);

let failedReads = 0;
const failedAudit = await waitForPersistedFinalReport(snapshot('failed'), async () => {
  failedReads += 1;
  return snapshot('failed');
}, { delays: [0], wait: async () => undefined });
assert.equal(failedReads, 0);
assert.equal(failedAudit.exhausted, false);

const componentFiles = [
  'src/components/SecurityAudit.tsx',
  'src/components/SeoAudit.tsx',
  'src/components/WebsiteAnalyzer.tsx',
];
for (const file of componentFiles) {
  const source = await readFile(resolve(file), 'utf8');
  assert.doesNotMatch(source, /onComplete\s*=/, `${file} must not adapt terminal results locally`);
  assert.doesNotMatch(source, /navigate-live-audit|history\.pushState/, `${file} must use the application router`);
  assert.match(source, /navigate\(`\/audit\/live\/\$\{encodeURIComponent\(/, `${file} must open the canonical live audit route`);
}

const liveSource = await readFile(resolve('src/components/audit/LiveAuditProgress.tsx'), 'utf8');
assert.match(liveSource, /waitForPersistedFinalReport/);
assert.match(liveSource, /Checks finished\. Loading the saved report\./);
assert.match(liveSource, /AuditTerminalState/);
assert.doesNotMatch(liveSource, /onComplete/);

const providerSource = await readFile(resolve('src/components/audit/AuditWorkspaceContext.tsx'), 'utf8');
assert.match(providerSource, /mergeAuditLiveData/);
assert.match(providerSource, /waitForPersistedFinalReport/);

const mainSource = await readFile(resolve('src/main.tsx'), 'utf8');
assert.match(mainSource, /<AppErrorBoundary>/);

console.log('Post-audit route stability smoke test passed.');
