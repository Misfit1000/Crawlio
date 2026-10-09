import { readFileSync } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

const assetsDir = path.resolve('dist/assets');
const entries = [];
for (const name of await readdir(assetsDir)) {
  const file = path.join(assetsDir, name);
  const info = await stat(file);
  if (info.isFile() && /\.(js|css)$/.test(name)) entries.push({ name, bytes: info.size, type: path.extname(name).slice(1) });
}
entries.sort((left, right) => right.bytes - left.bytes);
const totals = entries.reduce((value, entry) => ({ ...value, [entry.type]: (value[entry.type] || 0) + entry.bytes }), {});
const indexHtml = await readFile(path.resolve('dist/index.html'), 'utf8');
const entryAssetNames = [...indexHtml.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((match) => match[1]);
const initialAssets = new Set();
function visit(name) {
  if (initialAssets.has(name)) return;
  initialAssets.add(name);
  const source = ts.createSourceFile(name, readFileSync(path.join(assetsDir, name), 'utf8'), ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  for (const statement of source.statements) {
    if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const imported = statement.moduleSpecifier.text;
    if (imported.startsWith('.') && imported.endsWith('.js')) visit(path.posix.normalize(path.posix.join(path.posix.dirname(name), imported)));
  }
}
entryAssetNames.forEach(visit);
const initialAssetNames = [...initialAssets];
const initialJavaScriptGzipBytes = initialAssetNames.reduce(
  (total, name) => total + gzipSync(readFileSync(path.join(assetsDir, name))).byteLength,
  0,
);
const initialCssBytes = [...indexHtml.matchAll(/href="\/assets\/([^\"]+\.css)"/g)].reduce((total,match)=>total+readFileSync(path.join(assetsDir,match[1])).byteLength,0);
const sentryInstrumented = initialAssetNames.some(name => readFileSync(path.join(assetsDir, name), 'utf8').includes('_sentryDebugIds'));
// e424e09 production includes Sentry debug-ID injection; local builds do not.
// Compare actual transferred bytes against the matching measured baseline.
const budgets = { largestJavaScriptBytes: 750_000, totalJavaScriptBytes: 2_000_000, totalCssBytes: 115_000, initialCssBytes: 111_659, initialJavaScriptGzipBytes: sentryInstrumented ? 91_807 : 90_220 };
const largestJavaScript = entries.find((entry) => entry.type === 'js')?.bytes || 0;
const failures = [];
if (largestJavaScript > budgets.largestJavaScriptBytes) failures.push(`Largest JavaScript chunk is ${largestJavaScript} bytes.`);
if ((totals.js || 0) > budgets.totalJavaScriptBytes) failures.push(`Total JavaScript is ${totals.js} bytes.`);
if ((totals.css || 0) > budgets.totalCssBytes) failures.push(`Total CSS is ${totals.css} bytes.`);
if (initialCssBytes > budgets.initialCssBytes) failures.push(`Initial CSS is ${initialCssBytes} bytes.`);
if (initialJavaScriptGzipBytes > budgets.initialJavaScriptGzipBytes) failures.push(`Initial JavaScript gzip size is ${initialJavaScriptGzipBytes} bytes.`);
const report = { generatedAt: new Date().toISOString(), sentryInstrumented, budgets, totals, largestJavaScript, initialJavaScriptGzipBytes, initialCssBytes, initialAssetNames, entryAssetNames, files: entries, passed: failures.length === 0, failures };
await writeFile(path.resolve('dist/bundle-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, totals, largestJavaScript, initialJavaScriptGzipBytes, files: entries.length }));
if (failures.length) {
  failures.forEach((failure) => console.error(failure));
  process.exitCode = 1;
}
