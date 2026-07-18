import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(target));
    else output.push(target);
  }
  return output;
}

const distFiles = await filesUnder('dist');
const files = distFiles.filter((file) => file.startsWith(path.join('dist', 'assets')));
const sourceMaps = distFiles.filter((file) => file.endsWith('.map'));
if (sourceMaps.length) {
  throw new Error(`Public browser source maps remain in dist: ${sourceMaps.join(', ')}`);
}

const content = (await Promise.all(
  files
    .filter((file) => /\.(?:js|css|html)$/.test(file))
    .map((file) => readFile(file, 'utf8')),
)).join('\n');

const forbiddenNames = [
  'SENTRY_AUTH_TOKEN',
  'SUPABASE_SERVICE_ROLE_KEY',
  'BLOG_DISPATCH_SECRET',
  'CRON_SECRET',
  'RATE_LIMIT_HASH_SECRET',
  'GROQ_API_KEY',
];
for (const name of forbiddenNames) {
  if (content.includes(name)) throw new Error(`Browser assets contain server-only environment name: ${name}`);
}
if (/(^|[^A-Z0-9_])SENTRY_DSN([^A-Z0-9_]|$)/.test(content)) {
  throw new Error('Browser assets contain the server-only SENTRY_DSN environment name.');
}

const secretValues = [
  process.env.SENTRY_AUTH_TOKEN,
  process.env.SENTRY_DSN,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  process.env.BLOG_DISPATCH_SECRET,
  process.env.CRON_SECRET,
  process.env.RATE_LIMIT_HASH_SECRET,
  process.env.GROQ_API_KEY,
].filter((value) => value && value.length >= 8);
for (const secret of secretValues) {
  if (content.includes(secret)) throw new Error('Browser assets contain a configured server-only secret value.');
}

console.log(`Sentry browser asset verification passed (${files.length} assets, no public source maps or server secrets).`);
