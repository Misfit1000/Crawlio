import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const removed = [
  'src/components/CommandPalette.tsx',
  'src/components/KeywordResearch.tsx',
  'src/components/KeywordClusters.tsx',
  'src/components/CompetitorGap.tsx',
  'src/components/ContentBriefs.tsx',
  'src/components/PublicDiscovery.tsx',
];
for (const path of removed) {
  await assert.rejects(access(path), undefined, `${path} should remain removed from the public product`);
}

const routes = await readFile('src/app/routes.ts', 'utf8');
const landing = await readFile('src/components/LandingPage.tsx', 'utf8');
const shell = await readFile('src/components/layout/ProductShells.tsx', 'utf8');
assert.doesNotMatch(routes, /app\/(?:keywords|keyword-clusters|competitors|content-briefs|discovery)/);
assert.doesNotMatch(landing, /Coming soon|Roadmap|Import-ready|Import-only|Provider-ready/i);
assert.doesNotMatch(shell, /#free-tools|Free Tools/);
assert.doesNotMatch(landing, /placeholder feature|mock data|TODO|FIXME/i);

console.log('No-placeholder UI smoke test passed.');
