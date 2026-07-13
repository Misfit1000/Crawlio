import { build } from 'esbuild';

await build({
  entryPoints: ['src/api/vercel-handler.ts'],
  outfile: 'api/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['pdfkit', 'sharp'],
  banner: {
    js: `// Vercel API bundle. Rebuild with npm run build:vercel-api; PDFKit stays lazy-loaded.
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);`,
  },
  logLevel: 'info',
});
