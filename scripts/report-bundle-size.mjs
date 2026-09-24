import { readFileSync } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

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
const initialAssetNames = [...indexHtml.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((match) => match[1]);
const initialJavaScriptGzipBytes = initialAssetNames.reduce(
  (total, name) => total + gzipSync(readFileSync(path.join(assetsDir, name))).byteLength,
  0,
);
const budgets = { largestJavaScriptBytes: 750_000, totalJavaScriptBytes: 2_000_000, totalCssBytes: 112_000, initialJavaScriptGzipBytes: 120_000 };
const largestJavaScript = entries.find((entry) => entry.type === 'js')?.bytes || 0;
const failures = [];
if (largestJavaScript > budgets.largestJavaScriptBytes) failures.push(`Largest JavaScript chunk is ${largestJavaScript} bytes.`);
if ((totals.js || 0) > budgets.totalJavaScriptBytes) failures.push(`Total JavaScript is ${totals.js} bytes.`);
if ((totals.css || 0) > budgets.totalCssBytes) failures.push(`Total CSS is ${totals.css} bytes.`);
if (initialJavaScriptGzipBytes > budgets.initialJavaScriptGzipBytes) failures.push(`Initial JavaScript gzip size is ${initialJavaScriptGzipBytes} bytes.`);
const report = { generatedAt: new Date().toISOString(), budgets, totals, largestJavaScript, initialJavaScriptGzipBytes, initialAssetNames, files: entries, passed: failures.length === 0, failures };
await writeFile(path.resolve('dist/bundle-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, totals, largestJavaScript, initialJavaScriptGzipBytes, files: entries.length }));
if (failures.length) {
  failures.forEach((failure) => console.error(failure));
  process.exitCode = 1;
}
