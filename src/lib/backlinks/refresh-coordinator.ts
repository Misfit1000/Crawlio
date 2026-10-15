import './server-only';
import { randomUUID } from 'node:crypto';
import { requireSupabaseAdminClient } from '../supabase/server';
import type { DomainEvidenceCacheRow } from './domain-evidence-cache';

export interface EvidenceRefreshClaim {
  state: 'claimed' | 'fresh' | 'busy' | 'cooldown';
  cache?: unknown;
  openPageRankAllowed?: boolean;
  reason?: 'monthly_budget' | 'minute_budget';
}
export interface EvidenceRefreshCoordinator {
  claim(domain: string, owner: string, includeOpenPageRank: boolean): Promise<EvidenceRefreshClaim>;
  finish(domain: string, owner: string, row: DomainEvidenceCacheRow | null, retrySeconds: number): Promise<boolean>;
}
export const evidenceRefreshOwner = randomUUID;
export const supabaseEvidenceRefreshCoordinator: EvidenceRefreshCoordinator = {
  async claim(domain, owner, includeOpenPageRank) {
    const { data, error } = await requireSupabaseAdminClient().rpc('claim_domain_evidence_refresh', {
      p_domain: domain, p_owner: owner, p_include_opr: includeOpenPageRank,
    }).abortSignal(AbortSignal.timeout(2_000));
    if (error || !data || !['claimed', 'fresh', 'busy', 'cooldown'].includes(data.state)) throw new Error('Domain evidence coordination is unavailable.');
    return data as EvidenceRefreshClaim;
  },
  async finish(domain, owner, row, retrySeconds) {
    const { data, error } = await requireSupabaseAdminClient().rpc('finish_domain_evidence_refresh', {
      p_domain: domain, p_owner: owner, p_row: row, p_retry_seconds: retrySeconds,
    }).abortSignal(AbortSignal.timeout(2_000));
    if (error) throw new Error('Domain evidence settlement is unavailable.');
    return data === true;
  },
};
