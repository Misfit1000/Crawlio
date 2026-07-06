export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AuditCategory = string;

export interface AuditIssue {
  id: string;
  category: AuditCategory;
  severity: IssueSeverity;
  title: string;
  description: string;
  recommendation?: string;
  affectedUrl?: string;
  element?: string;
  evidence?: string;
}

export interface CrawledPageInfo {
  url: string;
  title: string;
  status: number;
  wordCount: number;
  isIndexable: boolean;
  issues: AuditIssue[];
}

export interface FullAuditResult {
  jobId: string;
  targetUrl: string;
  status: 'pending' | 'crawling' | 'analyzing' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  error?: string;
  
  // Scoring
  overallScore: number;
  categoryScores: Record<AuditCategory, number>;
  
  // Stats
  pagesCrawled: number;
  pagesIndexable: number;
  pagesNonIndexable: number;
  
  // Issues
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  passedChecks: number;
  
  allIssues: AuditIssue[];
  crawledPages: CrawledPageInfo[];
}

export interface AuditResult {
  score: number;
  categoryScores: Record<string, number>;
  counts: { critical: number; high: number; medium: number; low: number };
  passedChecks: string[];
  issues: AuditIssue[];
}
