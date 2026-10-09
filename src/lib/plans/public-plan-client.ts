import { API_ROUTES } from '../api/routes';
import { safeJsonFetch } from '../http/safe-json';
import type { PublicPlanProjection } from './public-plan-presentation';
import { inflightRead } from '../http/inflight-read';


function isProjection(value: unknown): value is PublicPlanProjection {
  const candidate = value as PublicPlanProjection;
  return candidate?.version === 1 && Array.isArray(candidate.plans) && candidate.plans.length === 3;
}

export function loadPublicPlanProjection(signal?: AbortSignal) {
  // HTTP cache age is authoritative; a second application TTL would extend stale plans.
  return inflightRead(API_ROUTES.publicPlans, {}, async requestSignal => {
      const response = await safeJsonFetch<{ success: true; data: PublicPlanProjection }>(API_ROUTES.publicPlans, { signal: requestSignal });
      if (!response.success) throw new Error(('error' in response && response.error) || 'Current plan limits are unavailable.');
      const value = response.data.data;
      if (!isProjection(value)) throw new Error('Current plan limits are invalid.');
      return value;
    }, signal);
}

export function clearPublicPlanProjectionCache() {
  // No resolved-response cache remains; subsequent reads revalidate through HTTP.
}
