import {
  APPLICATION_VERSION,
  AUDIT_ENGINE_VERSION,
  SCORING_VERSION,
  CHECK_REGISTRY_VERSION,
} from '../../../lib/platform/version';

export interface Env {
  EXECUTOR_TYPE: string;
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
    return new Response(null, {
      headers: corsHeaders,
    });
  } else {
    return new Response(null, {
      headers: {
        Allow: 'GET, POST, OPTIONS',
      },
    });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === 'GET' && path === '/health') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            executor: env.EXECUTOR_TYPE || 'cloudflare',
            versions: {
              application: APPLICATION_VERSION,
              engine: AUDIT_ENGINE_VERSION,
              scoring: SCORING_VERSION,
              checks: CHECK_REGISTRY_VERSION,
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

      if (request.method === 'GET' && path === '/capability') {
        return new Response(
          JSON.stringify({
            executor: env.EXECUTOR_TYPE || 'cloudflare',
            capabilities: [
              'network_fetch',
              'html_parsing_rewriter',
              'page_batching',
            ],
            limits: {
              maxConcurrency: 10,
              maxBytes: 2000000,
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

      if (request.method === 'POST' && path === '/claim') {
        // TODO: Implement claim and execute an audit slice
        // 1. Claim work from Supabase
        // 2. Execute bounded page batches using HTMLRewriter extractor
        // 3. Run shared checks
        // 4. Persist results
        return new Response(
          JSON.stringify({
            message: 'Claim endpoint not fully implemented yet.',
          }),
          {
            status: 501,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      }

      return new Response('Not Found', {
        status: 404,
        headers: corsHeaders,
      });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }
  },
};
