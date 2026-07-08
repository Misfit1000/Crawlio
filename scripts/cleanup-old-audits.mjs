import { auditRepository } from '../src/lib/supabase/audit-repository.ts';

await auditRepository.cleanupOldAudits();
console.log('Expired audit data cleanup complete.');
