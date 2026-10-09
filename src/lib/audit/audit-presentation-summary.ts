import type { AuditPresentationSummary } from './resource-types';

export const AUDIT_PRESENTATION_SECTIONS = Object.freeze([
  'on-page', 'technical', 'crawlability', 'internal-links', 'performance',
  'mobile', 'security', 'structured-data', 'accessibility',
] as const);

export type AuditPresentationSection = typeof AUDIT_PRESENTATION_SECTIONS[number];

export function isAuditPresentationSection(value: string): value is AuditPresentationSection {
  return (AUDIT_PRESENTATION_SECTIONS as readonly string[]).includes(value);
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const measurement = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// Missing or partial historical aggregates must never be promoted to complete coverage.
export function readAuditPresentationSummary(value: unknown): AuditPresentationSummary | undefined {
  if (!record(value) || value.version !== 1 || value.scope !== 'complete') return undefined;
  if (!['analysedPages', 'attemptedPages', 'pagesWithFindings'].every(key => count(value[key]))) return undefined;
  const outcomes = value.responseOutcomes;
  const delivery = value.delivery;
  if (!record(outcomes) || !['success', 'redirect', 'clientError', 'serverError', 'unavailable'].every(key => count(outcomes[key]))) return undefined;
  if (!record(delivery) || !count(delivery.count) || !measurement(delivery.totalResponseMs) || !measurement(delivery.totalBytes)) return undefined;
  for (const key of ['averageResponseMs', 'averagePageBytes']) {
    if (delivery[key] !== null && !measurement(delivery[key])) return undefined;
    if (delivery.count === 0 && delivery[key] !== null) return undefined;
    if (delivery.count > 0 && delivery[key] === null) return undefined;
  }
  if (!record(value.depthCounts) || !Object.entries(value.depthCounts).every(([key, n]) => /^(?:0|[1-9]\d?)$|^100$/.test(key) && count(n))) return undefined;
  if (!record(value.findingsBySection) || !Object.entries(value.findingsBySection).every(([key, n]) => isAuditPresentationSection(key) && count(n))) return undefined;
  if (Number(value.analysedPages) > Number(value.attemptedPages) || Number(value.pagesWithFindings) > Number(value.attemptedPages) || delivery.count > Number(value.analysedPages)) return undefined;
  if (Object.values(outcomes).reduce<number>((sum, n) => sum + (n as number), 0) !== value.attemptedPages) return undefined;
  if (Object.values(value.depthCounts).reduce<number>((sum, n) => sum + (n as number), 0) !== value.attemptedPages) return undefined;
  if (!Array.isArray(value.topRecommendations) || value.topRecommendations.length > 10 || !value.topRecommendations.every(item =>
    record(item) && ['key', 'title', 'category', 'recommendation'].every(key => typeof item[key] === 'string')
      && ['critical', 'high', 'medium', 'low', 'info'].includes(String(item.severity)) && count(item.affectedPages))) return undefined;
  if (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return undefined;
  return value as unknown as AuditPresentationSummary;
}
