import './server-only';
import { normalizeUserUrl } from '../seo/url-utils';
import type { MajesticEvidence, OpenPageRankEvidence, OpenPageRankHistoryPoint, TrancoEvidence, WebRankHistoryPoint } from './types';

export const OPEN_PAGE_RANK_SOURCE_URL = 'https://openpagerank.keywordseverywhere.com/docs' as const;
const MAX_HISTORY_POINTS = 600;

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Provider response format was not recognized.');
  return value as Record<string, unknown>;
}

export function normalizeEvidenceDomain(value: string) {
  const target = normalizeUserUrl(value.trim().replace(/\.$/, ''));
  const domain = target.hostname.replace(/^www\./, '');
  if (!target.isValid || domain.length > 253 || !/[a-z]/i.test(domain) || domain.includes(':')) {
    throw new Error('Enter a valid public domain.');
  }
  return domain;
}

function providerDomain(value: unknown) {
  if (typeof value !== 'string' || !/^[a-z0-9.-]+$/i.test(value)) throw new Error('Provider domain was invalid.');
  return normalizeEvidenceDomain(value);
}

export function dateOnly(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new Error('Provider dataset date was invalid.');
  }
  return value;
}

export function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('Provider fetch date was invalid.');
  }
  return new Date(value).toISOString();
}

function score(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10) throw new Error('Provider score was invalid.');
  return value;
}

function count(value: unknown, minimum = 0): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error('Provider count was invalid.');
  return value;
}

