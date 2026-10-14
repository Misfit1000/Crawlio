import type { ReportScoreSnapshot } from '../audit/report-insights';
import type { AuditCheckGroup, AuditScope } from '../audit/audit-scope';
import type { PublicLinkSignals } from './types';

export type DomainStrengthConfidence = 'limited' | 'standard';
export type DomainStrengthFactorId = 'technical' | 'crawlability' | 'internalLinks' | 'seo' | 'performance' | 'structuredData';

export interface DomainStrengthFactor {
  id: DomainStrengthFactorId;
  label: string;
  score: number | null;
  weight: number;
}

export interface DomainStrengthResult {
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | null;
  band: 'Excellent' | 'Strong' | 'Good' | 'Developing' | 'Weak' | null;
  confidence: DomainStrengthConfidence;
  coverage: number;
  siteStrength: number | null;
  linkVisibility: number | null;
  webPopularity: number | null;
  factors: DomainStrengthFactor[];
  recommendations: string[];
  eligibleForSiteStrength: boolean;
}

export interface DomainStrengthEvidenceSummary {
  measuredFactors?: readonly DomainStrengthFactorId[];
  analysedPages?: number;
  discoveredPages?: number;
  sampled?: boolean;
}

export interface DomainStrengthOptions {
  auditScope?: AuditScope | null;
  evidenceSummary?: DomainStrengthEvidenceSummary | null;
}

const FACTOR_GROUPS: Record<DomainStrengthFactorId, AuditCheckGroup> = {
  technical: 'technical', crawlability: 'crawlability', internalLinks: 'links',
  seo: 'seo', performance: 'performance', structuredData: 'structured-data',
};

const SITE_FACTORS: Array<{ id: DomainStrengthFactorId; label: string; key: keyof ReportScoreSnapshot; weight: number; recommendation: string }> = [
  { id: 'technical', label: 'Technical SEO', key: 'technical', weight: 25, recommendation: 'Resolve technical delivery errors and redirect problems first.' },
  { id: 'crawlability', label: 'Crawlability', key: 'crawlability', weight: 25, recommendation: 'Improve search access, sitemap coverage, and preferred page URLs.' },
  { id: 'internalLinks', label: 'Internal links', key: 'internalLinks', weight: 20, recommendation: 'Strengthen internal paths to important pages and repair broken links.' },
  { id: 'seo', label: 'On-page SEO', key: 'seo', weight: 15, recommendation: 'Improve page titles, descriptions, headings, and content clarity.' },
  { id: 'performance', label: 'Performance', key: 'performance', weight: 10, recommendation: 'Reduce slow responses and oversized page payloads.' },
  { id: 'structuredData', label: 'Structured data', key: 'structuredData', weight: 5, recommendation: 'Add valid structured data and complete social preview metadata.' },
];

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function finiteScore(value: unknown) {
  const number = Number(value);
  return value == null || value === '' || !Number.isFinite(number) ? null : clamp(number);
}

function weightedAverage(values: Array<{ score: number | null; weight: number }>) {
  const measured = values.filter((item): item is { score: number; weight: number } => item.score != null);
  const weight = measured.reduce((sum, item) => sum + item.weight, 0);
  if (!weight) return null;
  return clamp(measured.reduce((sum, item) => sum + item.score * item.weight, 0) / weight);
}

export function rankToScore(rank: number | null | undefined) {
  if (rank == null || !Number.isFinite(rank) || rank < 1) return null;
  return clamp(100 * (1 - Math.log10(rank) / 6));
}

function networkToScore(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return clamp((Math.log10(value + 1) / 6) * 100);
}

function grade(score: number | null): DomainStrengthResult['grade'] {
  if (score == null) return null;
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  if (score >= 50) return 'E';
  return 'F';
}

function band(score: number | null): DomainStrengthResult['band'] {
  if (score == null) return null;
  if (score >= 90) return 'Excellent';
  if (score >= 80) return 'Strong';
  if (score >= 70) return 'Good';
  if (score >= 60) return 'Developing';
  return 'Weak';
}

export function calculateDomainStrength(scores: ReportScoreSnapshot, signals?: PublicLinkSignals | null, options: DomainStrengthOptions = {}): DomainStrengthResult {
  const { auditScope, evidenceSummary } = options;
  const partialPageCoverage = evidenceSummary?.analysedPages != null && evidenceSummary.discoveredPages != null
    && evidenceSummary.analysedPages < evidenceSummary.discoveredPages;
  const eligibleForSiteStrength = (!auditScope || (auditScope.coverage === 'site' && auditScope.focus === 'full'))
    && (evidenceSummary?.analysedPages == null || evidenceSummary.analysedPages > 0);
  const factors = SITE_FACTORS.map((factor) => ({
    id: factor.id,
    label: factor.label,
    score: (auditScope && !auditScope.checkGroups.includes(FACTOR_GROUPS[factor.id]))
      || (evidenceSummary?.measuredFactors && !evidenceSummary.measuredFactors.includes(factor.id))
      ? null : finiteScore(scores[factor.key]),
    weight: factor.weight,
  }));
  const measuredFactors = factors.filter((factor) => factor.score != null);
  const measuredSiteWeight = measuredFactors.reduce((sum, factor) => sum + factor.weight, 0);
  const siteStrength = eligibleForSiteStrength && measuredFactors.length >= 3 ? weightedAverage(factors) : null;

  const linkVisibility = signals?.linkStatus === 'measured'
    ? weightedAverage([
        { score: rankToScore(signals.globalRank), weight: 50 },
        { score: networkToScore(signals.referringSubnets), weight: 30 },
        { score: networkToScore(signals.referringIps), weight: 20 },
      ])
    : null;
  const webPopularity = signals?.webRankStatus === 'measured' ? rankToScore(signals.webRank) : null;
  const score = siteStrength;
  const coverage = clamp(measuredSiteWeight);

  const recommendations = SITE_FACTORS
    .map((definition) => ({ definition, factor: factors.find((factor) => factor.id === definition.id) }))
    .filter((item): item is typeof item & { factor: DomainStrengthFactor & { score: number } } => item.factor?.score != null && item.factor.score < 80)
    .sort((left, right) => left.factor.score - right.factor.score)
    .slice(0, 3)
    .map((item) => item.definition.recommendation);

  if (!recommendations.length && siteStrength != null) {
    recommendations.push('Maintain the measured site foundation and review new findings after each audit.');
  }

  return {
    score,
    grade: grade(score),
    band: band(score),
    confidence: eligibleForSiteStrength && measuredFactors.length === SITE_FACTORS.length && !evidenceSummary?.sampled && !partialPageCoverage ? 'standard' : 'limited',
    coverage,
    siteStrength,
    linkVisibility,
    webPopularity,
    factors,
    recommendations,
    eligibleForSiteStrength,
  };
}
