import { randomUUID } from 'node:crypto';

const config = {
  appUrl: originFrom('PRODUCTION_APP_URL', process.env.APP_URL),
  workerHealthUrl: absoluteUrlFrom('PRODUCTION_WORKER_HEALTH_URL', process.env.WORKER_URL, '/health'),
  expectedCommit: String(process.env.EXPECTED_COMMIT_IDENTIFIER || '').trim(),
  expectedSchema: optionalInteger(process.env.EXPECTED_API_SCHEMA_VERSION),
  runAudit: process.env.PRODUCTION_SMOKE_ENABLED === 'true' || process.env.RUN_AUDIT_SMOKE === 'true',
  auditTarget: String(process.env.PRODUCTION_SMOKE_TARGET_URL || '').trim(),
  timeoutMs: boundedInteger(process.env.PRODUCTION_SMOKE_TIMEOUT_MS, 120_000, 30_000, 300_000),
};

const startedAt = Date.now();
const checks = [];
const warnings = [];
let version = null;
let health = null;
let guestAudit = null;

function originFrom(name, fallback) {
  const raw = String(process.env[name] || fallback || '').trim();
  if (!raw) throw new Error(`${name} is required.`);
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${name} must use HTTP or HTTPS.`);
  return url.origin;
}

function absoluteUrlFrom(name, fallback, defaultPath) {
  const raw = String(process.env[name] || fallback || '').trim();
  if (!raw) throw new Error(`${name} is required.`);
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${name} must use HTTP or HTTPS.`);
  if (url.pathname === '/') url.pathname = defaultPath;
  return url.toString();
}

function optionalInteger(value) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('EXPECTED_API_SCHEMA_VERSION must be a positive integer.');
  return parsed;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function isTransient(error, status) {
  return Boolean(error) || [408, 425, 429, 500, 502, 503, 504].includes(status);
}

async function request(url, init = {}, options = {}) {
  const attempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 10_000;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      const text = await response.text();
      if (isTransient(null, response.status) && attempt < attempts) {
        await delay(500 * attempt);
        continue;
      }
      return { response, text };
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === attempts) break;
      await delay(500 * attempt);
    }
  }
  throw new Error(`Request failed after ${attempts} attempt(s): ${lastError instanceof Error ? lastError.message : 'network error'}`);
}

function parseJson(url, response, text) {
  if (!String(response.headers.get('content-type') || '').includes('application/json')) {
    throw new Error(`${url} returned ${response.status} ${response.headers.get('content-type') || 'without content type'} instead of JSON.`);
  }
  try { return JSON.parse(text); } catch { throw new Error(`${url} returned invalid JSON.`); }
}

function dataOf(payload) {
  return payload?.success === true && payload?.data ? payload.data : payload;
}

function assertNoPlatformError(url, text) {
  if (/FUNCTION_INVOCATION_FAILED|A server error has occurred|VERCEL_[A-Z_]+|<title>Internal Server Error/i.test(text)) {
    throw new Error(`${url} returned a platform error page.`);
  }
}

async function expectJson(url, init = {}, allowedStatuses = [200]) {
  const { response, text } = await request(url, init);
  assertNoPlatformError(url, text);
  const payload = parseJson(url, response, text);
  if (!allowedStatuses.includes(response.status)) throw new Error(`${url} returned HTTP ${response.status}.`);
  return { response, payload: dataOf(payload), rawPayload: payload };
}

async function check(name, fn, severity = 'failure') {
  const checkStarted = Date.now();
  try {
    const detail = await fn();
    checks.push({ name, status: 'passed', durationMs: Date.now() - checkStarted, detail });
    return detail;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name, status: severity === 'warning' ? 'warning' : 'failed', durationMs: Date.now() - checkStarted, message });
    if (severity === 'warning') warnings.push(message);
    return null;
  }
}

