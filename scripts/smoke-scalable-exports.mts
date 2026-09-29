import assert from 'node:assert/strict';
import {
  exportDisposition, exportJsonHeader, exportManifest, exportPartPath, formatExportChunk,
  type ExportJob, type ExportSection,
} from '../src/lib/report/scalable-exports';
import { processExportChunk, type ExportChunkDependencies } from '../src/workers/scalable-export-worker';
import { waitForAuditExport } from '../src/lib/http/download';
import type { ResourceAuditDocument } from '../src/lib/audit/resource-types';

const prefix = 'd6c53cd0-24bc-48a1-9521-5ba82cbb5706';
const initial: ExportJob = {
  id: 'test-job', audit_id: 'test-audit', format: 'json', state: 'running', owner: 'test-owner',
  lease_until: new Date(Date.now() + 120_000).toISOString(), cursor: null, section: 'pages', part: 0,
  object_prefix: prefix, error: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400_000).toISOString(),
};
const audit = {
  id: initial.audit_id, hostname: 'example.com', status: 'completed', pagesCrawled: 137,
  guestKeyHash: 'SECRET', lockedBy: 'SECRET', checkpointState: { token: 'SECRET' },
} as unknown as ResourceAuditDocument;
const header = exportJsonHeader(audit);
const pages = Array.from({ length: 137 }, (_, index) => ({
  id: `p${String(index).padStart(4, '0')}`, url: `https://example.com/${index}`, statusCode: 200,
  title: index === 0 ? '=HYPERLINK("bad")\n,quoted' : `Page ${index}`,
  wordCount: index, secret: 'SECRET', metadata: { token: 'SECRET' },
}));
const issues = Array.from({ length: 153 }, (_, index) => ({
  id: `i${String(index).padStart(4, '0')}`, title: `Issue ${index}`, severity: 'high',
  affectedUrl: pages[index % pages.length].url, evidence: 'a,"b"\nline', secret: 'SECRET',
}));
const events = [{ id: 'e1', message: 'Finished', data: { secret: 'SECRET' } }];

function paginate(items: { id: string }[], cursor: string | null) {
  const start = cursor ? items.findIndex(item => item.id === cursor) + 1 : 0;
  const batch = items.slice(start, start + 50);
  return { items: batch, nextCursor: start + 50 < items.length ? batch.at(-1)!.id : null };
}

function render(format: ExportJob['format'], data: Record<Exclude<ExportSection, 'done'>, { id: string }[]>) {
  let job = { ...initial, format, section: format === 'issues.csv' ? 'issues' as const : 'pages' as const } as ExportJob;
  const parts: string[] = [];
  for (let attempts = 0; attempts < 100; attempts++) {
    const batch = paginate(data[job.section as Exclude<ExportSection, 'done'>], job.cursor);
    const chunk = formatExportChunk(job, batch, job.part === 0 ? header : '');
    assert.deepEqual(chunk, formatExportChunk(job, batch, job.part === 0 ? header : ''), 'retry must be deterministic');
    parts.push(chunk.text);
    job = { ...job, cursor: chunk.cursor, section: chunk.section, part: chunk.part, state: chunk.ready ? 'ready' : 'running' };
    if (chunk.ready) return { text: parts.join(''), parts, job };
  }
  throw new Error('Export did not terminate');
}

const json = render('json', { pages, issues, events });
const parsed = JSON.parse(json.text);
assert.equal(parsed.success, true);
assert.deepEqual(parsed.data.pages.map((page: { id: string }) => page.id), pages.map(page => page.id));
assert.deepEqual(parsed.data.issues.map((issue: { id: string }) => issue.id), issues.map(issue => issue.id));
assert.equal(parsed.data.events.length, 1);
assert.ok(!json.text.includes('SECRET'));
assert.equal(json.parts.length, 8);
assert.equal(exportManifest(json.job).parts, 8);
assert.deepEqual(JSON.parse(render('json', { pages: [], issues: [], events: [] }).text).data.pages, []);
assert.equal(JSON.parse(render('json', { pages: pages.slice(0, 100), issues: [], events: [] }).text).data.pages.length, 100);

