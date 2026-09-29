import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { AUDIT_MODES, AUDIT_MODE_PAGE_CEILINGS, createAuditRuntimeCapabilities, enforceAuditPageLimit, isAuditMode } from '../src/lib/audit/audit-config.ts';
import { DEFAULT_PLAN_LIMITS, canStartAudit, EntitlementError } from '../src/lib/billing/entitlements.ts';
import { createPublicPlanProjection } from '../src/lib/plans/public-plan-presentation.ts';
import { ApiError, safeApiError } from '../src/lib/api/errors.ts';

for (const mode of AUDIT_MODES) {
  assert.equal(enforceAuditPageLimit(mode, 9000, 5), AUDIT_MODE_PAGE_CEILINGS[mode]);
  for (const plan of ['free', 'paid', 'agency']) assert.equal(enforceAuditPageLimit(mode, 9000, 5, plan), 500);
  assert.equal(enforceAuditPageLimit(mode, 9000, 5, 'admin'), 5000);
  assert.equal(enforceAuditPageLimit(mode, undefined, 1000, 'admin'), 1000);
}
assert.equal(DEFAULT_PLAN_LIMITS.free.maxPagesQuick, 5);
assert.equal(DEFAULT_PLAN_LIMITS.paid.maxPagesStandard, 50);
assert.equal(DEFAULT_PLAN_LIMITS.agency.maxPagesDeep, 75);
assert.equal(DEFAULT_PLAN_LIMITS.admin.maxPagesDeep, 1000);

const unavailable = { ready: false, deepReady: false };
const standardOnly = { ready: true, deepReady: false };
const ready = { ready: true, deepReady: true };
const rows = [{ plan: 'agency', max_pages_quick: 500, max_pages_standard: 500, max_pages_deep: 500 }];
for (const [state, expected] of [[unavailable, { quick: 50, standard: 50, deep: 100 }], [standardOnly, { quick: 500, standard: 500, deep: 100 }], [ready, { quick: 500, standard: 500, deep: 500 }]] as const) {
  const caps = createAuditRuntimeCapabilities(true, state);
  assert.deepEqual(caps.pageCeilings, expected);
  assert.deepEqual(createPublicPlanProjection(rows, 'test', caps.availableModes, caps.pageCeilings).plans[2].pageLimits, expected);
}
assert.equal(createAuditRuntimeCapabilities(true, ready, 'admin').pageCeilings.deep, 5000);
assert.deepEqual(createAuditRuntimeCapabilities(false).availableModes, ['quick', 'standard']);

// Exercise the real guest decision without a database or external requests.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalFree = { ...DEFAULT_PLAN_LIMITS.free };
try {
  Object.assign(DEFAULT_PLAN_LIMITS.free, { allowedModes: ['quick', 'standard', 'deep'], maxPagesStandard: 120, maxPagesDeep: 230 });
  assert.equal((await canStartAudit(null, 'standard')).pageLimit, 120);
  assert.equal((await canStartAudit(null, 'deep', { deepAuditEnabled: true })).pageLimit, 230);
} finally {
  Object.assign(DEFAULT_PLAN_LIMITS.free, originalFree);
}

