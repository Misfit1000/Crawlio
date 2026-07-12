import assert from 'node:assert/strict';
import { auditRepository } from '../src/lib/supabase/audit-repository';

if (auditRepository.isSupabaseEnabled()) {
  console.log('Audit comparison smoke skipped because production Supabase credentials are configured.');
  process.exit(0);
}

const input = { submittedInput: 'https://comparison.example', normalizedUrl: 'https://comparison.example/', hostname: 'comparison.example', userId: 'comparison-user' };
const baseline = await auditRepository.createAuditJob(input);
const current = await auditRepository.createAuditJob(input);
const finding = (title: string) => ({ severity: 'medium' as const, category: 'seo', title, description: title, affectedUrl: input.normalizedUrl, evidence: '', recommendation: `Fix ${title}.` });
await auditRepository.appendIssues(baseline.id, [finding('Persistent'), finding('Resolved')]);
await auditRepository.appendIssues(current.id, [finding('Persistent'), finding('New')]);
const report = (score: number) => ({ scores: { overall: score }, summary: '', topIssues: [], pages: [], exports: { json: '', issuesCsv: '', pagesCsv: '' }, generatedAt: new Date().toISOString() });
await auditRepository.setFinalReport(baseline.id, report(72));
await auditRepository.setFinalReport(current.id, report(81));

const comparison = await auditRepository.compareAudits(current.id, baseline.id);
assert.ok(comparison);
assert.equal(comparison.scoreDelta, 9);
assert.deepEqual(comparison.newIssues.map((issue) => issue.title), ['New']);
assert.deepEqual(comparison.resolvedIssues.map((issue) => issue.title), ['Resolved']);
assert.deepEqual(comparison.persistentIssues.map((pair) => pair.current.title), ['Persistent']);
console.log('Audit comparison smoke test passed.');
