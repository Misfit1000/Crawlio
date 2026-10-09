import { DurableObject } from 'cloudflare:workers';
import { API_SCHEMA_VERSION, AUDIT_ENGINE_VERSION, CHECK_REGISTRY_VERSION, SCORING_VERSION } from '../../../lib/platform/version';
import { runSecondarySlice, type SecondaryEnvironment, type SliceOutcome } from './queue-runner';

export interface Env extends SecondaryEnvironment {
  AUDIT_EXECUTOR: DurableObjectNamespace<AuditExecutor>;
  EXECUTOR_ENABLED: string;
  EXECUTOR_CONTROL_SECRET?: string;
}

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const configured = (env: Env) => !!env.SUPABASE_URL && !!env.SUPABASE_SERVICE_ROLE_KEY && !!env.EXECUTOR_CONTROL_SECRET;

async function authorized(request: Request, env: Env) {
  const expected = env.EXECUTOR_CONTROL_SECRET;
  const received = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!expected || !received || received.length > 256) return false;
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', encode.encode(expected)), crypto.subtle.digest('SHA-256', encode.encode(received))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  return x.reduce((different, value, index) => different | (value ^ y[index]), 0) === 0;
}

export class AuditExecutor extends DurableObject<Env> {
  private running = false;

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/status') return json({ ...(await this.ctx.storage.get<Record<string, unknown>>('status') || {}),
      running: this.running, nextAlarmAt: await this.ctx.storage.getAlarm(),
      enabled: this.env.EXECUTOR_ENABLED === 'true' && !(await this.ctx.storage.get('paused')) });
    if (path === '/pause') {
      await this.ctx.storage.put('paused', true);
      await this.ctx.storage.deleteAlarm();
      return json({ paused: true, activeSliceWillFinish: this.running });
    }
    if (path !== '/wake' && path !== '/resume') return json({ error: 'NOT_FOUND' }, 404);
    if (path === '/resume') await this.ctx.storage.put('paused', false);
    if (this.env.EXECUTOR_ENABLED !== 'true' || !configured(this.env)) return json({ error: 'EXECUTOR_NOT_CONFIGURED' }, 503);
    if (!(await this.ctx.storage.get('paused')) && !(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 10);
    return json({ scheduled: true });
  }

  async alarm() {
    if (this.running || this.env.EXECUTOR_ENABLED !== 'true' || !configured(this.env) || await this.ctx.storage.get('paused')) return;
    this.running = true;
    const started = Date.now();
    let outcome: SliceOutcome = { worked: false, completed: false, pages: 0 };
    let failures = Number(await this.ctx.storage.get('failures') || 0);
    // SQL generations protect evidence even after eviction or duplicate alarms.
    await this.ctx.storage.setAlarm(Date.now() + 150_000);
    try {
      outcome = await runSecondarySlice(this.env);
      failures = 0;
      await this.ctx.storage.put('status', { lastRunAt: new Date().toISOString(), durationMs: Date.now() - started,
        lastOutcome: outcome.worked ? outcome.completed ? 'completed' : 'checkpointed' : 'idle', pagesInSlice: outcome.pages,
        lastErrorCode: null, commit: this.env.GIT_COMMIT_SHA });
    } catch (error) {
      failures++;
      const code = String((error as { code?: string }).code || 'SECONDARY_SLICE_FAILED').slice(0, 80);
      const details = error as { httpStatus?: number; databaseCode?: string; transportType?: string; transportCategory?: string };
      console.error(JSON.stringify({ event: 'secondary_slice_failed', code, httpStatus: details.httpStatus,
        databaseCode: details.databaseCode, transportType: details.transportType, transportCategory: details.transportCategory }));
      await this.ctx.storage.put('status', { lastRunAt: new Date().toISOString(), durationMs: Date.now() - started, lastOutcome: 'error', lastErrorCode: code,
        httpStatus: details.httpStatus, databaseCode: details.databaseCode, transportType: details.transportType, transportCategory: details.transportCategory });
    } finally {
      this.running = false;
      await this.ctx.storage.put('failures', failures);
      if (await this.ctx.storage.get('paused')) await this.ctx.storage.deleteAlarm();
      else await this.ctx.storage.setAlarm(Date.now() + (failures ? Math.min(300_000, 15_000 * 2 ** Math.min(failures, 4)) : outcome.worked ? 4_000 : 30_000));
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if ((path === '/health' || path === '/capability') && request.method === 'GET') return json({
      service: 'crawlio-secondary-audit', executorType: 'cloudflare', runtime: 'sqlite-durable-object',
      status: configured(env) ? env.EXECUTOR_ENABLED === 'true' ? 'configured' : 'disabled' : 'configuration_required',
      apiSchemaVersion: API_SCHEMA_VERSION, processingVersion: 2, auditScopeVersion: 1,
      auditEngineVersion: AUDIT_ENGINE_VERSION, scoringVersion: SCORING_VERSION, checkRegistryVersion: CHECK_REGISTRY_VERSION,
      commitIdentifier: env.GIT_COMMIT_SHA, queueConsumer: configured(env) && env.EXECUTOR_ENABLED === 'true',
      execution: { maxDocumentsPerSlice: 4, maxSliceMs: 20_000, maxConcurrentTargetRequests: 1 }, directPublicAudits: false });
    if (!['/control/status', '/control/wake', '/control/pause', '/control/resume'].includes(path)) return json({ error: 'NOT_FOUND' }, 404);
    if (request.method !== (path === '/control/status' ? 'GET' : 'POST')) return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    if (!(await authorized(request, env))) return json({ error: 'UNAUTHORIZED' }, 401);
    return env.AUDIT_EXECUTOR.get(env.AUDIT_EXECUTOR.idFromName('secondary-queue-v1')).fetch(new Request(`https://executor/${path.split('/').at(-1)}`, { method: request.method }));
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (env.EXECUTOR_ENABLED === 'true' && configured(env)) ctx.waitUntil(env.AUDIT_EXECUTOR.get(env.AUDIT_EXECUTOR.idFromName('secondary-queue-v1')).fetch(new Request('https://executor/wake', { method: 'POST' })));
  },
};
