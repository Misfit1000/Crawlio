import { API_ROUTES } from '../api/routes';
import { safeJsonFetch } from '../http/safe-json';
import type { PublicPlanProjection } from './public-plan-presentation';

const CACHE_MS = 60_000;
let cached: { expiresAt: number; value: PublicPlanProjection } | null = null;
let inFlight: Promise<PublicPlanProjection> | null = null;

function isProjection(value: unknown): value is PublicPlanProjection {
  const candidate = value as PublicPlanProjection;
  return candidate?.version === 1 && Array.isArray(candidate.plans) && candidate.plans.length === 3;
}

export function loadPublicPlanProjection(signal?: AbortSignal) {
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  if (inFlight) return inFlight;
  inFlight = safeJsonFetch<{ success: true; data: PublicPlanProjection }>(API_ROUTES.publicPlans, { signal })
    .then((response) => {
      if (!response.success) throw new Error(('error' in response && response.error) || 'Current plan limits are unavailable.');
      const value = response.data.data;
      if (!isProjection(value)) throw new Error('Current plan limits are invalid.');
      cached = { expiresAt: Date.now() + CACHE_MS, value };
      return value;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

export function clearPublicPlanProjectionCache() {
  cached = null;
  inFlight = null;
}
