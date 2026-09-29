import type { AuditMode } from './audit-config';

export const SCALABLE_PROCESSING_VERSION = 2;
export const CUSTOMER_PAGE_CEILING = 500;
export const ADMIN_PAGE_CEILING = 5000;
export const ADMIN_PAGE_DEFAULT = 1000;
export const CRAWL_SLICE_PAGES = 50;
export const CRAWL_SLICE_MS = 60_000;
export const EVIDENCE_PAGE_SIZE = 50;
export const EVIDENCE_MAX_PAGE_SIZE = 100;

export function planPageCeiling(plan: string) {
  return plan === 'admin' ? ADMIN_PAGE_CEILING : CUSTOMER_PAGE_CEILING;
}

export function crawlCandidateLimit(pageLimit: number, mode: AuditMode) {
  return Math.min(20_000, pageLimit * (mode === 'quick' ? 2 : 4));
}

export function processingBudgetMs(plan: string) {
  return (plan === 'admin' ? 12 : 2) * 60 * 60_000;
}

export function retryDelayMs(retryAfter: string | undefined, attempt: number, now = Date.now()) {
  const seconds = Number(retryAfter);
  const specified = retryAfter ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now) : 0;
  return Math.max(1000, Math.min(15 * 60_000, Math.max(Number.isFinite(specified) ? specified : 0, 1000 * 2 ** Math.min(attempt, 8))));
}