// Parse quoted, multiline CSV to count records rather than counting newline characters.
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(cell); cell = '';
      if (char === '\n') { rows.push(row); row = []; }
    } else cell += char;
  }
  assert.equal(quoted, false);
  return rows;
}
const pageCsv = parseCsv(render('pages.csv', { pages, issues, events }).text);
assert.equal(pageCsv.length, 138);
assert.equal(pageCsv[1][4], `'${pages[0].title}`);
const issueCsv = parseCsv(render('issues.csv', { pages, issues, events }).text);
assert.equal(issueCsv.length, 154);
assert.equal(issueCsv[1][4], issues[0].evidence);
assert.equal(parseCsv(render('pages.csv', { pages: [], issues: [], events: [] }).text).length, 1);
assert.equal(exportPartPath(prefix, 12), `${prefix}/0000000012`);
assert.throws(() => exportPartPath('../escape', 1));
assert.throws(() => exportPartPath(prefix, -1));
assert.throws(() => exportManifest(initial));
assert.ok(!exportDisposition('evil"\r\nX-Test: injected', 'json').includes('\r'));
assert.equal(exportDisposition('evil";name', 'json').split('"').length, 3);
assert.throws(() => formatExportChunk(initial, { items: pages, nextCursor: null }));
assert.throws(() => formatExportChunk({ ...initial, cursor: 'p1' }, { items: [pages[0]], nextCursor: 'p1' }));

const objects = new Map<string, string>();
let committed: ExportJob = { ...initial };
let failCommit = true, reads = 0, checks = 0;
const dependencies: ExportChunkDependencies = {
  header: async () => header,
  read: async job => { reads++; return paginate(pages, job.cursor); },
  check: async job => { checks++; assert.equal(job.owner, committed.owner); },
  upload: async (job, text) => {
    const path = exportPartPath(job.object_prefix, job.part);
    if (objects.has(path)) assert.equal(objects.get(path), text);
    else objects.set(path, text);
  },
  commit: async (job, chunk) => {
    if (failCommit) throw new Error('simulated crash after upload');
    assert.equal(job.part, committed.part);
    committed = { ...committed, part: chunk.part, section: chunk.section, cursor: chunk.cursor };
  },
};
await assert.rejects(processExportChunk(initial, dependencies), /simulated crash/);
assert.equal(committed.part, 0);
assert.equal(objects.size, 1);
failCommit = false;
await processExportChunk(initial, dependencies);
assert.equal(committed.part, 1);
assert.equal(objects.size, 1, 'retry must reuse the same part');
await processExportChunk(committed, dependencies);
assert.equal(committed.part, 2);
assert.equal(objects.size, 2);
assert.equal(reads, 3, 'one evidence read per invocation');
assert.equal(checks, 6, 'check ownership before read and before upload');
await assert.rejects(processExportChunk({ ...committed, owner: 'stale-owner' }, dependencies));
assert.equal(objects.size, 2);

let requests = 0, sleeps = 0;
const pending = () => new Response(JSON.stringify({ data: { state: 'queued' } }), { status: 202, headers: { 'retry-after': '2' } });
const ready = new Response('ready', { status: 200 });
assert.equal(await waitForAuditExport(async () => ++requests < 3 ? pending() : ready, {
  sleep: async ms => { assert.equal(ms, 2000); sleeps++; },
}), ready);
assert.equal(requests, 3);
assert.equal(sleeps, 2);
requests = 0;
await assert.rejects(waitForAuditExport(async () => { requests++; return pending(); }, { maxAttempts: 2, sleep: async () => {} }), /still being prepared/);
assert.equal(requests, 2);
await assert.rejects(waitForAuditExport(async () => pending(), { isActive: () => false }), /paused/);
await assert.rejects(waitForAuditExport(async () => new Response('{"data":{"state":"failed"}}', { status: 202 })), /not available/);
const controller = new AbortController(); controller.abort();
await assert.rejects(waitForAuditExport(async () => pending(), { signal: controller.signal }));
const denied = new Response('denied', { status: 403 });
assert.equal(await waitForAuditExport(async () => denied), denied, 'authorization failures must not poll');
console.log('Scalable export formatting, resume, safety, and polling tests passed.');
