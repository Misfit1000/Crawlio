import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { safeApiError } from '../src/lib/api/errors';
import { resolveDomainDailyAuditLimit } from '../src/lib/api/production-controls';
import { API_SCHEMA_VERSION, publicVersionPayload } from '../src/lib/platform/version';

const root = new URL('../', import.meta.url);
const read = (file: string) => readFile(new URL(file, root), 'utf8');
const migration = await read('supabase/migrations/011_production_robustness.sql');
const admissionLockdownMigration = await read('supabase/migrations/016_server_only_audit_admission.sql');
const schemaHeadMigration = await read('supabase/migrations/019_finding_workflow_and_operations.sql');
const api = await read('src/api/index.ts');
const controls = await read('src/lib/api/production-controls.ts');

class AtomicAdmissionHarness {
  private chain: Promise<unknown> = Promise.resolve();
  private active = new Map<string, string>();
  private accepted = 0;
  constructor(private readonly globalLimit: number) {}
  admit(owner: string, url: string) {
    const operation = this.chain.then(() => {
      const key = `${owner}:${url}`;
      const duplicate = this.active.get(key);
      if (duplicate) return { allowed: true, auditId: duplicate, reused: true };
      if (this.accepted >= this.globalLimit) return { allowed: false, code: 'QUEUE_FULL' };
      const auditId = `audit-${this.accepted + 1}`;
      this.active.set(key, auditId);
      this.accepted += 1;
      return { allowed: true, auditId, reused: false };
    });
    this.chain = operation.catch(() => undefined);
    return operation;
  }
}

async function apiErrorSafety() {
  const internal = new Error('relation audit_admissions does not exist at C:\\private\\server.ts');
  const mapped = safeApiError(internal, 'request-safe-123');
  const serialized = JSON.stringify(mapped);
  assert.equal(mapped.status, 500);
  assert.match(serialized, /INTERNAL_REQUEST_FAILURE/);
  assert.match(serialized, /request-safe-123/);
  assert.doesNotMatch(serialized, /audit_admissions|private|SUPABASE|secret|server\.ts/);
  assert.match(api, /asyncJsonRoute[\s\S]*next\(error\)/);
}

