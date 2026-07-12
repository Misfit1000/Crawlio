import type { AuditSeverity, ResourceAuditIssue, ResourceAuditPage } from './resource-types';
import { classifyReportSection, scoreToGrade, type ReportSectionId } from './report-insights';

export type AuditScoreCategory =
  | 'onPage'
  | 'technical'
  | 'crawlability'
  | 'internalLinks'
  | 'performance'
  | 'mobile'
  | 'security'
  | 'structuredData';

export interface ScoreDeduction {
  key: string;
  category: AuditScoreCategory;
  title: string;
  severity: AuditSeverity;
  points: number;
  affectedPages: number;
  affectedPercentage: number;
  siteWide: boolean;
  reason: string;
}

export interface CategoryScoreResult {
  score: number | null;
  grade: ReturnType<typeof scoreToGrade>;
  measured: boolean;
  deductions: ScoreDeduction[];
  unavailableChecks: string[];
}

export interface TransparentAuditScore {
  overall: number | null;
  grade: ReturnType<typeof scoreToGrade>;
  categories: Record<AuditScoreCategory, CategoryScoreResult>;
  deductions: ScoreDeduction[];
  measuredChecks: string[];
  unavailableChecks: string[];
  limitations: string[];
}

const CATEGORIES: AuditScoreCategory[] = [
  'onPage',
  'technical',
  'crawlability',
  'internalLinks',
  'performance',
  'mobile',
  'security',
  'structuredData',
];

const SECTION_CATEGORY: Record<ReportSectionId, AuditScoreCategory> = {
  'on-page': 'onPage',
  technical: 'technical',
  crawlability: 'crawlability',
  'internal-links': 'internalLinks',
  performance: 'performance',
  mobile: 'mobile',
  security: 'security',
  'structured-data': 'structuredData',
};

const SEVERITY_POINTS: Record<AuditSeverity, number> = {
  critical: 22,
  high: 13,
  medium: 6,
  low: 2,
  info: 0,
};

const DEFAULT_MEASURED: AuditScoreCategory[] = [
  'onPage',
  'technical',
  'crawlability',
  'internalLinks',
  'performance',
  'security',
  'structuredData',
];

