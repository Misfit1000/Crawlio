import assert from 'node:assert/strict';
import { auditRepository } from '../src/lib/supabase/audit-repository';

if (auditRepository.isSupabaseEnabled()) {
  console.log('Audit history smoke skipped because production Supabase credentials are configured.');
  process.exit(0);
}

const userId = 'history-smoke-user';
const common = {
  submittedInput: 'https://example.com',
  normalizedUrl: 'https://example.com/',
  hostname: 'example.com',
  userId,
};
const baseline = await auditRepository.createAuditJob(common);
const current = await auditRepository.createAuditJob(common);

await auditRepository.appendIssues(baseline.id, [
  { severity: 'high', category: 'seo', title: 'Missing title', description: 'Missing title', affectedUrl: 'https://example.com/', evidence: '', recommendation: 'Add a title.' },
  { severity: 'medium', category: 'technical', title: 'Slow response', description: 'Slow response', affectedUrl: 'https://example.com/about', evidence: '1800ms', recommendation: 'Improve response time.' },
]);
await auditRepository.appendIssues(current.id, [
  { severity: 'high', category: 'seo', title: 'Missing title', description: 'Missing title', affectedUrl: 'https://example.com/', evidence: '', recommendation: 'Add a title.' },
  { severity: 'medium', category: 'security', title: 'Missing CSP', description: 'Missing CSP', affectedUrl: 'https://example.com/', evidence: '', recommendation: 'Add a CSP.' },
]);

const report = (overall: number) => ({
  scores: { overall },
  summary: `Score ${overall}`,
  topIssues: [],
  pages: [],
  exports: { json: '', issuesCsv: '', pagesCsv: '' },
  generatedAt: new Date().toISOString(),
});
await auditRepository.setFinalReport(baseline.id, report(70));
await auditRepository.setFinalReport(current.id, report(85));
await auditRepository.updateAudit(baseline.id, { status: 'completed', completedAt: new Date().toISOString() });
await auditRepository.updateAudit(current.id, { status: 'completed', completedAt: new Date().toISOString() });

const history = await auditRepository.listAuditHistoryForUser({ userId, limit: 10 });
assert.equal(history.total, 2);
assert.equal(history.items.length, 2);
assert.ok(history.items.every((item) => item.audit.userId === userId));
assert.ok(history.items.every((item) => item.finalReport));

const comparison = await auditRepository.compareAudits(current.id, baseline.id);
assert.ok(comparison);
assert.equal(comparison.scoreDelta, 15);
assert.equal(comparison.newIssues.length, 1);
assert.equal(comparison.resolvedIssues.length, 1);
assert.equal(comparison.persistentIssues.length, 1);
assert.equal(comparison.newIssues[0].title, 'Missing CSP');
assert.equal(comparison.resolvedIssues[0].title, 'Slow response');

console.log('Supabase audit history and comparison smoke test passed.');