function commitsMatch(left, right) {
  if (!left || !right || left === 'local' || right === 'local') return true;
  return String(left).startsWith(String(right)) || String(right).startsWith(String(left));
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function runPublicChecks() {
  await check('public.homepage', async () => {
    const url = `${config.appUrl}/`;
    const { response, text } = await request(url);
    if (response.status !== 200) throw new Error(`Homepage returned HTTP ${response.status}.`);
    assertNoPlatformError(url, text);
    if (!/Crawlio/i.test(text)) throw new Error('Homepage does not contain the Crawlio product identity.');
    return { status: response.status, product: 'Crawlio' };
  });
  await check('public.blog', async () => {
    const url = `${config.appUrl}/blog`;
    const { response, text } = await request(url);
    if (response.status !== 200) throw new Error(`Blog returned HTTP ${response.status}.`);
    assertNoPlatformError(url, text);
    return { status: response.status };
  });
  await check('public.sitemap', async () => {
    const url = `${config.appUrl}/sitemap.xml`;
    const { response, text } = await request(url);
    if (response.status !== 200 || !/<urlset[\s>]/i.test(text) || !/<loc>https?:\/\//i.test(text)) throw new Error('Sitemap is not a valid URL set.');
    assertNoPlatformError(url, text);
    return { status: response.status, contentType: response.headers.get('content-type') };
  });
  await check('public.robots', async () => {
    const url = `${config.appUrl}/robots.txt`;
    const { response, text } = await request(url);
    if (response.status !== 200 || !/^User-agent:/im.test(text)) throw new Error('Robots file is missing or invalid.');
    const expectedSitemap = `${config.appUrl}/sitemap.xml`;
    if (!text.includes(expectedSitemap)) throw new Error(`Robots file does not reference ${expectedSitemap}.`);
    return { status: response.status, sitemap: expectedSitemap };
  });
}

async function runVersionChecks() {
  version = await check('version.application', async () => {
    const { payload } = await expectJson(`${config.appUrl}/api/version`);
    for (const key of ['applicationVersion', 'commitIdentifier', 'apiSchemaVersion', 'auditEngineVersion', 'scoringVersion', 'checkRegistryVersion']) {
      if (payload?.[key] == null || payload[key] === '') throw new Error(`Version response is missing ${key}.`);
    }
    if (config.expectedCommit && !commitsMatch(payload.commitIdentifier, config.expectedCommit)) throw new Error(`Application commit ${payload.commitIdentifier} does not match expected release ${config.expectedCommit}.`);
    if (config.expectedSchema != null && Number(payload.apiSchemaVersion) !== config.expectedSchema) throw new Error(`API schema ${payload.apiSchemaVersion} does not match expected ${config.expectedSchema}.`);
    if (payload.blogAutomationEnabled !== false || payload.blogProviderEnabled !== false) throw new Error('Blog automation/provider must remain disabled for this release gate.');
    return payload;
  });
}

async function runWorkerChecks() {
  health = await check('worker.health', async () => {
    const { payload } = await expectJson(config.workerHealthUrl);
    if (payload.ok !== true || !['online', 'healthy'].includes(String(payload.serviceStatus))) throw new Error('Audit engine is not online.');
    if (payload.databaseConnected !== true) throw new Error('Audit engine database connectivity is unavailable.');
    if (!payload.commitIdentifier) throw new Error('Audit engine commit identifier is missing.');
    if (version && !commitsMatch(version.commitIdentifier, payload.commitIdentifier)) throw new Error(`Application and audit-engine commits differ: ${version.commitIdentifier} / ${payload.commitIdentifier}.`);
    for (const [workerKey, appKey] of [['auditEngineVersion', 'auditEngineVersion'], ['scoringVersion', 'scoringVersion'], ['checkRegistryVersion', 'checkRegistryVersion']]) {
      if (version && String(payload[workerKey] || '') !== String(version[appKey] || '')) throw new Error(`${workerKey} is incompatible.`);
    }
    const serialized = JSON.stringify(payload);
    if (/service[_-]?role|private[_-]?key|authorization|database[_-]?url|connection[_-]?string/i.test(serialized)) throw new Error('Audit-engine health contains a secret-like field name.');
    return {
      serviceStatus: payload.serviceStatus,
      queuePollingStatus: payload.queuePollingStatus,
      databaseConnected: payload.databaseConnected,
      commitIdentifier: payload.commitIdentifier,
      auditEngineVersion: payload.auditEngineVersion,
      scoringVersion: payload.scoringVersion,
      checkRegistryVersion: payload.checkRegistryVersion,
      deepAuditEnabled: payload.deepAuditEnabled === true,
    };
  });
}

async function runSecurityChecks() {
  await check('security.admin-provider-diagnostics', async () => {
    const result = await expectJson(`${config.appUrl}/api/tools/admin/blog/provider/diagnostics`, {}, [401]);
    return { status: result.response.status, providerInvoked: false };
  });
  await check('security.protected-report', async () => {
    const id = randomUUID();
    const result = await expectJson(`${config.appUrl}/api/tools/audit/result/${id}`, {}, [401, 403, 404]);
    return { status: result.response.status };
  });
  await check('security.protected-export', async () => {
    const id = randomUUID();
    const result = await expectJson(`${config.appUrl}/api/tools/audit/export/${id}/json`, {}, [401, 403, 404]);
    return { status: result.response.status };
  });
}

async function runGuestAudit() {
  if (!config.runAudit) {
    checks.push({ name: 'guest-audit', status: 'skipped', detail: 'Set PRODUCTION_SMOKE_ENABLED=true and PRODUCTION_SMOKE_TARGET_URL to run one Quick Audit.' });
    return;
  }
  if (!config.auditTarget) {
    checks.push({ name: 'guest-audit', status: 'failed', message: 'PRODUCTION_SMOKE_TARGET_URL is required when production audit smoke is enabled.' });
    return;
  }
  const target = new URL(config.auditTarget);
  if (!['http:', 'https:'].includes(target.protocol)) {
    checks.push({ name: 'guest-audit', status: 'failed', message: 'PRODUCTION_SMOKE_TARGET_URL must use HTTP or HTTPS.' });
    return;
  }

  await check('guest-audit.quick', async () => {
    const guestId = `production-smoke-${randomUUID()}`;
    const headers = { 'Content-Type': 'application/json', 'X-Crawlio-Guest-Id': guestId };
    const startResult = await expectJson(`${config.appUrl}/api/tools/audit/start`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: target.toString(), mode: 'quick' }),
    }, [200, 202]);
    const auditId = startResult.payload?.data?.auditId || startResult.payload?.auditId;
    if (!auditId) throw new Error('Audit admission did not return an audit ID.');
    const admittedAt = Date.now();
    let terminalAudit = null;
    let workerClaimed = false;
    const terminalStatuses = new Set(['completed', 'completed_with_warnings', 'failed', 'cancelled', 'abandoned']);
    while (Date.now() - admittedAt < config.timeoutMs) {
      const statusResult = await expectJson(`${config.appUrl}/api/tools/audit/status/${encodeURIComponent(auditId)}`, { headers });
      const audit = statusResult.payload?.data?.audit || statusResult.payload?.audit || statusResult.payload?.data || statusResult.payload;
      workerClaimed ||= audit?.status === 'running' || Boolean(audit?.startedAt || audit?.started_at || audit?.workerRuntime || audit?.worker_runtime);
      if (terminalStatuses.has(audit?.status)) { terminalAudit = audit; break; }
      await delay(3_000);
    }
    if (!terminalAudit) throw new Error('Quick Audit did not reach a terminal state within the bounded timeout.');
    if (!workerClaimed) throw new Error('Quick Audit reached a terminal state without evidence that the audit engine claimed it.');
    if (!['completed', 'completed_with_warnings'].includes(terminalAudit.status)) throw new Error(`Quick Audit ended with ${terminalAudit.status}.`);
    if (/checking|crawling|scanning|running/i.test(String(terminalAudit.currentPhase || '')) || terminalAudit.currentCheck) throw new Error('Completed audit still reports active processing language.');

    const resultResponse = await expectJson(`${config.appUrl}/api/tools/audit/result/${encodeURIComponent(auditId)}`, { headers });
    const snapshot = resultResponse.payload?.data || resultResponse.payload;
    const finalAudit = snapshot.audit || terminalAudit;
    const overall = snapshot.finalReport?.scores?.overall;
    if (overall != null && (!Number.isFinite(Number(overall)) || Number(overall) < 0 || Number(overall) > 100)) throw new Error('Final score is outside the valid range.');
    if (overall == null && snapshot.finalReport?.scores?.scoreState !== 'unavailable') throw new Error('Completed report has neither a valid final score nor an explicit unavailable state.');
    const pagesAnalysed = Number(finalAudit.pagesCrawled || finalAudit.pages_crawled || snapshot.latestPages?.length || 0);
    const pageLimit = Number(finalAudit.pageLimit || finalAudit.page_limit || 0);
    if (pageLimit > 5 || pagesAnalysed > 5) throw new Error(`Quick Audit exceeded its five-page bound (${pagesAnalysed}/${pageLimit}).`);

    const cleanup = await request(`${config.appUrl}/api/tools/audit/${encodeURIComponent(auditId)}`, { method: 'DELETE', headers }, { attempts: 1 });
    if (![200, 204].includes(cleanup.response.status)) warnings.push(`Smoke audit ${auditId} completed but cleanup returned HTTP ${cleanup.response.status}.`);
    guestAudit = { status: finalAudit.status, durationMs: Date.now() - admittedAt, pagesAnalysed, pageLimit };
    return guestAudit;
  });
}