function normalizedIssueKey(issue: ResourceAuditIssue) {
  return `${SECTION_CATEGORY[classifyReportSection(issue)]}|${issue.title}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

function categoryForIssue(issue: ResourceAuditIssue) {
  return SECTION_CATEGORY[classifyReportSection(issue)];
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function uniquePublicPages(pages: ResourceAuditPage[]) {
  return new Set(pages.map((page) => page.url).filter(Boolean));
}

function derivePageDeductions(pages: ResourceAuditPage[], pageCount: number): ScoreDeduction[] {
  const errorPages = pages.filter((page) => page.statusCode <= 0 || page.statusCode >= 400);
  const redirectPages = pages.filter((page) => page.statusCode >= 300 && page.statusCode < 400);
  const slowPages = pages.filter((page) => page.responseTimeMs > 1_500);
  const largePages = pages.filter((page) => page.pageSizeBytes > 1_000_000);
  const derived: ScoreDeduction[] = [];

  const add = (category: AuditScoreCategory, key: string, title: string, severity: AuditSeverity, affected: number, basePoints: number, reason: string) => {
    if (!affected) return;
    const percentage = Math.min(100, Math.round((affected / Math.max(1, pageCount)) * 100));
    const siteWide = percentage >= 70;
    const reachMultiplier = 0.65 + Math.min(0.85, percentage / 100);
    derived.push({
      key,
      category,
      title,
      severity,
      points: Math.min(35, Math.max(1, Math.round(basePoints * reachMultiplier * (siteWide ? 1.2 : 1)))),
      affectedPages: affected,
      affectedPercentage: percentage,
      siteWide,
      reason,
    });
  };

  add('technical', 'derived:http-errors', 'Pages returning error responses', 'high', errorPages.length, 13, 'Error responses prevent reliable page delivery.');
  add('crawlability', 'derived:crawl-errors', 'Discovered pages could not be processed successfully', 'high', errorPages.length, 13, 'Failed pages reduce reliable crawl and index coverage.');
  add('technical', 'derived:redirects', 'Pages returning redirects', 'low', redirectPages.length, 2, 'Redirect responses add an extra delivery hop and may require review.');
  add('performance', 'derived:slow-pages', 'Slow observed server responses', 'medium', slowPages.length, 6, 'Observed server response time exceeded 1.5 seconds during the audit.');
  add('performance', 'derived:large-pages', 'Large HTML responses', 'medium', largePages.length, 6, 'Downloaded HTML exceeded the one megabyte review threshold.');
  return derived;
}

export function calculateTransparentAuditScore(input: {
  issues: ResourceAuditIssue[];
  pages: ResourceAuditPage[];
  measuredCategories?: AuditScoreCategory[];
  unavailableChecks?: Partial<Record<AuditScoreCategory, string[]>>;
  limitations?: string[];
}): TransparentAuditScore {
  const pageUrls = uniquePublicPages(input.pages);
  const pageCount = Math.max(1, pageUrls.size || input.pages.length);
  const measured = new Set(input.measuredCategories || DEFAULT_MEASURED);
  const grouped = new Map<string, { category: AuditScoreCategory; title: string; severity: AuditSeverity; urls: Set<string> }>();
  const severityRank: Record<AuditSeverity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

  for (const issue of input.issues) {
    if (issue.severity === 'info') continue;
    const key = normalizedIssueKey(issue);
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        category: categoryForIssue(issue),
        title: issue.title,
        severity: issue.severity,
        urls: new Set(issue.affectedUrl ? [issue.affectedUrl] : []),
      });
      continue;
    }
    if (severityRank[issue.severity] > severityRank[current.severity]) current.severity = issue.severity;
    if (issue.affectedUrl) current.urls.add(issue.affectedUrl);
  }

  const deductions: ScoreDeduction[] = [];
  for (const [key, group] of grouped) {
    const affectedPages = group.urls.size || pageCount;
    const affectedPercentage = Math.min(100, Math.round((affectedPages / pageCount) * 100));
    const siteWide = affectedPercentage >= 70 || group.urls.size === 0;
    const reachMultiplier = 0.65 + Math.min(0.85, affectedPercentage / 100);
    const criticalPathMultiplier = group.category === 'crawlability' || group.category === 'technical' ? 1.15 : 1;
    const points = Math.min(35, Math.max(0, Math.round(SEVERITY_POINTS[group.severity] * reachMultiplier * criticalPathMultiplier * (siteWide ? 1.2 : 1))));
    if (!points) continue;
    deductions.push({
      key,
      category: group.category,
      title: group.title,
      severity: group.severity,
      points,
      affectedPages,
      affectedPercentage,
      siteWide,
      reason: `${group.severity} finding affecting ${affectedPercentage}% of measured pages${siteWide ? ' (site-wide)' : ''}.`,
    });
  }

  deductions.push(...derivePageDeductions(input.pages, pageCount));
  const categories = Object.fromEntries(CATEGORIES.map((category) => {
    const categoryDeductions = deductions.filter((deduction) => deduction.category === category);
    const isMeasured = measured.has(category);
    const score = isMeasured ? clampScore(100 - categoryDeductions.reduce((total, deduction) => total + deduction.points, 0)) : null;
    return [category, {
      score,
      grade: scoreToGrade(score),
      measured: isMeasured,
      deductions: categoryDeductions,
      unavailableChecks: input.unavailableChecks?.[category] || [],
    } satisfies CategoryScoreResult];
  })) as Record<AuditScoreCategory, CategoryScoreResult>;

  const measuredScores = CATEGORIES.map((category) => categories[category].score).filter((score): score is number => score != null);
  const overall = measuredScores.length ? clampScore(measuredScores.reduce((total, score) => total + score, 0) / measuredScores.length) : null;
  const unavailableChecks = CATEGORIES.flatMap((category) => categories[category].unavailableChecks);

  return {
    overall,
    grade: scoreToGrade(overall),
    categories,
    deductions: deductions.sort((left, right) => right.points - left.points),
    measuredChecks: CATEGORIES.filter((category) => categories[category].measured),
    unavailableChecks,
    limitations: input.limitations || [],
  };
}

export function toReportScoreRecord(result: TransparentAuditScore) {
  return {
    overall: result.overall,
    grade: result.grade,
    seo: result.categories.onPage.score,
    technical: result.categories.technical.score,
    crawlability: result.categories.crawlability.score,
    internalLinks: result.categories.internalLinks.score,
    performance: result.categories.performance.score,
    mobile: result.categories.mobile.score,
    security: result.categories.security.score,
    structuredData: result.categories.structuredData.score,
    deductions: result.deductions,
    measuredChecks: result.measuredChecks,
    unavailableChecks: result.unavailableChecks,
    limitations: result.limitations,
  };
}
