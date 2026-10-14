import './server-only';
import { fetchProviderJson } from './provider-http';
import { normalizeEvidenceDomain, parseOpenPageRankResponse } from './provider-evidence';

export const OPEN_PAGE_RANK_ENDPOINT = 'https://openpagerank.keywordseverywhere.com/v1/domains/bulk';

export async function fetchOpenPageRank(domainInput: string, apiKey: string) {
  const domain = normalizeEvidenceDomain(domainInput);
  const value = await fetchProviderJson(OPEN_PAGE_RANK_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ domains: [domain], include_history: true }),
  });
  return parseOpenPageRankResponse(value, domain);
}
