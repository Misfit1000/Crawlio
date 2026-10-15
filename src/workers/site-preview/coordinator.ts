import { CAPTURE_POLICY, PreviewFailure, capturePaths, ownedArtifactPath } from '../../lib/preview/capture-policy';
import { capturePair } from './capture';
import type { CaptureClaim, CaptureResult, DurableState, PreviewEnv, Runtime } from './contracts';
import { PreviewApi, SubrequestBudget, configuration } from './io';
import { runtime as productionRuntime } from './runtime';

interface CompletionJournal { job: CaptureClaim; result: CaptureResult; cleanupPaths: string[] }
interface UploadIntent { job: CaptureClaim; closureConfirmed: boolean }

export async function authorized(request: Request, secret: string | undefined): Promise<boolean> {
  const header = request.headers.get('authorization');
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ') || header.length > 1024) return false;
  const encoder = new TextEncoder();
  const expected = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(secret)));
  const actual = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(header.slice(7))));
  let difference = 0;
  for (let at = 0; at < expected.length; at++) difference |= expected[at] ^ actual[at];
  return difference === 0;
}

export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

function redactedDetail(detail: string, env: PreviewEnv) {
  return detail.replaceAll(env.SUPABASE_SERVICE_ROLE_KEY || '[unconfigured-service-key]', '[REDACTED]')
    .replaceAll(env.PREVIEW_CONTROL_SECRET || '[unconfigured-control-key]', '[REDACTED]')
    .replace(/eyJ[A-Za-z0-9_.-]+|Bearer\s+\S+|opr_live_[A-Za-z0-9_-]+/g, '[REDACTED]').slice(0, 500);
}

