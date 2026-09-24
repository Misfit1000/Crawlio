import assert from 'node:assert/strict';
import { auditRepository } from '../src/lib/supabase/audit-repository';
import { auditSnapshot } from '../tests/e2e/helpers';
import type { ResourceAuditDocument, ResourceAuditReport } from '../src/lib/audit/resource-types';
import { inflightRead } from '../src/lib/http/inflight-read';

let reads = 0;
let release!: (value: number) => void;
const request = () => { reads++; return new Promise<number>((resolve) => { release = resolve; }); };
const first = inflightRead('/private', { Authorization: 'identity-a' }, request);
const duplicate = inflightRead('/private', { Authorization: 'identity-a' }, request);
assert.equal(first, duplicate);
assert.equal(reads, 1);
release(12);
assert.equal(await first, 12);
assert.equal(await inflightRead('/private', { Authorization: 'identity-a' }, async () => 13), 13, 'settled values must not be cached');
const other = inflightRead('/private', { Authorization: 'identity-b' }, async () => 20);
assert.equal(await other, 20, 'different identities must not share responses');

const original = {
  getAuditJob: auditRepository.getAuditJob,
  getLatestEvents: auditRepository.getLatestEvents,
  getLatestPages: auditRepository.getLatestPages,
  getLatestIssues: auditRepository.getLatestIssues,
  getFinalReport: auditRepository.getFinalReport,
};
const calls: string[] = [];
const running = auditSnapshot('running').audit as ResourceAuditDocument;
const completed = auditSnapshot().audit as ResourceAuditDocument;
const report = auditSnapshot().finalReport as ResourceAuditReport;
try {
  auditRepository.getAuditJob = async () => { calls.push('audit'); return running; };
  auditRepository.getLatestEvents = async () => { calls.push('events'); return []; };
  auditRepository.getLatestPages = async () => { calls.push('pages'); return []; };
  auditRepository.getLatestIssues = async () => { calls.push('issues'); return []; };
  auditRepository.getFinalReport = async () => { calls.push('report'); return report; };
  const active = await auditRepository.getLiveData(running.id, running);
  assert.deepEqual(calls, ['events', 'pages', 'issues']);
  assert.equal(active.finalReport, null);
  calls.length = 0;
  const final = await auditRepository.getLiveData(completed.id, completed);
  assert.equal(final.finalReport, report);
  assert.deepEqual(calls, ['events', 'pages', 'issues', 'report']);
  calls.length = 0;
  auditRepository.getAuditJob = async () => { calls.push('audit'); return null; };
  assert.equal((await auditRepository.getLiveData('missing')).audit, null);
  assert.deepEqual(calls, ['audit'], 'missing audits must not read evidence tables');
  console.log('Audit snapshot efficiency: active, final, authorized snapshot reuse, and missing audit passed.');
} finally {
  Object.assign(auditRepository, original);
}
