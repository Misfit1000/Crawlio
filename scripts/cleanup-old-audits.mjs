import { auditRepository } from '../src/lib/firebase/audit-repository.ts';

await auditRepository.clearExpiredAuditData();
console.log('Expired audit data cleanup complete.');
