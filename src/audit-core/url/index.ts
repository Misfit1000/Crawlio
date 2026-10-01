import { normalizeUrl, isSameDomain, stripTrackingParams, normalizeUserUrl, normalizeDomainInput } from '../../lib/seo/url-utils';

export {
  normalizeUrl,
  isSameDomain,
  stripTrackingParams,
  normalizeUserUrl,
  normalizeDomainInput,
};

export function normalizeCrawlUrl(input: string, base?: string): string | null {
  const normalized = normalizeUrl(input, base ?? input);
  if (!normalized) return null;
  try {
    const url = new URL(stripTrackingParams(normalized));
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}
