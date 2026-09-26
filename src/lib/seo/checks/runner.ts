import './all-checks';
import type { AuditIssue } from '../../audit/types';
import { run as checkImages } from './images';
import { run as checkIndexability } from './indexability';
import { run as checkInternational } from './international';
import { run as checkLocal } from './local';
import { run as checkMobile } from './mobile';
import { run as checkPerformance } from './performance';
import { run as checkRobots } from './robots';
import { run as checkSchema } from './schema';
import { run as checkSecurity } from './security';
import { run as checkSitemap } from './sitemap';
import { run as checkSocial } from './social';
import { run as checkTechnical } from './technical';
import { run as checkOnPage } from './on-page';
import { run as checkContent } from './content';
import { run as checkLinks } from './links';
import { run as checkAccessibility } from './accessibility';

type CheckRunner = (pageData: any, auditId?: string) => AuditIssue[];

export const CHECKS: Array<{ id: string; title: string; run: CheckRunner }> = [
  { id: 'images', title: 'Images', run: checkImages },
  { id: 'indexability', title: 'Indexability', run: checkIndexability },
  { id: 'international', title: 'International', run: checkInternational },
  { id: 'local', title: 'Local', run: checkLocal },
  { id: 'mobile', title: 'Mobile', run: checkMobile },
  { id: 'performance', title: 'Performance', run: checkPerformance },
  { id: 'robots', title: 'Robots', run: checkRobots },
  { id: 'schema', title: 'Schema', run: checkSchema },
  { id: 'security', title: 'Security', run: checkSecurity },
  { id: 'sitemap', title: 'Sitemap', run: checkSitemap },
  { id: 'social', title: 'Social', run: checkSocial },
  { id: 'technical', title: 'Technical', run: checkTechnical },
  { id: 'on-page', title: 'On-page', run: checkOnPage },
  { id: 'content', title: 'Content', run: checkContent },
  { id: 'links', title: 'Links', run: checkLinks },
  { id: 'accessibility', title: 'Automated accessibility signals', run: checkAccessibility },
];

export interface UnavailableAuditCheck {
  checkId: string;
  checkTitle: string;
  internalDetails: string;
}

export interface SafeCheckRunResult {
  issues: AuditIssue[];
  unavailableChecks: UnavailableAuditCheck[];
  completedChecks: number;
}

export function runCheckSetSafely(checks: Array<{ id: string; title: string; run: CheckRunner }>, pageData: any, auditId?: string): SafeCheckRunResult {
  const issues: AuditIssue[] = [];
  const unavailableChecks: UnavailableAuditCheck[] = [];
  let completedChecks = 0;

  for (const check of checks) {
    try {
      const checkIssues = check.run(pageData, auditId) || [];
      issues.push(...checkIssues);
      completedChecks += 1;
    } catch (error) {
      unavailableChecks.push({
        checkId: check.id,
        checkTitle: check.title,
        internalDetails: error instanceof Error ? `${error.name}: ${error.message}` : String(error || 'Unknown check failure'),
      });
    }
  }

  return { issues, unavailableChecks, completedChecks };
}

export function runAllChecksSafely(pageData: any, auditId?: string): SafeCheckRunResult {
  return runCheckSetSafely(CHECKS, pageData, auditId);
}

export function runAllChecks(pageData: any, auditId?: string): AuditIssue[] {
  return runAllChecksSafely(pageData, auditId).issues;
}

export const AUDIT_CHECK_COUNT = CHECKS.length;
