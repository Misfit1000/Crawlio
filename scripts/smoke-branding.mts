import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.startsWith('dist/') && !file.startsWith('node_modules/') && file !== 'api/index.js');

const forbidden = /SEOIntel|SEO Intel|seo-intel|seointel|KeywordsIntel|Keywords Intel|keywordsintel|KeywordsPlanner|Keywords Planner|keywords-planner/i;

function isAllowedLegacyReference(file: string, line: string) {
  if (file === 'scripts/smoke-branding.mts') return true;
  if (file.startsWith('supabase/migrations/')) return true;
  if (file === 'README.md' && /Old brand: SEOIntel|keywordsintel\.vercel\.app/i.test(line)) return true;
  if (/keywordsintel\.vercel\.app|https:\/\/seointel-audit-worker\.onrender\.com/i.test(line)) return true;
  if (file === 'render.yaml' && /seointel-audit-worker/i.test(line)) return true;
  if (/SEOINTEL_ALLOW_PRIVATE_TEST_TARGETS|SEOINTEL_E2E_TSX_LOADED/.test(line)) return true;
  if (/X-SEOIntel-Guest-Id|x-seointel-guest-id|seointel_guest_id/i.test(line)) return true;
  if (/LEGACY_(THEME|SETTINGS|HISTORY|CHECKLIST|FINDING_NOTES|ACTIVITY_LAYOUT)_/.test(line)) return true;
  if (/seointel_selected_report_id/.test(line)) return true;
  if (/seointelbot/i.test(line)) return true;
  if (file === 'docs/product/rebrand-compatibility.md') return true;
  return false;
}

const violations: string[] = [];
for (const file of files) {
  let source = '';
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  source.split(/\r?\n/).forEach((line, index) => {
    if (forbidden.test(line) && !isAllowedLegacyReference(file, line)) {
      violations.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  });
}

assert.deepEqual(violations, [], `Unexpected legacy branding:\n${violations.join('\n')}`);

const requiredBrandFiles = [
  'README.md',
  'index.html',
  'metadata.json',
  'public/404.html',
  'public/favicon.svg',
  'public/site.webmanifest',
  'src/lib/brand.ts',
];

for (const file of requiredBrandFiles) {
  assert.match(readFileSync(file, 'utf8'), /Crawlio/, `${file} must identify Crawlio.`);
}

for (const file of ['src/components/ui/visual-system.tsx', 'src/lib/report/pdf.ts', 'src/lib/blog/sitemap.ts']) {
  assert.match(readFileSync(file, 'utf8'), /\bBRAND\b/, `${file} must use the canonical brand configuration.`);
}

const apiSource = readFileSync('src/api/index.ts', 'utf8');
assert.match(apiSource, /x-crawlio-guest-id/, 'The API must accept the Crawlio guest header.');
assert.match(apiSource, /x-seointel-guest-id/, 'The API must retain the documented legacy guest-header fallback.');
assert.match(apiSource, /crawlio-\$\{safeHost\}-audit\.pdf/, 'PDF download filenames must use Crawlio.');

console.log(`Crawlio branding smoke test passed across ${files.length} repository files.`);
