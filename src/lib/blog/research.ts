import { load } from 'cheerio';
import { safePublicFetch } from '../security/safe-public-fetch';
import type { BlogSource } from './types';

export interface CompetitorReferenceSnapshot {
  url: string;
  title: string;
  publisher: string;
  headings: string[];
  observedTopics: string[];
  publishedAt: string | null;
}

export function honestCompetitorTrafficLabel(input: { requestedLabel?: string; verifiedDataSource?: string; observedAt?: string | null }) {
  const requested = String(input.requestedLabel || '').trim().toLowerCase();
  const verified = Boolean(input.verifiedDataSource && input.observedAt && Number.isFinite(new Date(input.observedAt).getTime()));
  if (requested === 'high traffic' && verified) return { label: 'High traffic', dataSource: String(input.verifiedDataSource), observedAt: new Date(String(input.observedAt)).toISOString() };
  const allowed = new Map([
    ['authoritative reference', 'Authoritative reference'], ['widely covered', 'Widely covered'], ['frequently discussed', 'Frequently discussed'],
    ['competitor reference', 'Competitor reference'], ['prominent industry coverage', 'Prominent industry coverage'],
  ]);
  return { label: allowed.get(requested) || 'Traffic data unavailable', dataSource: '', observedAt: null };
}

function unique(values: string[], maximum: number) {
  return [...new Set(values.map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, maximum);
}

async function fetchReference(url: string) {
  const response = await safePublicFetch(url, { timeoutMs: 8_000, maxRedirects: 3, maxBytes: 1_000_000, allowedContentTypes: ['text/html', 'application/xhtml+xml'], userAgent: 'SEOIntelEditorialBot/1.0 (+https://keywordsintel.vercel.app/)' });
  if (response.status < 200 || response.status >= 300) throw new Error(`Reference returned HTTP ${response.status}.`);
  const $ = load(response.body);
  const title = $('meta[property="og:title"]').attr('content') || $('title').text().trim();
  const published = $('meta[property="article:published_time"]').attr('content') || $('time[datetime]').first().attr('datetime') || '';
  const publishedDate = published && Number.isFinite(new Date(published).getTime()) ? new Date(published).toISOString() : null;
  return { response, $, title: title.replace(/\s+/g, ' ').trim().slice(0, 240), publishedAt: publishedDate };
}

export async function researchSourceUrls(urls: string[]): Promise<BlogSource[]> {
  const sources: BlogSource[] = [];
  for (const url of unique(urls, 12)) {
    const reference = await fetchReference(url);
    const hostname = new URL(reference.response.finalUrl).hostname.replace(/^www\./, '');
    if (!reference.title) throw new Error(`Reference at ${hostname} has no usable title.`);
    sources.push({
      url: reference.response.finalUrl, title: reference.title, publisher: hostname, publishedAt: reference.publishedAt,
      accessedAt: new Date().toISOString(), sourceType: 'editorial reference', supportedClaims: [], primary: false,
      reliability: 'unverified', citationStatus: 'verified',
    });
  }
  return sources;
}

export async function researchCompetitorReferences(urls: string[]): Promise<CompetitorReferenceSnapshot[]> {
  const snapshots: CompetitorReferenceSnapshot[] = [];
  for (const url of unique(urls, 5)) {
    const reference = await fetchReference(url);
    const headings = unique(reference.$('h2,h3').toArray().map((node) => reference.$(node).text()), 30);
    const observedTopics = unique(headings.map((heading) => heading.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')), 20);
    snapshots.push({
      url: reference.response.finalUrl, title: reference.title, publisher: new URL(reference.response.finalUrl).hostname.replace(/^www\./, ''),
      headings, observedTopics, publishedAt: reference.publishedAt,
    });
  }
  return snapshots;
}

export function buildCompetitorGapBrief(references: CompetitorReferenceSnapshot[], intendedTopics: string[]) {
  const coveredSubtopics = unique(references.flatMap((reference) => reference.observedTopics), 50);
  const coveredKeys = new Set(coveredSubtopics.map((topic) => topic.toLowerCase()));
  const contentGaps = unique(intendedTopics.filter((topic) => !coveredKeys.has(topic.toLowerCase())), 20);
  return {
    coveredSubtopics,
    contentGaps,
    formatObservations: references.map((reference) => `${reference.publisher}: ${reference.headings.length} observed H2/H3 headings`).slice(0, 10),
    proposedOriginalAngle: contentGaps.length ? `Answer the uncovered questions: ${contentGaps.join('; ')}.` : 'Use independent examples, evidence, and workflow ordering rather than reproducing reference structure.',
    trafficLabel: honestCompetitorTrafficLabel({}).label,
    copyingRule: 'Do not copy wording, examples, tables, paragraph order, or heading sequence.',
  };
}