async function notifySmokeFailure(result) {
  if (process.env.OPERATIONS_ALERTS_ENABLED !== 'true') return;
  let url;
  try { url = new URL(String(process.env.OPERATIONS_ALERT_WEBHOOK_URL || '')); } catch { return; }
  if (url.protocol !== 'https:') return;
  const payload = {
    product: 'Crawlio',
    status: 'critical',
    source: 'production-smoke',
    applicationCommit: result.applicationCommit,
    failedChecks: result.checks.filter((item) => item.status === 'failed').map((item) => item.name),
    observedAt: new Date().toISOString(),
  };
  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
}

await runPublicChecks();
await runVersionChecks();
await runWorkerChecks();
await runSecurityChecks();
await runGuestAudit();

const failed = checks.filter((item) => item.status === 'failed');
const result = {
  status: failed.length ? 'failed' : 'passed',
  applicationCommit: version?.commitIdentifier || null,
  workerCommit: health?.commitIdentifier || null,
  apiSchemaVersion: version?.apiSchemaVersion || null,
  workerOnline: health?.serviceStatus === 'online' || health?.serviceStatus === 'healthy',
  guestAudit,
  durationMs: Date.now() - startedAt,
  checks,
  warnings,
};

console.error(`Crawlio production smoke: ${result.status.toUpperCase()} (${checks.length - failed.length}/${checks.length} checks without failure, ${result.durationMs}ms)`);
for (const item of checks) console.error(`- ${item.status.toUpperCase()}: ${item.name}${item.message ? ` - ${item.message}` : ''}`);
console.log(JSON.stringify(result));
if (failed.length) {
  await notifySmokeFailure(result);
  process.exitCode = 1;
}
