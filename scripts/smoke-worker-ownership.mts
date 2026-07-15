import assert from 'node:assert/strict';
import { auditRepository } from '../src/lib/supabase/audit-repository';

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const audit = await auditRepository.createAuditJob({
  submittedInput: 'https://example.com', normalizedUrl: 'https://example.com/', hostname: 'example.com',
  mode: 'quick', requestedMode: 'quick', effectiveMode: 'quick', plan: 'free', processingTier: 'free',
});
const claimed = await auditRepository.claimNextQueuedAudit('worker-a');
assert.equal(claimed?.id, audit.id);
assert.equal(await auditRepository.updateAuditForWorker(audit.id, 'worker-b', { progress: 50 }), false);
assert.equal((await auditRepository.getAudit(audit.id))?.progress, 1);

assert.equal(await auditRepository.cancelAudit(audit.id), true);
assert.equal(await auditRepository.updateAuditForWorker(audit.id, 'worker-a', { status: 'completed', progress: 100 }), false);
assert.equal((await auditRepository.getAudit(audit.id))?.status, 'cancelled', 'A worker must not overwrite cancellation.');
assert.equal(await auditRepository.cancelAudit(audit.id), false, 'Terminal audits cannot be cancelled again.');

const raceAudit = await auditRepository.createAuditJob({
  submittedInput: 'https://example.org', normalizedUrl: 'https://example.org/', hostname: 'example.org',
  mode: 'quick', requestedMode: 'quick', effectiveMode: 'quick', plan: 'free', processingTier: 'free',
});
const raceClaims = await Promise.all([
  auditRepository.claimNextQueuedAudit('race-worker-a'),
  auditRepository.claimNextQueuedAudit('race-worker-b'),
]);
assert.equal(raceClaims.filter((candidate) => candidate?.id === raceAudit.id).length, 1, 'Only one worker may claim a queued audit.');

console.log('Worker ownership and cancellation smoke test passed.');