// Isolate the actual startup handler with injected dependencies, avoiding live admission and queue writes.
const api = await readFile(new URL('../src/api/index.ts', import.meta.url), 'utf8');
const start = api.slice(api.indexOf('async function startQueuedAudit('), api.indexOf("apiRouter.post('/audit/start'"));
const compiled = ts.transpileModule(start, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
async function runStart(state: typeof ready | Error, mode: 'quick' | 'standard' | 'deep', pageLimit: number, legacyDeep = true) {
  let created: any = null;
  const dependencies = {
    normalizeUserUrl: () => ({ isValid: true, hostname: 'example.com', normalizedUrl: 'https://example.com/' }),
    isAuditMode, ApiError, EntitlementError, AUDIT_MODE_PAGE_CEILINGS,
    getRequester: async () => ({ userId: null }),
    guestIdentityForRequest: () => ({ guestKey: 'test', guestKeyHash: 'test' }),
    DUPLICATE_AUDIT_WINDOW_MS: 1000,
    scalableReadiness: async () => { if (state instanceof Error) throw state; return state; },
    canStartAudit: async () => ({ effectiveMode: mode, requestedMode: mode, pageLimit, plan: 'agency', limits: DEFAULT_PLAN_LIMITS.agency }),
    isDeepAuditEnabled: () => legacyDeep,
    isSupabaseAdminEnabled: () => false,
    auditRepository: {
      findActiveDuplicateAudit: async () => null,
      findActiveAuditForOwner: async () => null,
      createAuditJob: async (input: any) => { created = input; return { ...input, id: 'test' }; },
      updateAudit: async () => {},
    },
    consumeAuditQuota: async () => {},
    auditStartResponseData: (audit: any) => audit,
    process: { env: { NODE_ENV: 'test' } },
  };
  const handler = new Function(...Object.keys(dependencies), `${compiled}\nreturn startQueuedAudit;`)(...Object.values(dependencies));
  await handler({ body: { url: 'example.com', mode } }, { json: (value: any) => value });
  return created;
}
for (const mode of AUDIT_MODES) {
  assert.equal((await runStart(ready, mode, 500)).processingVersion, 2);
  assert.equal((await runStart(unavailable, mode, AUDIT_MODE_PAGE_CEILINGS[mode])).processingVersion, 1);
  await assert.rejects(runStart(unavailable, mode, AUDIT_MODE_PAGE_CEILINGS[mode] + 1), (error: any) => {
    const response = safeApiError(error, 'test');
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'SCALABLE_AUDIT_UNAVAILABLE');
    assert.match(response.body.error.message, /migration.*worker/);
    return true;
  });
}
assert.equal((await runStart(standardOnly, 'standard', 500)).processingVersion, 2);
await assert.rejects(runStart(standardOnly, 'deep', 500), { code: 'SCALABLE_AUDIT_UNAVAILABLE' });
await assert.rejects(runStart(unavailable, 'deep', 75, false), { code: 'DEEP_AUDIT_UNAVAILABLE' });
assert.equal((await runStart(ready, 'deep', 500, false)).processingVersion, 2);
assert.equal((await runStart(new Error('readiness lookup failed'), 'quick', 5)).processingVersion, 1);
await assert.rejects(runStart(new Error('readiness lookup failed'), 'standard', 500), { code: 'SCALABLE_AUDIT_UNAVAILABLE' });
assert.equal((await runStart({ ready: false, deepReady: true }, 'deep', 75)).processingVersion, 1);

const auth = await readFile(new URL('../src/contexts/AuthContext.tsx', import.meta.url), 'utf8');
const clientSource = auth.slice(auth.indexOf('function clientPageLimit('), auth.indexOf('function mapAuditEntitlements('));
const clientCompiled = ts.transpileModule(clientSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const clientPageLimit = new Function('enforceAuditPageLimit', 'AUDIT_MODE_PAGE_CEILINGS', `${clientCompiled}\nreturn clientPageLimit;`)(enforceAuditPageLimit, AUDIT_MODE_PAGE_CEILINGS);
assert.equal(clientPageLimit('standard', 1000, 50, 'admin', 5000), 1000);
assert.equal(clientPageLimit('standard', 1000, 50, 'admin', 50), 50);
assert.equal(clientPageLimit('standard', 1000, 50, 'admin', undefined), 50);
assert.equal(clientPageLimit('standard', 1000, 50, 'agency', 5000), 500);
assert.equal(clientPageLimit('deep', 0, 75, 'agency', 500), 0);
console.log('PASS scalable plan ceilings, runtime presentation, guest modes, and startup readiness gating');
