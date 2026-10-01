import {
  APPLICATION_VERSION,
  AUDIT_ENGINE_VERSION,
  SCORING_VERSION,
  CHECK_REGISTRY_VERSION,
} from '../../../lib/platform/version';
import { runCanonicalAudit, type AuditWriterAdapter } from '../../../audit-core/engine';
import { getCanonicalProfile } from '../../../audit-core/contracts';
import { cloudflarePublicFetch } from '../../../audit-core/adapters/cloudflare-network-adapter';
import { extractWithHtmlRewriter } from '../../../audit-core/extractors/cloudflare-html-extractor';
import { normalizeCrawlUrl } from '../../../audit-core/url';
import type { ResourceAuditPage, ResourceAuditIssue, ResourceAuditReport, ResourceAuditDocument } from '../../../lib/audit/resource-types';

export interface Env {
  EXECUTOR_TYPE?: string;
  WORKER_ID?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function handleOptions(request: Request) {
  if (
    request.headers.get('Origin') !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(null, { headers: { Allow: 'GET, POST, OPTIONS' } });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const workerId = env.WORKER_ID || 'cf-worker-edge-1';
    const executorType = 'cloudflare' as const;

    try {
      // 1. Health check
      if (request.method === 'GET' && path === '/health') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            healthy: true,
            executor: env.EXECUTOR_TYPE || executorType,
            workerId,
            versions: {
              application: APPLICATION_VERSION,
              engine: AUDIT_ENGINE_VERSION,
              scoring: SCORING_VERSION,
              checks: CHECK_REGISTRY_VERSION,
              evidence: '1.0',
            },
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      }

      // 2. Capabilities
      if (request.method === 'GET' && path === '/capability') {
        return new Response(
          JSON.stringify({
            executorType,
            healthy: true,
            auditEngineVersion: AUDIT_ENGINE_VERSION,
            checkRegistryVersion: CHECK_REGISTRY_VERSION,
            scoringVersion: SCORING_VERSION,
            evidenceVersion: '1.0',
            supportedProfiles: ['quick', 'standard', 'deep'],
            limits: {
              maxConcurrency: 4,
              maxBytes: 2_000_000,
              timeoutMs: 12_000,
            },
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      }

      // 3. Direct Audit Execution (Autonomous in-memory execution with canonical engine)
      if (request.method === 'POST' && path === '/audit') {
        const body = (await request.json().catch(() => ({}))) as { url?: string; mode?: string };
        if (!body.url || typeof body.url !== 'string') {
          return new Response(
            JSON.stringify({ error: 'Missing or invalid "url" in request body.' }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
          );
        }

        const normalized = normalizeCrawlUrl(body.url) || body.url;
        const profile = getCanonicalProfile(body.mode || 'quick');
        const auditId = `cf-audit-${Date.now()}`;

        const pages: ResourceAuditPage[] = [];
        const issues: ResourceAuditIssue[] = [];
        const events: unknown[] = [];
        let finalReport: ResourceAuditReport | null = null;

        const writer: AuditWriterAdapter = {
          async addPage(pageInput) {
            const page: ResourceAuditPage = {
              ...pageInput,
              id: `page-${pages.length + 1}`,
            };
            pages.push(page);
            return page;
          },
          async addIssue(issueInput) {
            const issue: ResourceAuditIssue = {
              ...issueInput,
              id: `issue-${issues.length + 1}`,
              detectedAt: new Date().toISOString(),
            };
            issues.push(issue);
          },
          async addEvent(eventInput) {
            events.push({ ...eventInput, timestamp: new Date().toISOString() });
          },
          async writeProgress() {},
          async setFinalReport(report) {
            finalReport = report;
          },
        };

        const networkAdapter = {
          async fetchSafe(targetUrl: string, options: any) {
            const res = await cloudflarePublicFetch(targetUrl, options);
            return {
              finalUrl: res.finalUrl,
              status: res.status,
              durationMs: res.durationMs,
              bodyBytes: res.bodyBytes,
              contentType: res.contentType,
              headers: res.headers,
              body: res.body,
            };
          },
          resolveUrl(inputUrl: string, base?: string) {
            return normalizeCrawlUrl(inputUrl, base);
          },
        };

        const report = await runCanonicalAudit({
          auditId,
          normalizedUrl: normalized,
          workerId,
          executorType,
          profile,
          network: networkAdapter,
          extractor: extractWithHtmlRewriter,
          writer,
        });

        return new Response(
          JSON.stringify({
            auditId,
            status: report ? 'completed' : 'failed',
            executor: executorType,
            report: report || finalReport,
            pagesCount: pages.length,
            issuesCount: issues.length,
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      }

      // 4. Claim from Queue
      if (request.method === 'POST' && path === '/claim') {
        if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
          return new Response(
            JSON.stringify({
              error: 'Queue claiming requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY bindings.',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
          );
        }

        // Call Supabase RPC claim_audit_for_executor
        const rpcUrl = `${env.SUPABASE_URL}/rest/v1/rpc/claim_audit_for_executor`;
        const claimResp = await fetch(rpcUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            p_worker_id: workerId,
            p_executor_type: executorType,
            p_engine_version: AUDIT_ENGINE_VERSION,
            p_check_version: CHECK_REGISTRY_VERSION,
            p_scoring_version: SCORING_VERSION,
          }),
        });

        if (!claimResp.ok) {
          const errText = await claimResp.text();
          return new Response(
            JSON.stringify({ error: `Supabase claim RPC failed: ${errText}` }),
            { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
          );
        }

        const claimedAuditId = (await claimResp.json()) as string | null;
        if (!claimedAuditId) {
          return new Response(
            JSON.stringify({ status: 'idle', message: 'No queued audits available for executor.' }),
            { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
          );
        }

        return new Response(
          JSON.stringify({
            status: 'claimed',
            auditId: claimedAuditId,
            executor: executorType,
            workerId,
          }),
          { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error: any) {
      return new Response(
        JSON.stringify({ error: error.message || 'Worker execution error' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
  },
};
