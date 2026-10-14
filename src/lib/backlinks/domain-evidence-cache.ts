import './server-only';
import { getSupabaseAdminClient } from '../supabase/server';
import { allowlistMajestic, allowlistOpenPageRank, allowlistTranco, object, timestamp } from './provider-evidence';
import type { MajesticEvidence, OpenPageRankEvidence, TrancoEvidence } from './types';

export const EVIDENCE_FRESH_MS = 24 * 60 * 60 * 1000;
export const EVIDENCE_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export interface DomainEvidencePayload {
  version: 1;
  openPageRank?: OpenPageRankEvidence;
  tranco?: TrancoEvidence;
  majestic?: MajesticEvidence;
}

export interface DomainEvidenceCacheRow {
  domain: string;
  payload: DomainEvidencePayload;
  fetched_at: string;
  fresh_until: string;
  stale_until: string;
}

export interface DomainEvidenceCacheStore {
  read(domain: string): Promise<unknown>;
  write(row: DomainEvidenceCacheRow): Promise<void>;
}

export function allowlistEvidencePayload(value: unknown, domain: string, now: number): DomainEvidencePayload {
  const payload = object(value);
  if (payload.version !== 1) throw new Error('Cached domain evidence version was invalid.');
  const result: DomainEvidencePayload = { version: 1 };
  for (const provider of ['openPageRank', 'tranco', 'majestic'] as const) {
    if (payload[provider] === undefined) continue;
    try {
      const evidence = provider === 'openPageRank'
        ? allowlistOpenPageRank(payload[provider], domain) : provider === 'tranco' ? allowlistTranco(payload[provider], domain) : allowlistMajestic(payload[provider],domain);
      const fetched = Date.parse(evidence.fetchedAt!);
      if (fetched > now || fetched + EVIDENCE_STALE_MS <= now) continue;
      if (provider === 'openPageRank') result.openPageRank = evidence as OpenPageRankEvidence;
      else if (provider === 'tranco') result.tranco = evidence as TrancoEvidence;
      else result.majestic = evidence as MajesticEvidence;
    } catch {
      // One malformed source must not discard an independently valid source.
    }
  }
  return result;
}

export function makeEvidenceCacheRow(domain: string, payload: DomainEvidencePayload, now: number): DomainEvidenceCacheRow | null {
  const safePayload = allowlistEvidencePayload(payload, domain, now);
  const fetched = [safePayload.openPageRank, safePayload.tranco, safePayload.majestic].flatMap(item => item?.fetchedAt ? [Date.parse(item.fetchedAt)] : []);
  if (!fetched.length) return null;
  return {
    domain, payload: safePayload,
    fetched_at: new Date(Math.max(...fetched)).toISOString(),
    fresh_until: new Date(Math.min(...fetched) + EVIDENCE_FRESH_MS).toISOString(),
    stale_until: new Date(Math.max(...fetched) + EVIDENCE_STALE_MS).toISOString(),
  };
}

export function readEvidenceCacheRow(value: unknown, domain: string, now: number): DomainEvidencePayload | null {
  try {
    const row = object(value);
    if (row.domain !== domain) return null;
    const fetched = Date.parse(timestamp(row.fetched_at));
    const fresh = Date.parse(timestamp(row.fresh_until));
    const stale = Date.parse(timestamp(row.stale_until));
    if (fetched > now || fresh > fetched + EVIDENCE_FRESH_MS || stale > fetched + EVIDENCE_STALE_MS
      || fresh > stale || stale <= now) return null;
    return allowlistEvidencePayload(row.payload, domain, now);
  } catch {
    return null;
  }
}

export const supabaseDomainEvidenceCache: DomainEvidenceCacheStore = {
  async read(domain) {
    const client = getSupabaseAdminClient();
    if (!client) return null;
    const { data, error } = await client.schema('public').from('domain_evidence_cache')
      .select('domain,payload,fetched_at,fresh_until,stale_until').eq('domain', domain)
      .abortSignal(AbortSignal.timeout(2_000)).maybeSingle();
    if (error) throw new Error('Domain evidence cache read failed.');
    return data;
  },
  async write(row) {
    const client = getSupabaseAdminClient();
    if (!client) return;
    const { error } = await client.schema('public').from('domain_evidence_cache')
      .upsert(row, { onConflict: 'domain' }).abortSignal(AbortSignal.timeout(2_000));
    if (error) throw new Error('Domain evidence cache write failed.');
  },
};
