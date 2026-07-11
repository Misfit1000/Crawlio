import type {
  AuditSeverity,
  ResourceAuditIssue,
  ResourceAuditPage,
} from './resource-types';

export type ReportScoreKey = 'overall' | 'seo' | 'technical' | 'crawlability' | 'performance' | 'security';
export type ReportSectionId =
  | 'on-page'
  | 'technical'
  | 'crawlability'
  | 'internal-links'
  | 'performance'
  | 'mobile'
  | 'security'
  | 'structured-data';

export interface ReportScoreSnapshot {
  overall: number | null;
  seo: number | null;
  technical: number | null;
  crawlability: number | null;
  performance: number | null;
  security: number | null;
}

export interface RecommendationGroup {
  id: string;
  title: string;
  category: string;
  severity: AuditSeverity;
  description: string;
  recommendation: string;
  evidence: string[];
  affectedUrls: string[];
  affectedCount: number;
  section: ReportSectionId;
}

export const REPORT_SECTIONS: Array<{ id: ReportSectionId; label: string; description: string }> = [
  { id: 'on-page', label: 'On-page SEO', description: 'Titles, descriptions, headings, images, and page content signals.' },
  { id: 'technical', label: 'Technical SEO', description: 'Status codes, redirects, HTTPS behavior, and technical page delivery.' },
  { id: 'crawlability', label: 'Crawlability and indexing', description: 'Search engine access rules, sitemaps, preferred URLs, and index signals.' },
  { id: 'internal-links', label: 'Internal links', description: 'Link paths, anchors, broken links, and page discovery.' },
  { id: 'performance', label: 'Performance observations', description: 'Observed server response times and downloaded page sizes.' },
  { id: 'mobile', label: 'Mobile and usability', description: 'Viewport and public mobile-readiness signals collected by the audit.' },
  { id: 'security', label: 'Passive Security Review', description: 'HTTPS and browser protection observations collected without attack testing.' },
  { id: 'structured-data', label: 'Structured data and social', description: 'Structured markup and public social preview metadata.' },
];

const SEVERITY_WEIGHT: Record<AuditSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function finiteScore(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
}

export function extractReportScores(scores?: Record<string, unknown> | null): ReportScoreSnapshot {
  return {
    overall: finiteScore(scores?.overall),
    seo: finiteScore(scores?.seo),
    technical: finiteScore(scores?.technical),
    crawlability: finiteScore(scores?.crawlability),
    performance: finiteScore(scores?.performance),
    security: finiteScore(scores?.security),
  };
}

export function scoreToGrade(score: number | null | undefined) {
  if (score == null || !Number.isFinite(score)) return null;
  if (score >= 90) return 'A' as const;
  if (score >= 80) return 'B' as const;
  if (score >= 70) return 'C' as const;
  if (score >= 60) return 'D' as const;
  if (score >= 50) return 'E' as const;
  return 'F' as const;
}

export function scoreTone(score: number | null | undefined): 'green' | 'accent' | 'yellow' | 'red' {
  if (score == null || !Number.isFinite(score)) return 'accent';
  if (score >= 80) return 'green';
  if (score >= 70) return 'accent';
  if (score >= 50) return 'yellow';
  return 'red';
}

export function gradeRangeLabel(grade: ReturnType<typeof scoreToGrade>) {
  const ranges = {
    A: '90-100',
    B: '80-89',
    C: '70-79',
    D: '60-69',
    E: '50-59',
    F: 'Below 50',
  } as const;
  return grade ? ranges[grade] : 'Not measured';
}

export function classifyReportSection(issue: Pick<ResourceAuditIssue, 'category' | 'title' | 'description'>): ReportSectionId {
  const text = `${issue.category} ${issue.title} ${issue.description}`.toLowerCase();
  if (/security|https|tls|certificate|header|cookie|csp|hsts|cors|mixed content|x-frame|referrer-policy|permissions-policy/.test(text)) return 'security';
  if (/internal link|broken link|orphan|anchor text|crawl depth/.test(text)) return 'internal-links';
  if (/performance|response time|slow|page size|payload|compression|cache|resource|latency/.test(text)) return 'performance';
  if (/mobile|viewport|tap target|responsive|usability/.test(text)) return 'mobile';
  if (/schema|structured data|json-ld|open graph|twitter card|social preview/.test(text)) return 'structured-data';
  if (/robots|sitemap|index|canonical|preferred page url|crawlable|crawlability|noindex/.test(text)) return 'crawlability';
  if (/status code|redirect|http error|doctype|charset|content-type|server error/.test(text)) return 'technical';
  return 'on-page';
}

function groupKey(issue: ResourceAuditIssue) {
  return `${classifyReportSection(issue)}|${issue.category}|${issue.title}`.trim().toLowerCase();
}

export function groupRecommendations(issues: ResourceAuditIssue[]): RecommendationGroup[] {
  const groups = new Map<string, RecommendationGroup>();

  issues.forEach((issue) => {
    const key = groupKey(issue);
    const current = groups.get(key);
    const affectedUrl = String(issue.affectedUrl || '').trim();
    const evidence = String(issue.evidence || '').trim();

    if (!current) {
      groups.set(key, {
        id: key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        title: issue.title,
        category: issue.category,
        severity: issue.severity,
        description: issue.description,
        recommendation: issue.recommendation,
        evidence: evidence ? [evidence] : [],
        affectedUrls: affectedUrl ? [affectedUrl] : [],
        affectedCount: affectedUrl ? 1 : 0,
        section: classifyReportSection(issue),
      });
      return;
    }

    if (SEVERITY_WEIGHT[issue.severity] > SEVERITY_WEIGHT[current.severity]) current.severity = issue.severity;
    if (affectedUrl && !current.affectedUrls.includes(affectedUrl)) current.affectedUrls.push(affectedUrl);
    if (evidence && !current.evidence.includes(evidence)) current.evidence.push(evidence);
    current.affectedCount = current.affectedUrls.length;
  });

  return Array.from(groups.values()).sort((left, right) => {
    const priority = SEVERITY_WEIGHT[right.severity] - SEVERITY_WEIGHT[left.severity];
    if (priority) return priority;
    const reach = right.affectedCount - left.affectedCount;
    return reach || left.title.localeCompare(right.title);
  });
}

export function observedPageMetrics(pages: ResourceAuditPage[]) {
  const responseTimes = pages.map((page) => page.responseTimeMs).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const sizes = pages.map((page) => page.pageSizeBytes).filter((value) => Number.isFinite(value) && value >= 0);
  const totalSize = sizes.reduce((total, value) => total + value, 0);
  const averageResponseMs = responseTimes.length
    ? Math.round(responseTimes.reduce((total, value) => total + value, 0) / responseTimes.length)
    : null;
  const p95Index = responseTimes.length ? Math.min(responseTimes.length - 1, Math.ceil(responseTimes.length * 0.95) - 1) : -1;

  return {
    averageResponseMs,
    p95ResponseMs: p95Index >= 0 ? responseTimes[p95Index] : null,
    averagePageBytes: sizes.length ? Math.round(totalSize / sizes.length) : null,
    totalPageBytes: sizes.length ? totalSize : null,
    successfulPages: pages.filter((page) => page.statusCode >= 200 && page.statusCode < 300).length,
    redirectPages: pages.filter((page) => page.statusCode >= 300 && page.statusCode < 400).length,
    errorPages: pages.filter((page) => page.statusCode <= 0 || page.statusCode >= 400).length,
  };
}

export function formatBytes(bytes: number | null | undefined) {
  if (bytes == null || !Number.isFinite(bytes)) return 'Not measured';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMilliseconds(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 'Not measured';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}
