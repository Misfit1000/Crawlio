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

import { inspectPage } from './inspector';
import { simulateBotAccess } from './ai-bots-simulator';
import { auditSitemap } from './sitemap-auditor';
import { formatReportToMarkdown } from './report-formatter';
import { sendWebhookNotification } from './webhook-notifier';

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

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
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
        return jsonResponse({
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
          features: [
            'canonical_crawl_audit',
            'live_sse_streaming',
            'deep_page_inspection',
            'ai_bot_simulation',
            'sitemap_health_check',
            'markdown_reports',
            'webhook_notifications',
            'queue_claiming',
          ],
        });
      }

      // 2. Capabilities
      if (request.method === 'GET' && path === '/capability') {
        return jsonResponse({
          executorType,
          healthy: true,
          auditEngineVersion: AUDIT_ENGINE_VERSION,
          checkRegistryVersion: CHECK_REGISTRY_VERSION,
          scoringVersion: SCORING_VERSION,
          evidenceVersion: '1.0',
          supportedProfiles: ['quick', 'standard', 'deep'],
          limits: {
            maxConcurrency: 4,
            maxBytes: 3_000_000,
            timeoutMs: 12_000,
          },
          endpoints: {
            audit: 'POST /audit',
            auditStream: 'GET|POST /audit/stream',
            inspect: 'GET|POST /inspect',
            robotsSimulate: 'GET|POST /robots/simulate',
            sitemapCheck: 'GET|POST /sitemap/check',
            reportMarkdown: 'POST /report/markdown',
            claim: 'POST /claim',
          },
        });
      }

      // 3. Deep Single-Page Inspector (POST /inspect or GET /inspect?url=...)
      if ((request.method === 'POST' || request.method === 'GET') && path === '/inspect') {
        let targetUrl = url.searchParams.get('url');
        if (!targetUrl && request.method === 'POST') {
          const body = (await request.json().catch(() => ({}))) as { url?: string };
          targetUrl = body.url ?? null;
        }

        if (!targetUrl || typeof targetUrl !== 'string') {
          return jsonResponse({ error: 'Missing or invalid "url" parameter.' }, 400);
        }

        const inspection = await inspectPage(targetUrl);
        return jsonResponse(inspection);
      }

      // 4. AI & Search Engine Bot Permissions Simulator (POST /robots/simulate or GET /robots/simulate?url=...)
      if ((request.method === 'POST' || request.method === 'GET') && path === '/robots/simulate') {
        let targetUrl = url.searchParams.get('url');
        if (!targetUrl && request.method === 'POST') {
          const body = (await request.json().catch(() => ({}))) as { url?: string };
          targetUrl = body.url ?? null;
        }

        if (!targetUrl || typeof targetUrl !== 'string') {
          return jsonResponse({ error: 'Missing or invalid "url" parameter.' }, 400);
        }

        const simulation = await simulateBotAccess(targetUrl);
        return jsonResponse(simulation);
      }

      // 5. Sitemap Deep Health Auditor (POST /sitemap/check or GET /sitemap/check?url=...)
      if ((request.method === 'POST' || request.method === 'GET') && path === '/sitemap/check') {
        let sitemapUrl = url.searchParams.get('url');
        let sampleSize = Number(url.searchParams.get('sampleSize')) || 10;

        if (!sitemapUrl && request.method === 'POST') {
          const body = (await request.json().catch(() => ({}))) as { url?: string; sampleSize?: number };
          sitemapUrl = body.url ?? null;
          if (body.sampleSize) sampleSize = Number(body.sampleSize);
        }

        if (!sitemapUrl || typeof sitemapUrl !== 'string') {
          return jsonResponse({ error: 'Missing or invalid "url" parameter.' }, 400);
        }

        const sitemapAudit = await auditSitemap(sitemapUrl, sampleSize);
        return jsonResponse(sitemapAudit);
      }

      // 6. Executive Markdown Report Generation (POST /report/markdown)
      if (request.method === 'POST' && path === '/report/markdown') {
        const body = (await request.json().catch(() => ({}))) as { report?: ResourceAuditReport; url?: string };
        if (body.report) {
          const md = formatReportToMarkdown(body.report, body.url || 'Audited Site');
          return new Response(md, {
            headers: { 'Content-Type': 'text/markdown; charset=utf-8', ...corsHeaders },
          });
        }
        return jsonResponse({ error: 'Missing "report" object in body.' }, 400);
      }

      // 7. Live Server-Sent Events (SSE) Audit Streaming (GET /audit/stream?url=... or POST /audit/stream)
      if (path === '/audit/stream') {
        let targetUrl = url.searchParams.get('url');
        let mode = url.searchParams.get('mode') || 'quick';
        let webhookUrl = url.searchParams.get('webhookUrl');

        if (request.method === 'POST') {
          const body = (await request.json().catch(() => ({}))) as { url?: string; mode?: string; webhookUrl?: string };
          targetUrl = body.url ?? targetUrl;
          mode = body.mode ?? mode;
          webhookUrl = body.webhookUrl ?? webhookUrl;
        }

        if (!targetUrl || typeof targetUrl !== 'string') {
          return jsonResponse({ error: 'Missing or invalid "url" parameter for streaming audit.' }, 400);
        }

        const normalized = normalizeCrawlUrl(targetUrl) || targetUrl;
        const profile = getCanonicalProfile(mode);
        const auditId = `cf-stream-${Date.now()}`;

        const { readable, writable } = new TransformStream();
        const writerStream = writable.getWriter();
        const encoder = new TextEncoder();

        const sendEvent = async (eventName: string, data: unknown) => {
          const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
          await writerStream.write(encoder.encode(payload));
        };

        const pages: ResourceAuditPage[] = [];
        const issues: ResourceAuditIssue[] = [];

        const streamWriterAdapter: AuditWriterAdapter = {
          async addPage(pageInput) {
            const page: ResourceAuditPage = {
              ...pageInput,
              id: `page-${pages.length + 1}`,
            };
            pages.push(page);
            await sendEvent('page_crawled', {
              url: page.url,
              statusCode: page.statusCode,
              responseTimeMs: page.responseTimeMs,
              title: page.title,
              issueCount: page.issueCount,
              totalCrawled: pages.length,
            });
            return page;
          },
          async addIssue(issueInput) {
            const issue: ResourceAuditIssue = {
              ...issueInput,
              id: `issue-${issues.length + 1}`,
              detectedAt: new Date().toISOString(),
            };
            issues.push(issue);
            await sendEvent('issue_detected', {
              severity: issue.severity,
              category: issue.category,
              title: issue.title,
              affectedUrl: issue.affectedUrl,
            });
          },
          async addEvent(eventInput) {
            await sendEvent(eventInput.type, eventInput);
          },
          async writeProgress(patch, event) {
            await sendEvent('progress_updated', { ...patch, event });
          },
          async setFinalReport() {},
        };

        const networkAdapter = {
          async fetchSafe(fetchUrl: string, options: any) {
            const res = await cloudflarePublicFetch(fetchUrl, options);
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

        ctx.waitUntil(
          (async () => {
            try {
              const finalReport = await runCanonicalAudit({
                auditId,
                normalizedUrl: normalized,
                workerId,
                executorType,
                profile,
                network: networkAdapter,
                extractor: extractWithHtmlRewriter,
                writer: streamWriterAdapter,
              });

              await sendEvent('audit_completed', {
                auditId,
                status: finalReport ? 'completed' : 'failed',
                report: finalReport,
              });

              if (webhookUrl && finalReport) {
                await sendWebhookNotification({
                  webhookUrl,
                  auditId,
                  targetUrl: normalized,
                  report: finalReport,
                  status: 'completed',
                });
              }
            } catch (err: any) {
              await sendEvent('audit_error', { error: err.message || 'Stream audit failed' });
            } finally {
              await writerStream.close();
            }
          })()
        );

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            ...corsHeaders,
          },
        });
      }

      // 8. Direct Audit Execution (POST /audit)
      if (request.method === 'POST' && path === '/audit') {
        const body = (await request.json().catch(() => ({}))) as {
          url?: string;
          mode?: string;
          webhookUrl?: string;
        };

        if (!body.url || typeof body.url !== 'string') {
          return jsonResponse({ error: 'Missing or invalid "url" in request body.' }, 400);
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

        const activeReport = report || finalReport;

        // If webhookUrl provided, trigger notification in background
        if (body.webhookUrl && activeReport) {
          ctx.waitUntil(
            sendWebhookNotification({
              webhookUrl: body.webhookUrl,
              auditId,
              targetUrl: normalized,
              report: activeReport,
              status: report ? 'completed' : 'failed',
            })
          );
        }

        // Return Markdown if format=markdown is requested
        if (url.searchParams.get('format') === 'markdown' && activeReport) {
          const md = formatReportToMarkdown(activeReport, normalized);
          return new Response(md, {
            headers: { 'Content-Type': 'text/markdown; charset=utf-8', ...corsHeaders },
          });
        }

        return jsonResponse({
          auditId,
          status: report ? 'completed' : 'failed',
          executor: executorType,
          report: activeReport,
          pagesCount: pages.length,
          issuesCount: issues.length,
        });
      }

      // 9. Claim from Queue (POST /claim)
      if (request.method === 'POST' && path === '/claim') {
        if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
          return jsonResponse(
            { error: 'Queue claiming requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY bindings.' },
            400
          );
        }

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
          return jsonResponse({ error: `Supabase claim RPC failed: ${errText}` }, 502);
        }

        const claimedAuditId = (await claimResp.json()) as string | null;
        if (!claimedAuditId) {
          return jsonResponse({ status: 'idle', message: 'No queued audits available for executor.' });
        }

        return jsonResponse({
          status: 'claimed',
          auditId: claimedAuditId,
          executor: executorType,
          workerId,
        });
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error: any) {
      return jsonResponse({ error: error.message || 'Worker execution error' }, 500);
    }
  },
};
