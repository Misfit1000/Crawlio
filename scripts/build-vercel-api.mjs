import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import path from 'node:path';

await rm('api/chunks', { recursive: true, force: true });
await rm('api-runtime', { recursive: true, force: true });

const result = await build({
  entryPoints: [{ in: 'src/api/vercel-handler.ts', out: 'api/index' }],
  outdir: '.',
  bundle: true,
  platform: 'node',
  format: 'esm',
  splitting: true,
  // Files below api/ are treated as separate Serverless Functions by Vercel.
  // Keep shared implementation chunks outside that directory so this remains
  // one function on the Hobby plan.
  chunkNames: 'api-runtime/[name]-[hash]',
  external: ['@sentry/node', 'pdfkit', 'sharp'],
  minifyWhitespace: true,
  banner: {
    js: `// Vercel API bundle. Rebuild with npm run build:vercel-api; PDFKit stays lazy-loaded.
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);`,
  },
  logLevel: 'info',
  metafile: true,
});

const outputs = result.metafile.outputs;
const entry = Object.keys(outputs).find((file) => file.replace(/\\/g, '/') === 'api/index.js');
if (!entry) throw new Error('Vercel API entry was not generated.');
const visited = new Set();
function visit(file) {
  const normalized = file.replace(/\\/g, '/');
  if (visited.has(normalized) || !outputs[normalized]) return;
  visited.add(normalized);
  for (const dependency of outputs[normalized].imports) {
    if (dependency.external || dependency.kind === 'dynamic-import') continue;
    const resolved = dependency.path.startsWith('.')
      ? path.posix.normalize(path.posix.join(path.posix.dirname(normalized), dependency.path))
      : dependency.path.replace(/\\/g, '/');
    visit(resolved);
  }
}
visit(entry);
const initialBytes = [...visited].reduce((total, file) => total + outputs[file].bytes, 0);
const maximumInitialBytes = 3_255_747;
console.log(JSON.stringify({ vercelApiEntryBytes: outputs[entry].bytes, initialStaticBytes: initialBytes, initialFiles: visited.size }));
if (initialBytes > maximumInitialBytes) throw new Error(`Vercel API initial static bundle is ${initialBytes} bytes; budget is ${maximumInitialBytes}.`);