export class SitePreviewCoordinator {
  private running?: Promise<void>;
  constructor(private state: DurableState, private env: PreviewEnv, private runtime: Runtime = productionRuntime) {}

  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') return json({
      configured: configuration(this.env).ready,
      lastFailure: await this.state.storage.get<string>('lastFailure') ?? null,
      browserSafetyBlocked: Boolean(await this.state.storage.get('browserSafetyBlocked')),
      pendingCompletion: Boolean(await this.state.storage.get('completion')),
      pendingDeletionCount: (await this.state.storage.get<string[]>('deletions') ?? []).length,
    });
    if (path === '/control/diagnostics' && request.method === 'POST') {
      if (!await authorized(request, this.env.PREVIEW_CONTROL_SECRET)) return json({ error: 'unauthorized' }, 401);
      return json({ lastFailure: await this.state.storage.get('lastFailure') ?? null,
        detail: await this.state.storage.get('lastFailureDetail') ?? null });
    }
    if (path !== '/control/wake' || request.method !== 'POST') return json({ error: 'not_found' }, 404);
    if (!await authorized(request, this.env.PREVIEW_CONTROL_SECRET)) return json({ error: 'unauthorized' }, 401);
    if (!configuration(this.env).ready) return json({ error: 'not_configured' }, 503);
    if (await this.state.storage.get('browserSafetyBlocked')) return json({ error: 'browser_closure_unconfirmed' }, 503);
    const current = await this.state.storage.getAlarm(), soon = this.runtime.now() + 25;
    if (current === null || current > soon) await this.state.storage.setAlarm(soon);
    return json({ accepted: true }, 202);
  }

  async alarm() {
    if (this.running) return this.running;
    const run = this.tick().catch(async error => {
      await this.state.storage.put('lastFailure', error instanceof PreviewFailure ? error.code : 'WORKER_UNAVAILABLE');
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown runtime failure';
      await this.state.storage.put('lastFailureDetail', redactedDetail(detail, this.env));
      await this.state.storage.setAlarm(this.runtime.now() + 60_000);
    });
    this.running = run;
    try { await run; } finally { this.running = undefined; }
  }

  private async enqueueDeletion(paths: string[]) {
    if (!paths.length) return;
    const existing = await this.state.storage.get<string[]>('deletions') ?? [];
    await this.state.storage.put('deletions', [...new Set([...existing, ...paths])]);
  }

  private async drainDeletions(api: PreviewApi) {
    const paths = await this.state.storage.get<string[]>('deletions') ?? [];
    if (!paths.length) return;
    const batch = paths.slice(0, 100);
    await api.remove(batch);
    if (paths.length > batch.length) await this.state.storage.put('deletions', paths.slice(batch.length));
    else await this.state.storage.delete('deletions');
  }

  private async finishCompletion(api: PreviewApi) {
    const journal = await this.state.storage.get<CompletionJournal>('completion');
    if (!journal) return;
    const { job, result } = journal;
    const paths = capturePaths(job.id, job.generation);
    let committed = await api.complete(job, result);
    if (typeof committed !== 'boolean') throw new PreviewFailure('INVALID_COMPLETION_RESPONSE');
    let referenced: string[] = [];
    if (!committed) {
      // A lost completion response must not cause committed images to be deleted.
      const current = await api.currentArtifacts(job.id);
      referenced = [current?.desktop_path, current?.mobile_path].filter((path): path is string => typeof path === 'string');
      committed = result.status === 'captured' && referenced.includes(paths.desktop) && referenced.includes(paths.mobile);
    }
    const old = committed && result.status === 'captured'
      ? [job.desktop_path, job.mobile_path].filter((path): path is string => ownedArtifactPath(job.id, path)
        && Number(path.split('/')[1]) < job.generation)
      : [];
    const garbage = result.status === 'captured' && !committed ? [paths.desktop, paths.mobile] : journal.cleanupPaths;
    await this.enqueueDeletion([...old, ...garbage].filter(path => !referenced.includes(path)));
    await this.state.storage.delete('completion');
  }

  private async recoverUploadIntent(api: PreviewApi) {
    const intent = await this.state.storage.get<UploadIntent>('uploadIntent');
    if (!intent) return;
    const paths = capturePaths(intent.job.id, intent.job.generation);
    const current = await api.currentArtifacts(intent.job.id);
    const referenced = [current?.desktop_path, current?.mobile_path];
    await this.enqueueDeletion([paths.desktop, paths.mobile].filter(path => !referenced.includes(path)));
    if (!intent.closureConfirmed) {
      await this.state.storage.put('browserSafetyBlocked', true);
      await this.state.storage.put('lastFailure', 'CAPTURE_INTERRUPTED');
    }
    await this.state.storage.delete('uploadIntent');
  }

  private async cleanup(api: PreviewApi, force = false) {
    const due = await this.state.storage.get<number>('cleanupAt') ?? 0;
    if (!force && this.runtime.now() < due) return;
    const candidates = await api.rpc<unknown>('preview_storage_cleanup', {});
    if (!Array.isArray(candidates)) throw new PreviewFailure('INVALID_CLEANUP_RESPONSE');
    for (const candidate of candidates.slice(0, 10)) {
      capturePaths(candidate.id, 1);
      const raw = [candidate.desktop_path, candidate.mobile_path].filter(path => path !== null && path !== undefined);
      if (!raw.every(path => ownedArtifactPath(candidate.id, path))) throw new PreviewFailure('INVALID_CLEANUP_PATH');
      await api.remove(raw);
      const finished = await api.rpc<boolean>('finish_preview_cleanup', { p_id: candidate.id });
      if (typeof finished !== 'boolean') throw new PreviewFailure('INVALID_CLEANUP_RESPONSE');
    }
    await this.state.storage.put('cleanupAt', this.runtime.now() + 15 * 60_000);
  }

  private async tick() {
    if (!configuration(this.env).ready) return;
    await this.state.storage.setAlarm(this.runtime.now() + 60_000);
    const api = new PreviewApi(this.env, this.runtime.fetch, new SubrequestBudget());
    await this.finishCompletion(api);
    await this.recoverUploadIntent(api);
    await this.drainDeletions(api);
    if ((await this.state.storage.get<string[]>('deletions'))?.length) return;
    if (await this.state.storage.get('browserSafetyBlocked')) { await this.cleanup(api, true); return; }
    const nextBrowserAt = await this.state.storage.get<number>('nextBrowserAt') ?? 0;
    if (this.runtime.now() < nextBrowserAt) {
      await this.state.storage.setAlarm(nextBrowserAt);
      return;
    }
    const job = await api.claim();
    if (job === null) { await this.cleanup(api, true); return; }
    await this.state.storage.delete('lastFailure');
    await this.state.storage.delete('lastFailureDetail');
    if (!job || typeof job.target_url !== 'string') throw new PreviewFailure('INVALID_CLAIM');
    capturePaths(job.id, job.generation);
    // Persist before launch; a restarted object does not immediately acquire another browser.
    await this.state.storage.put('nextBrowserAt', this.runtime.now() + 2 * CAPTURE_POLICY.deadlineMs);
    await this.state.storage.put<UploadIntent>('uploadIntent', { job, closureConfirmed: false });
    const outcome = await capturePair(job, api, this.runtime);
    await this.state.storage.put<UploadIntent>('uploadIntent', { job, closureConfirmed: outcome.closureConfirmed });
    if (outcome.result.status !== 'captured') {
      await this.state.storage.put('lastFailure', outcome.result.failureCode ?? 'CAPTURE_UNAVAILABLE');
      if (outcome.diagnostic) await this.state.storage.put('lastFailureDetail', redactedDetail(outcome.diagnostic, this.env));
    }
    this.state.waitUntil(outcome.settlement);
    if (!outcome.closureConfirmed) await this.state.storage.put('browserSafetyBlocked', true);
    else await this.state.storage.put('nextBrowserAt', this.runtime.now() + CAPTURE_POLICY.browserIntervalMs);
    await this.state.storage.put<CompletionJournal>('completion', { job, result: outcome.result, cleanupPaths: outcome.cleanupPaths });
    await this.finishCompletion(api);
    await this.drainDeletions(api);
    await this.state.storage.delete('uploadIntent');
    if (outcome.closureConfirmed) await this.state.storage.setAlarm((await this.state.storage.get<number>('nextBrowserAt'))!);
  }
}
