import './server-only';
import { load } from 'cheerio';
import { EVIDENCE_FRESH_MS, EVIDENCE_STALE_MS, makeEvidenceCacheRow, readEvidenceCacheRow, supabaseDomainEvidenceCache, type DomainEvidenceCacheStore, type DomainEvidencePayload } from './domain-evidence-cache';
import { fetchOpenPageRank } from './open-page-rank';
import { evidenceRefreshOwner, supabaseEvidenceRefreshCoordinator, type EvidenceRefreshCoordinator } from './refresh-coordinator';
import { allowlistMajestic, allowlistOpenPageRank, allowlistTranco, emptyOpenPageRank, normalizeEvidenceDomain, parseTrancoEvidence } from './provider-evidence';
import { boundedResponseText, fetchProviderJson, PROVIDER_TIMEOUT_MS } from './provider-http';
import type { MajesticEvidence, OpenPageRankEvidence, ProviderEvidenceSummary, PublicLinkSignals, TrancoEvidence } from './types';

const LINK_PROVIDER_ORIGIN = 'https://majestic.com';
const LINK_PROVIDER_PATH = '/reports/majestic-million';
const RANK_PROVIDER_ORIGIN = 'https://tranco-list.eu';
const MAX_CACHE_ENTRIES = 2_000;
const MAX_IN_FLIGHT = 64;
const ERROR_RETRY_MS = 60_000;
const RANK_PROVIDER_INTERVAL_MS = 1_050;

interface BacklinkSnapshot {
  domain: string;
  found: boolean;
  globalRank: number | null;
  tldRank: number | null;
  referringSubnets: number | null;
  referringIps: number | null;
  datasetDate: string | null;
  fetchedAt: string;
  source: 'Majestic Million';
  sourceUrl: string;
  license: 'CC BY 3.0';
  scope: 'public_top_million';
}

function firstInteger(value: string) {
  const match = value.match(/[\d,]+/);
  const parsed = match ? Number(match[0].replace(/,/g, '')) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function parseMajesticMillionPage(html: string, requestedDomain: string, fetchedAt = new Date().toISOString()): BacklinkSnapshot {
  const domain = normalizeEvidenceDomain(requestedDomain);
  const $ = load(html);
  const pageText = $.root().text().replace(/\s+/g, ' ');
  const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const absencePattern = new RegExp(`(?:^|[^a-z0-9.-])(?:www\\.)?${escapedDomain}\\s+is not in the Majestic Million`, 'i');
  const explicitlyAbsent = absencePattern.test(pageText) || $('p,div,td,li').toArray()
    .some(element => absencePattern.test($(element).text().replace(/\s+/g, ' ')));
  if (!pageText.includes('Majestic Million') || (!explicitlyAbsent && !pageText.includes('Referring Sub'))) {
    throw new Error('Link provider response format was not recognized.');
  }
  const datasetDate = pageText.match(/Top Million Root Domains List generated on\s+(.+?)\s+using data/i)?.[1]?.trim() || null;
  let matchingRow: ReturnType<ReturnType<typeof load>> | null = null;
  $('a.domainname').each((_index, element) => {
    if (matchingRow) return;
    if ($(element).text().trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '') === domain) matchingRow = $(element).closest('tr');
  });
  const base = {
    domain, datasetDate, fetchedAt, source: 'Majestic Million' as const,
    sourceUrl: `${LINK_PROVIDER_ORIGIN}${LINK_PROVIDER_PATH}`, license: 'CC BY 3.0' as const, scope: 'public_top_million' as const,
  };
  if (!matchingRow) {
    if (!explicitlyAbsent) throw new Error('Link provider returned no matching row; absence was not established.');
    return { ...base, found: false, globalRank: null, tldRank: null, referringSubnets: null, referringIps: null };
  }
  if (explicitlyAbsent) throw new Error('Link provider returned conflicting presence evidence.');
  const cells = matchingRow.children('td').map((_index, cell) => $(cell).text().replace(/\s+/g, ' ').trim()).get();
  if (cells.length < 7) throw new Error('Link provider result row was incomplete.');
  const globalRank = firstInteger(cells[0]);
  const tldRank = firstInteger(cells[4]);
  const referringSubnets = firstInteger(cells[5]);
  const referringIps = firstInteger(cells[6]);
  if (globalRank == null || globalRank < 1 || tldRank == null || tldRank < 1 || referringSubnets == null || referringIps == null) {
    throw new Error('Link provider result row was invalid.');
  }
  return { ...base, found: true, globalRank, tldRank, referringSubnets, referringIps };
}