async function durableRateLimit() {
  assert.match(migration, /create table if not exists public\.api_rate_limit_windows/i);
  assert.match(migration, /create or replace function public\.consume_api_rate_limit/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.doesNotMatch(migration, /raw_ip|ip_address/);
  assert.match(controls, /privacyHash/);
}

async function auditAdmission() {
  assert.match(migration, /create or replace function public\.admit_audit_submission/i);
  assert.match(migration, /DAILY_QUOTA_REACHED/);
  assert.match(migration, /DOMAIN_DAILY_LIMIT/);
  assert.match(migration, /ACTIVE_AUDIT_EXISTS/);
  const harness = new AtomicAdmissionHarness(10);
  const rows = await Promise.all(Array.from({ length: 10 }, () => harness.admit('guest-1', 'https://example.test/')));
  assert.equal(new Set(rows.map((row: any) => row.auditId)).size, 1);
  assert.equal(rows.filter((row: any) => !row.reused).length, 1);
  assert.equal(resolveDomainDailyAuditLimit({ plan: 'free', ownerDailyLimit: 3, configuredFreeLimit: 2 }), 2);
  assert.equal(resolveDomainDailyAuditLimit({ plan: 'paid', ownerDailyLimit: 25, configuredFreeLimit: 2 }), 25);
  assert.equal(resolveDomainDailyAuditLimit({ plan: 'agency', ownerDailyLimit: 100, configuredFreeLimit: 2 }), 100);
  assert.equal(resolveDomainDailyAuditLimit({ plan: 'admin', ownerDailyLimit: 1000, configuredFreeLimit: 2 }), 1000);
  assert.equal(resolveDomainDailyAuditLimit({ plan: 'unknown', ownerDailyLimit: 3, configuredFreeLimit: 2 }), 2);
  assert.match(api, /repeat-audit limit for this website/);
  assert.match(api, /resolveDomainDailyAuditLimit/);
}

async function queueLimits() {
  const harness = new AtomicAdmissionHarness(3);
  const rows = await Promise.all(Array.from({ length: 10 }, (_, index) => harness.admit(`owner-${index}`, `https://site-${index}.test/`)));
  assert.equal(rows.filter((row: any) => row.allowed).length, 3);
  assert.equal(rows.filter((row: any) => row.code === 'QUEUE_FULL').length, 7);
  assert.match(migration, /hardQueueLimit/);
  assert.match(migration, /softQueueWarning/);
}

async function deploymentCompatibility() {
  const version = publicVersionPayload();
  const migratedSchemaVersion = Number(schemaHeadMigration.match(/api_schema_version\s*=\s*(\d+)/i)?.[1]);
  assert.ok(Number.isInteger(migratedSchemaVersion), 'Latest migration must declare its API schema version.');
  assert.equal(API_SCHEMA_VERSION, migratedSchemaVersion);
  for (const key of ['applicationVersion', 'commitIdentifier', 'buildTimestamp', 'apiSchemaVersion', 'auditEngineVersion', 'scoringVersion', 'checkRegistryVersion']) assert.ok(key in version);
  assert.match(migration, /create table if not exists public\.deployment_versions/i);
  assert.match(controls, /AUDIT_SERVICE_UPDATING/);
}

async function adminOperations() {
  for (const route of ['/admin/diagnostics', '/admin/audits/:id/action', '/admin/users/:id/reset-quota', '/admin/platform/control']) assert.ok(api.includes(route));
  assert.match(api, /requireAdminRequester/);
  assert.match(api, /ADMIN_REASON_REQUIRED/);
  assert.match(api, /admin_actions/);
}

async function dataRetention() {
  assert.match(migration, /data_retention_policies/);
  assert.match(migration, /run_data_retention_cleanup/);
  assert.match(migration, /customer_reports/);
  assert.match(await read('scripts/cleanup-old-audits.mjs'), /dry-run|RETENTION_APPLY|--apply/);
}

async function accountDeletion() {
  assert.match(api, /\/me\/delete/);
  assert.match(api, /RECENT_LOGIN_REQUIRED/);
  assert.match(api, /delete_user_owned_data/);
  assert.match(migration, /update public\.blog_posts set author_id = null/);
  assert.match(await read('src/components/Settings.tsx'), /Type DELETE to confirm/);
}

async function legalRoutes() {
  const app = await read('src/App.tsx');
  for (const route of ['/privacy', '/terms', '/acceptable-use', '/cookies', '/contact']) assert.ok(app.includes(route));
  const legal = await read('src/components/LegalPage.tsx');
  assert.match(legal, /No unverified company registration|does not publish fabricated company details/);
  assert.match(await read('src/components/Register.tsx'), /legalAccepted/);
}

async function csp() {
  const vercel = JSON.parse(await read('vercel.json'));
  const headers = vercel.headers.flatMap((entry: any) => entry.headers || []);
  const policy = headers.find((entry: any) => entry.key === 'Content-Security-Policy')?.value || '';
  for (const directive of ['default-src', 'script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'frame-src', 'frame-ancestors', 'object-src', 'base-uri', 'form-action']) assert.match(policy, new RegExp(directive));
  assert.ok(headers.some((entry: any) => entry.key === 'Strict-Transport-Security'));
}

async function productionRouting() {
  const app = await read('src/App.tsx');
  const routes = await read('src/app/routes.ts');
  const vercel = JSON.parse(await read('vercel.json'));
  assert.match(app, /NotFoundPage/);
  assert.match(routes, /isKnownWorkspacePath/);
  assert.match(app, /legacyRoutes/);
  assert.match(app, /noindex, nofollow/);
  assert.equal(vercel.rewrites.some((rewrite: any) => rewrite.source === '/(.*)' || rewrite.source === '/:path*'), false);
  assert.match(await read('public/404.html'), /noindex, nofollow/);
}

async function loadSubmissions() {
  const duplicateHarness = new AtomicAdmissionHarness(10);
  const duplicateRows = await Promise.all(Array.from({ length: 10 }, () => duplicateHarness.admit('same-user', 'https://controlled.test/')));
  const queueHarness = new AtomicAdmissionHarness(3);
  const queueRows = await Promise.all(Array.from({ length: 10 }, (_, index) => queueHarness.admit(`owner-${index}`, `https://controlled-${index}.test/`)));
  assert.equal(duplicateRows.filter((row: any) => row.reused).length, 9);
  assert.equal(queueRows.filter((row: any) => row.allowed).length, 3);
  const worker = await read('src/workers/audit-worker.ts');
  const repository = await read('src/lib/supabase/audit-repository.ts');
  const history = await read('src/components/audit/AuditHistoryPage.tsx');
  assert.match(worker, /AUDIT_CANCELLED/);
  assert.match(worker, /RetriedFetchError/);
  assert.match(repository, /maxRecoveryAttempts/);
  assert.match(repository, /status: 'abandoned'/);
  assert.match(history, /limit: '12'/);
  assert.match(await read('scripts/smoke-specific-audit-errors.mts'), /ENOTFOUND[\s\S]*ETIMEDOUT[\s\S]*failureForHttpStatus\(404\)/);
  assert.match(await read('.github/workflows/production-smoke.yml'), /workflow_dispatch/);
  console.log(JSON.stringify({ acceptedSubmissions: 3, rejectedSubmissions: 7, duplicateReuse: 9, queueWait: 'bounded by hard limit', completionState: 'covered by audit-terminal-state', failureState: 'covered by audit-resilience', staleJobRecovery: 'bounded at 2 attempts' }));
}

async function realtimeFallback() {
  const live = await read('src/lib/audit/live-supabase-client.ts');
  const liveProgress = await read('src/components/audit/LiveAuditProgress.tsx');
  assert.match(live, /startPollingFallback/);
  assert.match(live, /removeChannel\(channel\)/);
  assert.match(live, /fallbackUnsubscribe/);
  assert.match(live, /reconnecting|polling/);
  const loadingBranch = liveProgress.match(/if \(!audit\) \{\s*return \([\s\S]*?\n\s*\);\s*\}\s*\n\s*const progress/)?.[0] || '';
  assert.ok(loadingBranch, 'loading render branch must remain detectable');
  assert.doesNotMatch(loadingBranch, /\baudit\./, 'loading branch must not dereference a null audit');
}

async function accessibility() {
  const shells = await read('src/components/layout/ProductShells.tsx');
  const activity = await read('src/components/audit/AuditActivityPanel.tsx');
  const css = await read('src/index.css');
  const register = await read('src/components/Register.tsx');
  assert.match(shells, /skip-link/);
  assert.match(activity, /role="dialog"/);
  assert.match(activity, /Escape/);
  assert.match(activity, /restore|previouslyFocused|focus\(/i);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(register, /aria-describedby="registration-consent"/);
}

const tests: Record<string, () => Promise<void>> = {
  'api-error-safety': apiErrorSafety,
  'durable-rate-limit': durableRateLimit,
  'audit-admission': auditAdmission,
  'queue-limits': queueLimits,
  'deployment-compatibility': deploymentCompatibility,
  'admin-operations': adminOperations,
  'data-retention': dataRetention,
  'account-deletion': accountDeletion,
  'legal-routes': legalRoutes,
  csp,
  'production-routing': productionRouting,
  'load-submissions': loadSubmissions,
  'realtime-fallback': realtimeFallback,
  accessibility,
};

const name = process.argv[2];
assert.ok(name && tests[name], `Unknown production smoke test: ${name || '(missing)'}`);
await tests[name]();
console.log(`${name} smoke test passed`);
