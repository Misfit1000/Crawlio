import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planAuditLiveDelta } from '../src/lib/audit/live-delta.ts';
import type { ResourceAuditDocument } from '../src/lib/audit/resource-types.ts';
import { shouldWritePeriodicHeartbeat, WORKER_HEARTBEAT_INTERVAL_MS } from '../src/workers/audit-worker-runtime.ts';

const audit = {
  id: 'audit-1', status: 'running', updatedAt: '2026-09-24T00:00:00.000Z', pagesCrawled: 10, issuesFound: 4,
} as ResourceAuditDocument;
assert.deepEqual(planAuditLiveDelta(audit, { status: 'running', updatedAt: audit.updatedAt, pagesCrawled: 10, issuesFound: 4 }), {
  auditChanged: false, pagesChanged: false, issuesChanged: false, eventsNeeded: false, reportNeeded: false,
});
assert.equal(planAuditLiveDelta({ ...audit, pagesCrawled: 11 }, { status: 'running', updatedAt: audit.updatedAt, pagesCrawled: 10, issuesFound: 4 }).pagesChanged, true);
assert.equal(planAuditLiveDelta({ ...audit, status: 'completed' }, { status: 'running', updatedAt: audit.updatedAt, pagesCrawled: 10, issuesFound: 4 }).reportNeeded, true);
assert.equal(planAuditLiveDelta({ ...audit, status: 'completed' }, { status: 'completed', updatedAt: audit.updatedAt, pagesCrawled: 10, issuesFound: 4, hasReport: true }).reportNeeded, false);

assert.equal(shouldWritePeriodicHeartbeat(0, WORKER_HEARTBEAT_INTERVAL_MS - 1), false);
assert.equal(shouldWritePeriodicHeartbeat(0, WORKER_HEARTBEAT_INTERVAL_MS), true);

const [monitoring, runtime, landing, auth, liveClient, liveProgress, api, vercelHandler, buildScript] = await Promise.all([
  readFile('src/lib/monitoring/sentry-browser.ts', 'utf8'),
  readFile('src/lib/monitoring/sentry-browser-runtime.ts', 'utf8'),
  readFile('src/components/LandingPage.tsx', 'utf8'),
  readFile('src/contexts/AuthContext.tsx', 'utf8'),
  readFile('src/lib/audit/live-supabase-client.ts', 'utf8'),
  readFile('src/components/audit/LiveAuditProgress.tsx', 'utf8'),
  readFile('src/api/index.ts', 'utf8'),
  readFile('src/api/vercel-handler.ts', 'utf8'),
  readFile('scripts/build-vercel-api.mjs', 'utf8'),
]);
assert.doesNotMatch(monitoring, /from ['"]@sentry\/react['"]/);
assert.match(runtime, /from ['"]@sentry\/react['"]/);
assert.match(monitoring, /MAX_PENDING_OPERATIONS = 20/);
assert.match(landing, /IntersectionObserver/);
assert.match(auth, /shouldHydrateAuthOnLoad/);
assert.match(auth, /key\.startsWith\('sb-'\).*key\.includes\('-auth-token'\)/);
assert.match(auth, /if \(!profile\)/);
assert.doesNotMatch(liveClient, /Math\.max\(15000, AUDIT_LIMITS\.livePollIntervalMs\)/);
assert.match(liveClient, /!cancelled && !document\.hidden/);
assert.match(liveProgress, /visibilitychange/);
assert.match(api, /Cache-Control', 'public, max-age=30, s-maxage=60, must-revalidate'/);
assert.match(vercelHandler, /function lazyApiRouter/);
assert.doesNotMatch(vercelHandler, /const \{ apiRouter \} = await import\('\.\/index'\)/);
assert.match(buildScript, /splitting: true/);

console.log('Performance optimization smoke test passed.');