export function parseTrancoRankResponse(value: unknown, requestedDomain: string) {
  const result = parseTrancoEvidence(value, requestedDomain);
  return { domain: result.domain, status: result.status === 'measured' ? 'measured' as const : 'not_ranked' as const, history: result.history };
}

let rankProviderQueue: Promise<void> = Promise.resolve();
let lastRankProviderRequestAt = 0;

async function fetchWebRankSnapshot(domain: string) {
  const deadline = Date.now() + 15_000;
  const request = rankProviderQueue.catch(() => undefined).then(async () => {
    const delay = Math.max(0, RANK_PROVIDER_INTERVAL_MS - (Date.now() - lastRankProviderRequestAt));
    if (Date.now() + delay + PROVIDER_TIMEOUT_MS >= deadline) throw new Error('Rank provider queue is busy.');
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (Date.now() + PROVIDER_TIMEOUT_MS >= deadline) throw new Error('Rank provider queue timed out.');
    lastRankProviderRequestAt = Date.now();
    const url = new URL(`/api/ranks/domain/${encodeURIComponent(domain)}`, RANK_PROVIDER_ORIGIN);
    return parseTrancoEvidence(await fetchProviderJson(url.toString()), domain);
  });
  rankProviderQueue = request.then(() => undefined, () => undefined);
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([request, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Rank provider queue timed out.')), 15_000); })]); }
  finally { clearTimeout(timer!); }
}

function summary(evidence: ProviderEvidenceSummary): ProviderEvidenceSummary {
  return { status: evidence.status, fetchedAt: evidence.fetchedAt, datasetDate: evidence.datasetDate, scope: evidence.scope };
}
async function fetchMajesticEvidence(domain: string): Promise<MajesticEvidence> {
  const url = new URL(LINK_PROVIDER_PATH, LINK_PROVIDER_ORIGIN);
  url.searchParams.set('domain',domain); url.searchParams.set('majesticMillionType','2');
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),6000);
  try {
    const response = await fetch(url,{redirect:'error',signal:controller.signal,headers:{Accept:'text/html','User-Agent':'Crawlio/1.0 (public domain evidence)'}});
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) { await response.body?.cancel(); throw new Error('Majestic unavailable'); }
    const record = parseMajesticMillionPage(await boundedResponseText(response,2*1024*1024),domain);
    const date = record.datasetDate == null ? null : new Date(record.datasetDate);
    return allowlistMajestic({...record,status:record.found?'measured':'not_listed',datasetDate:date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0,10) : null},domain);
  } finally { clearTimeout(timer); }
}

function publicSignals(domain: string, opr: OpenPageRankEvidence, tranco: TrancoEvidence, majestic: MajesticEvidence, now: number): PublicLinkSignals {
  const current = tranco.history[0]?.rank ?? null;
  const previous = tranco.history.length > 1 ? tranco.history[tranco.history.length - 1].rank : null;
  return {
    domain, found: majestic.found, globalRank: majestic.globalRank, tldRank: majestic.tldRank, referringSubnets: majestic.referringSubnets, referringIps: majestic.referringIps,
    datasetDate: majestic.datasetDate, fetchedAt: new Date(now).toISOString(), source: 'Majestic Million',
    sourceUrl: `${LINK_PROVIDER_ORIGIN}${LINK_PROVIDER_PATH}`, license: 'CC BY 3.0', scope: 'public_top_million',
    linkStatus: majestic.status === 'unavailable' ? 'unavailable' : majestic.found ? 'measured' : 'not_ranked', webRankStatus: tranco.status === 'unavailable' ? 'unavailable' : tranco.history.length ? 'measured' : 'not_ranked',
    webRank: current, previousWebRank: previous, webRankChange: current != null && previous != null ? previous - current : null,
    webRankHistory: tranco.history,
    partial: [opr.status,tranco.status,majestic.status].some(status=>status==='unavailable'||status==='stale'),
    attributions: [
      { label: 'Open PageRank', url: opr.sourceUrl },
      { label: 'Majestic Million', url: `${LINK_PROVIDER_ORIGIN}${LINK_PROVIDER_PATH}`, license: 'CC BY 3.0' },
      { label: 'Tranco', url: 'https://tranco-list.eu/' },
    ],
    openPageRank: opr,
    sources: {
      openPageRank: summary(opr), tranco: summary(tranco),
      majesticMillion: summary(majestic),
    },
  };
}

