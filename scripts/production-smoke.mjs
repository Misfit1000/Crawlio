import { randomUUID } from 'node:crypto';

const appUrl = new URL(process.env.APP_URL || 'https://keywordsintel.vercel.app').origin;
const workerUrl = new URL(process.env.WORKER_URL || 'https://seointel-audit-worker.onrender.com').origin;

async function json(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${url} returned non-JSON HTTP ${response.status}.`); }
  if (!response.ok) throw new Error(`${url} failed with HTTP ${response.status}: ${body?.error?.code || body?.error?.message || body?.error || 'unknown'}`);
  return body;
}

const version = await json(`${appUrl}/api/version`);
for (const key of ['applicationVersion', 'commitIdentifier', 'buildTimestamp', 'apiSchemaVersion', 'auditEngineVersion', 'scoringVersion']) {
  if (!(key in version)) throw new Error(`Version response is missing ${key}.`);
}
const health = await json(`${workerUrl}/health`);
if (!('serviceStatus' in health) || !('queuePollingStatus' in health)) throw new Error('Worker health response is incomplete.');
if (!health.commitIdentifier) throw new Error('Worker health response is missing its deployment commit.');
if (!String(version.commitIdentifier).startsWith(String(health.commitIdentifier)) && !String(health.commitIdentifier).startsWith(String(version.commitIdentifier))) {
  throw new Error(`Vercel and worker commit identifiers do not match: ${version.commitIdentifier} / ${health.commitIdentifier}.`);
}

const result = { version, worker: { serviceStatus: health.serviceStatus, queuePollingStatus: health.queuePollingStatus, commitIdentifier: health.commitIdentifier } };
if (process.env.RUN_AUDIT_SMOKE === 'true') {
  const guestId = `production-smoke-${randomUUID()}`;
  const start = await json(`${appUrl}/api/tools/audit/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Crawlio-Guest-Id': guestId },
    body: JSON.stringify({ url: new URL(appUrl).hostname, mode: 'quick' }),
  });
  const auditId = start?.data?.auditId;
  if (!auditId) throw new Error('Audit start did not return an audit ID.');
  let terminal = null;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const status = await json(`${appUrl}/api/tools/audit/status/${encodeURIComponent(auditId)}`, { headers: { 'X-Crawlio-Guest-Id': guestId } });
    const value = status?.data?.audit?.status;
    if (['completed', 'completed_with_warnings', 'failed', 'cancelled', 'abandoned'].includes(value)) { terminal = value; break; }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  if (!terminal) throw new Error('Production smoke audit did not reach a terminal state.');
  result.audit = { auditId, terminal };
}

console.log(JSON.stringify(result));
