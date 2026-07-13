import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = await Promise.all([
  'src/components/LandingPage.tsx',
  'src/components/Sidebar.tsx',
  'src/components/audit/LiveAuditProgress.tsx',
  'src/components/audit/FindingWorkspace.tsx',
  'src/lib/audit/client-insights.ts',
].map((path) => readFile(path, 'utf8')));
const copy = files.join('\n');

assert.doesNotMatch(copy, /Audit my website|Submit website|Run it|Let's go|Proceed|Unlock results/i);
assert.doesNotMatch(copy, /run(?:s|ning)? penetration tests?|collect(?:s|ing)? Core Web Vitals/i);
assert.match(copy, /affected pages/i);
assert.match(copy, /Completed with warnings|completed_with_warnings/);
assert.match(copy, /Passive security/i);
assert.match(copy, /metadata previews?[^\n]*not screenshots/i);
assert.match(copy, /Passive security observations are not penetration testing/i);
assert.match(copy, /Start audit/);

console.log('Copy consistency smoke test passed.');
