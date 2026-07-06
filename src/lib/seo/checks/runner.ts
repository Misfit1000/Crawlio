import "./all-checks";
import { AuditIssue } from '../../audit/types';
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

export function runAllChecks(pageData: any): AuditIssue[] {
  let issues: AuditIssue[] = [];
  issues = issues.concat(checkImages(pageData));
  issues = issues.concat(checkIndexability(pageData));
  issues = issues.concat(checkInternational(pageData));
  issues = issues.concat(checkLocal(pageData));
  issues = issues.concat(checkMobile(pageData));
  issues = issues.concat(checkPerformance(pageData));
  issues = issues.concat(checkRobots(pageData));
  issues = issues.concat(checkSchema(pageData));
  issues = issues.concat(checkSecurity(pageData));
  issues = issues.concat(checkSitemap(pageData));
  issues = issues.concat(checkSocial(pageData));
  issues = issues.concat(checkTechnical(pageData));
  issues = issues.concat(checkOnPage(pageData));
  issues = issues.concat(checkContent(pageData));
  issues = issues.concat(checkLinks(pageData));
  return issues;
}
