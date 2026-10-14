import { CAPTURE_POLICY } from '../../lib/preview/capture-policy';
import type { PreviewEnv } from './contracts';
import { authorized, json } from './coordinator';
import { configuration } from './io';
export { SitePreviewCoordinator } from './coordinator';

function coordinator(env: PreviewEnv) {
  const namespace = env.SITE_PREVIEW_COORDINATOR!;
  return namespace.get(namespace.idFromName('global-site-preview-v1'));
}

export default {
  async fetch(request: Request, env: PreviewEnv) {
    const path = new URL(request.url).pathname;
    const config = configuration(env);
    if (path === '/health' && request.method === 'GET') {
      let operational: unknown = { state: 'not_probed' };
      if (config.ready) {
        try {
          const response = await coordinator(env).fetch('https://coordinator.invalid/health', { signal: AbortSignal.timeout(1500) });
          operational = response.ok ? await response.json() : { state: 'unavailable' };
        } catch { operational = { state: 'unavailable' }; }
      }
      return json({
        enabled: config.checks.explicitlyEnabled, configured: config.ready, configuration: config.checks,
        operational, providerReachability: 'not_probed', browserGuards: 'required_and_installed_per_capture',
        budgetAuthority: 'claim_site_preview', limits: CAPTURE_POLICY,
      }, config.checks.explicitlyEnabled && (!config.ready || (operational as any)?.browserSafetyBlocked || (operational as any)?.state === 'unavailable') ? 503 : 200);
    }
    if (path !== '/control/wake' || request.method !== 'POST') return json({ error: 'not_found' }, 404);
    if (!await authorized(request, env.PREVIEW_CONTROL_SECRET)) return json({ error: 'unauthorized' }, 401);
    if (!config.ready) return json({ error: 'not_configured' }, 503);
    try {
      return await coordinator(env).fetch('https://coordinator.invalid/control/wake', {
        method: 'POST', headers: { authorization: `Bearer ${env.PREVIEW_CONTROL_SECRET}` }, signal: AbortSignal.timeout(2000),
      });
    } catch { return json({ error: 'coordinator_unavailable' }, 503); }
  },
  async scheduled(_event: unknown, env: PreviewEnv, context: { waitUntil(promise: Promise<unknown>): void }) {
    if (!configuration(env).ready) return;
    context.waitUntil(coordinator(env).fetch('https://coordinator.invalid/control/wake', {
      method: 'POST', headers: { authorization: `Bearer ${env.PREVIEW_CONTROL_SECRET}` }, signal: AbortSignal.timeout(2000),
    }).then(response => { if (!response.ok) throw new Error('PREVIEW_RECOVERY_UNAVAILABLE'); }));
  },
};
