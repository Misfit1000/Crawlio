import { AuditIssue } from '../../audit/types';
import { runOnPageChecks } from './on-page';
import { runTechnicalChecks } from './technical';
import { runContentChecks } from './content';
import { runLinkChecks } from './links';

export function runAllChecks(pageData: any): AuditIssue[] {
  const issues: AuditIssue[] = [];
  
  issues.push(...runOnPageChecks(pageData));
  issues.push(...runTechnicalChecks(pageData));
  issues.push(...runContentChecks(pageData));
  issues.push(...runLinkChecks(pageData));
  
  return issues;
}
