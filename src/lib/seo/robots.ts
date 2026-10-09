import type { SafePublicFetchOptions } from '../security/safe-public-fetch';
import { createRobotsFetchEvidence, ROBOTS_MAX_BYTES, type RobotsFetchEvidence } from './robots-evaluator';

export * from './robots-evaluator';

async function fetchRobotsResponse(origin: string, options: SafePublicFetchOptions) {
  const url = new URL('/robots.txt', origin).toString();
  const { safePublicFetch } = await import('../security/safe-public-fetch');
  return safePublicFetch(url, {
    ...options,
    timeoutMs: options.timeoutMs ?? 5_000,
    maxBytes: Math.min(options.maxBytes ?? ROBOTS_MAX_BYTES, ROBOTS_MAX_BYTES),
    allowedContentTypes: ['text/plain', 'text/html'],
    returnBuffer: false,
  });
}

/** One server fetch; callers can persist raw evidence and reuse document for page checks. */
export async function fetchRobotsEvidence(origin: string, options: SafePublicFetchOptions = {}): Promise<RobotsFetchEvidence> {
  let url: string | undefined;
  try {
    url = new URL('/robots.txt', origin).toString();
    const response = await fetchRobotsResponse(origin, options);
    return createRobotsFetchEvidence({ status: response.status, body: response.body, url, fetchedAt: new Date().toISOString() });
  } catch {
    return createRobotsFetchEvidence({ url, error: true, fetchedAt: new Date().toISOString() });
  }
}

/** Legacy string wrapper keeps its original 512,000-byte success/failure behavior. */
export async function fetchRobotsTxt(origin: string, options: SafePublicFetchOptions = {}): Promise<string> {
  try {
    const response = await fetchRobotsResponse(origin, options);
    if (response.status >= 200 && response.status < 300) return response.body;
  } catch { /* Preserve the legacy fallback; evidence callers retain the failure state. */ }
  return '';
}