interface DomainEvidenceServiceOptions {
  store?: DomainEvidenceCacheStore;
  coordinator?: EvidenceRefreshCoordinator;
  now?: () => number;
  apiKey?: () => string | undefined;
  openPageRank?: (domain: string, key: string) => Promise<OpenPageRankEvidence>;
  tranco?: (domain: string) => Promise<TrancoEvidence>;
  majestic?: (domain: string) => Promise<MajesticEvidence>;
  maxCacheEntries?: number;
  maxInFlight?: number;
}

export function createDomainEvidenceService(options: DomainEvidenceServiceOptions = {}) {
  const store = options.store ?? supabaseDomainEvidenceCache;
  const now = options.now ?? Date.now;
  const apiKey = options.apiKey ?? (() => process.env.OPEN_PAGE_RANK_API_KEY);
  const coordinator = options.coordinator ?? (options.store ? undefined : supabaseEvidenceRefreshCoordinator);
  const memory = new Map<string, { payload: DomainEvidencePayload; response: PublicLinkSignals; retryUntil: number; configured: boolean }>();
  const inFlight = new Map<string, Promise<PublicLinkSignals>>();

  async function loadSignals(domain: string, key: string) {
    const at = now();
    let payload = memory.get(domain)?.payload;
    if (!payload) {
      try { payload = readEvidenceCacheRow(await store.read(domain), domain, at) ?? { version: 1 }; }
      catch { payload = { version: 1 }; }
    }
    let claim: Awaited<ReturnType<EvidenceRefreshCoordinator['claim']>> | undefined;
    let refreshAvailability: PublicLinkSignals['refreshAvailability'];
    const owner = evidenceRefreshOwner();
    const sourceFresh = (source?: ProviderEvidenceSummary) => source?.fetchedAt != null && Date.parse(source.fetchedAt) + EVIDENCE_FRESH_MS > at;
    const needsRefresh = !sourceFresh(payload.tranco) || !sourceFresh(payload.majestic) || Boolean(key && !sourceFresh(payload.openPageRank));
    if (coordinator && needsRefresh) {
      try {
        claim = await coordinator.claim(domain, owner, Boolean(key));
        payload = readEvidenceCacheRow(claim.cache, domain, at) ?? payload;
        refreshAvailability = claim.reason ?? (claim.state === 'busy' || claim.state === 'cooldown' ? 'refresh_in_progress' : undefined);
      } catch { refreshAvailability = 'coordination_unavailable'; }
    }
    const canRefresh = !coordinator || !needsRefresh || claim?.state === 'claimed';
    const fresh = (evidence?: ProviderEvidenceSummary) => evidence?.fetchedAt != null && Date.parse(evidence.fetchedAt) + EVIDENCE_FRESH_MS > at;
    const usableStale = (evidence?: ProviderEvidenceSummary) => evidence?.fetchedAt != null && Date.parse(evidence.fetchedAt) + EVIDENCE_STALE_MS > now();
    const results = await Promise.allSettled([
      !key ? Promise.resolve(emptyOpenPageRank(domain, 'not_configured')) : fresh(payload.openPageRank)
        ? Promise.resolve(payload.openPageRank!) : canRefresh && (!coordinator || claim?.openPageRankAllowed)
          ? (options.openPageRank ?? fetchOpenPageRank)(domain, key).then(value => allowlistOpenPageRank(value, domain)) : Promise.reject(new Error('Provider refresh deferred.')),
      fresh(payload.tranco) ? Promise.resolve(payload.tranco!) : canRefresh ? (options.tranco ?? fetchWebRankSnapshot)(domain).then(value => allowlistTranco(value, domain)) : Promise.reject(new Error('Provider refresh deferred.')),
      fresh(payload.majestic) ? Promise.resolve(payload.majestic!) : canRefresh ? (options.majestic ?? fetchMajesticEvidence)(domain).then(value=>allowlistMajestic(value,domain)) : Promise.reject(new Error('Provider refresh deferred.')),
    ]);
    const [oprResult, rankResult, majesticResult] = results;
    const opr: OpenPageRankEvidence = oprResult.status === 'fulfilled' ? oprResult.value
      : usableStale(payload.openPageRank) ? { ...payload.openPageRank!, status: 'stale' } : emptyOpenPageRank(domain, 'unavailable');
    const tranco: TrancoEvidence = rankResult.status === 'fulfilled' ? rankResult.value
      : usableStale(payload.tranco) ? { ...payload.tranco!, status: 'stale' }
        : { domain, status: 'unavailable', scope: 'domain', fetchedAt: null, datasetDate: null, history: [] };
    const next: DomainEvidencePayload = { version: 1 };
    const majestic: MajesticEvidence = majesticResult.status === 'fulfilled' ? majesticResult.value
      : usableStale(payload.majestic) ? {...payload.majestic!,status:'stale'}
      : {domain,status:'unavailable',scope:'public_top_million',found:false,fetchedAt:null,datasetDate:null,globalRank:null,tldRank:null,referringSubnets:null,referringIps:null};
    if (majesticResult.status === 'fulfilled') next.majestic=majestic;
    else if(usableStale(payload.majestic)) next.majestic=payload.majestic;
    if (oprResult.status === 'fulfilled' && opr.status !== 'not_configured') next.openPageRank = opr;
    else if (usableStale(payload.openPageRank)) next.openPageRank = payload.openPageRank;
    if (rankResult.status === 'fulfilled') next.tranco = tranco;
    else if (usableStale(payload.tranco)) next.tranco = payload.tranco;
    const row = makeEvidenceCacheRow(domain, next, now());
    const changed = (oprResult.status === 'fulfilled' && opr.fetchedAt !== payload.openPageRank?.fetchedAt)
      || (rankResult.status === 'fulfilled' && tranco.fetchedAt !== payload.tranco?.fetchedAt)
      || (majesticResult.status === 'fulfilled' && majestic.fetchedAt !== payload.majestic?.fetchedAt);
    if (coordinator && claim?.state === 'claimed') {
      try { await coordinator.finish(domain, owner, changed ? row : null, results.some(result => result.status === 'rejected') ? 60 : 0); }
      catch { /* Fenced cache writes may fail without changing already measured evidence. */ }
    } else if (!coordinator && row && changed) {
      try { await store.write(row); } catch { /* Provider evidence remains usable during cache outages. */ }
    }
    const response = publicSignals(domain, opr, tranco, majestic, now());
    if (refreshAvailability) response.refreshAvailability = refreshAvailability;
    memory.delete(domain);
    while (memory.size >= Math.max(1, options.maxCacheEntries ?? MAX_CACHE_ENTRIES)) memory.delete(memory.keys().next().value!);
    memory.set(domain, { payload: row?.payload ?? { version: 1 }, response, retryUntil: now() + (refreshAvailability === 'refresh_in_progress' ? 5_000 : ERROR_RETRY_MS), configured: Boolean(key) });
    return response;
  }

  return async function getSignals(domainInput: string): Promise<PublicLinkSignals> {
    const domain = normalizeEvidenceDomain(domainInput);
    const current = inFlight.get(domain);
    if (current) return structuredClone(await current);
    const key = apiKey()?.trim() ?? '';
    const existing = memory.get(domain);
    const evidence = existing ? [existing.response.openPageRank!, existing.response.sources!.tranco, existing.response.sources!.majesticMillion] : [];
    const stillUsable = evidence.every(item => !item.fetchedAt || Date.parse(item.fetchedAt) + EVIDENCE_STALE_MS > now());
    const allFresh = evidence.every(item => item.status === 'not_configured' || (item.fetchedAt && Date.parse(item.fetchedAt) + EVIDENCE_FRESH_MS > now()));
    const retryEligible = evidence.every(item => ['unavailable', 'not_configured', 'stale'].includes(item.status)
      || (item.fetchedAt && Date.parse(item.fetchedAt) + EVIDENCE_FRESH_MS > now()));
    if (existing && existing.configured === Boolean(key) && stillUsable && (allFresh || (retryEligible && existing.retryUntil > now()))) {
      return structuredClone(existing.response);
    }
    if (inFlight.size >= Math.max(1, options.maxInFlight ?? MAX_IN_FLIGHT)) throw new Error('Domain evidence request capacity reached.');
    const request = loadSignals(domain, key).finally(() => inFlight.delete(domain));
    inFlight.set(domain, request);
    return structuredClone(await request);
  };
}

export const getPublicLinkSignals = createDomainEvidenceService();
