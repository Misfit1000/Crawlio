import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const customerFiles = [
  'src/components/LandingPage.tsx',
  'src/components/layout/ProductShells.tsx',
  'src/components/Dashboard.tsx',
  'src/components/Reports.tsx',
  'src/components/SeoAudit.tsx',
  'src/components/SecurityAudit.tsx',
  'src/components/WebsiteAnalyzer.tsx',
  'src/components/audit/LiveAuditProgress.tsx',
  'src/components/audit/FindingWorkspace.tsx',
  'src/components/audit/AuditHistoryPage.tsx',
];
const content = await Promise.all(customerFiles.map((path) => readFile(path, 'utf8'))).then((files) => files.join('\n'));

assert.doesNotMatch(content, /C:\\Users\\|\/Users\/|\/home\//i);
assert.doesNotMatch(content, /Render worker|Supabase table|Vercel function|Oracle server|internal worker ID|check registry version|database migration/i);
assert.doesNotMatch(content, /['"`](?:This component|next backend pass|current database schema|placeholder feature|mock data|TODO|FIXME)\b/i);
assert.doesNotMatch(content, /FUNCTION_INVOCATION_FAILED|relation .* does not exist|SUPABASE_SERVICE_ROLE_KEY/i);

const publicVersion = await readFile('src/lib/platform/version.ts', 'utf8');
assert.doesNotMatch(publicVersion, /process\.env\.(?:SUPABASE_SERVICE_ROLE_KEY|GEMINI_API_KEY)/);

console.log('No-public-development-artifacts smoke test passed.');