function oprHistory(value: unknown, datasetDate: string): OpenPageRankHistoryPoint[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_HISTORY_POINTS) throw new Error('Provider history was invalid.');
  const seen = new Set<string>();
  return value.map(item => {
    const point = object(item);
    const date = dateOnly(point.date);
    if (date > datasetDate || seen.has(date) || typeof point.estimated !== 'boolean') throw new Error('Provider history was invalid.');
    seen.add(date);
    return { date, score: score(point.open_page_rank), estimated: point.estimated };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

export function emptyOpenPageRank(domain: string, status: 'not_configured' | 'unavailable'): OpenPageRankEvidence {
  return {
    source: 'Open PageRank', sourceUrl: OPEN_PAGE_RANK_SOURCE_URL, domain, status,
    scope: 'domain', fetchedAt: null, datasetDate: null, score: null, scale: 10,
    rank: null, referringDomains: null, referringHosts: null,
    referringCountDefinition: 'authority_weighted_domains', estimated: null, history: [],
  };
}

export function parseOpenPageRankResponse(value: unknown, requestedDomain: string, fetchedAt = new Date().toISOString()): OpenPageRankEvidence {
  const domain = normalizeEvidenceDomain(requestedDomain);
  const body = object(value);
  const datasetDate = dateOnly(body.as_of);
  const fetchDate = timestamp(fetchedAt);
  if (datasetDate > fetchDate.slice(0, 10)) throw new Error('Provider dataset date was in the future.');
  if (!Array.isArray(body.results) || body.results.length > 100) throw new Error('Provider response format was not recognized.');
  const rows = body.results.map(object);
  // Exact hosts take precedence, including private-suffix tenants such as project.github.io.
  const hosts = rows.flatMap(row => {
    if (row.hosts === undefined) return [];
    if (!Array.isArray(row.hosts) || row.hosts.length > 100) throw new Error('Provider host data was invalid.');
    return row.hosts.map(object);
  }).filter(host => providerDomain(host.host) === domain);
  const domains = rows.filter(row => providerDomain(row.domain) === domain);
  if (hosts.length > 1 || domains.length > 1) throw new Error('Provider returned duplicate domain evidence.');
  const row = hosts[0] ?? domains[0];
  if (!row) throw new Error('Provider returned no exact domain or host evidence.');
  const scope = hosts.length ? 'host' : 'domain';
  if (typeof row.found !== 'boolean') throw new Error('Provider found flag was invalid.');
  const history = oprHistory(row.history, datasetDate);
  if (!row.found && (row.open_page_rank != null || row.rank != null || row.referring_domains != null || row.referring_hosts != null || history.length)) {
    throw new Error('Provider absence conflicted with measured evidence.');
  }
  const currentEstimate = history.find(point => point.date === datasetDate)?.estimated ?? null;
  return {
    ...emptyOpenPageRank(domain, 'unavailable'), status: row.found ? 'measured' : 'not_listed',
    scope, fetchedAt: fetchDate, datasetDate,
    score: row.found ? score(row.open_page_rank) : null,
    rank: row.found ? count(row.rank, 1) : null,
    referringDomains: row.found && scope === 'domain' ? count(row.referring_domains) : null,
    referringHosts: row.found && scope === 'host' ? count(row.referring_hosts) : null,
    referringCountDefinition: scope === 'host' ? 'authority_filtered_hosts' : 'authority_weighted_domains',
    estimated: currentEstimate, history,
  };
}

export function parseTrancoEvidence(value: unknown, requestedDomain: string, fetchedAt = new Date().toISOString()): TrancoEvidence {
  const domain = normalizeEvidenceDomain(requestedDomain);
  const body = object(value);
  const fetchDate = timestamp(fetchedAt);
  if (!Array.isArray(body.ranks) || body.ranks.length > 366) throw new Error('Web rank provider response format was not recognized.');
  if (body.domain !== undefined && providerDomain(body.domain) !== domain) throw new Error('Web rank provider returned a different domain.');
  const seen = new Set<string>();
  const history: WebRankHistoryPoint[] = body.ranks.map(item => {
    const row = object(item);
    const date = dateOnly(row.date);
    const rank = count(row.rank, 1);
    if (rank == null || seen.has(date) || date > fetchDate.slice(0, 10)) throw new Error('Web rank history was invalid.');
    seen.add(date);
    return { date, rank };
  }).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 31);
  if (history.length && body.domain === undefined) throw new Error('Web rank provider did not identify its measured domain.');
  return { domain, status: history.length ? 'measured' : 'not_listed', history, scope: 'domain', fetchedAt: fetchDate, datasetDate: history[0]?.date ?? null };
}

// Stored JSON is untrusted too. Rebuild only successful, validated provider fields.
export function allowlistOpenPageRank(value: unknown, domain: string): OpenPageRankEvidence {
  const row = object(value);
  if (row.domain !== domain || !['measured', 'not_listed'].includes(String(row.status)) || !['domain', 'host'].includes(String(row.scope))) {
    throw new Error('Cached Open PageRank evidence was invalid.');
  }
  if (!Array.isArray(row.history)) throw new Error('Cached history was invalid.');
  const providerRow = {
    domain, host: domain, found: row.status === 'measured', open_page_rank: row.score,
    rank: row.rank, referring_domains: row.referringDomains, referring_hosts: row.referringHosts,
    history: row.history.map(item => { const point = object(item); return { date: point.date, open_page_rank: point.score, estimated: point.estimated }; }),
  };
  return parseOpenPageRankResponse({ as_of: row.datasetDate, results: [row.scope === 'host' ? { domain, hosts: [providerRow] } : providerRow] }, domain, timestamp(row.fetchedAt));
}

export function allowlistTranco(value: unknown, domain: string): TrancoEvidence {
  const row = object(value);
  if (row.domain !== domain || !['measured', 'not_listed'].includes(String(row.status))) throw new Error('Cached Tranco evidence was invalid.');
  const result = parseTrancoEvidence({ domain, ranks: row.history }, domain, timestamp(row.fetchedAt));
  if (result.status !== row.status) throw new Error('Cached Tranco status was invalid.');
  return result;
}

export function allowlistMajestic(value: unknown, domain: string): MajesticEvidence {
  const row = object(value);
  if (row.domain !== domain || !['measured','not_listed'].includes(String(row.status)) || row.scope !== 'public_top_million'
    || typeof row.found !== 'boolean' || row.found !== (row.status === 'measured')) throw new Error('Cached Majestic evidence was invalid.');
  const found = row.found;
  const result: MajesticEvidence = { domain, scope: 'public_top_million', status: found ? 'measured' : 'not_listed', found,
    fetchedAt: timestamp(row.fetchedAt), datasetDate: row.datasetDate == null ? null : dateOnly(row.datasetDate),
    globalRank: count(row.globalRank,1), tldRank: count(row.tldRank,1),
    referringSubnets: count(row.referringSubnets), referringIps: count(row.referringIps) };
  if ((found && [result.globalRank,result.tldRank,result.referringSubnets,result.referringIps].some(value=>value==null))
    || (!found && [result.globalRank,result.tldRank,result.referringSubnets,result.referringIps].some(value=>value!=null))) throw new Error('Cached Majestic evidence conflicted with its status.');
  return result;
}
