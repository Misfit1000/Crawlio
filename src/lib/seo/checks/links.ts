import { AuditIssue } from '../../audit/types';

export function runLinkChecks(pageData: any): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const url = pageData.url || '';
  
  const internalLinks = pageData.links?.filter((l: any) => l.isInternal) || [];
  const externalLinks = pageData.links?.filter((l: any) => !l.isInternal) || [];
  
  if (internalLinks.length === 0 && pageData.status === 200) {
    issues.push({ id: 'no-internal-links', category: 'links', severity: 'high', title: 'No Internal Links', description: 'Page has no internal outgoing links.', affectedUrl: url });
  }
  
  if (externalLinks.length === 0 && pageData.status === 200) {
    issues.push({ id: 'no-external-links', category: 'links', severity: 'low', title: 'No External Links', description: 'Page has no external outgoing links.', affectedUrl: url });
  }
  
  if (pageData.links) {
    let missingAnchors = 0;
    pageData.links.forEach((l: any) => {
      if (!l.text || l.text.trim().length === 0) {
        missingAnchors++;
      }
    });
    
    if (missingAnchors > 0) {
      issues.push({ id: 'missing-anchor-text', category: 'links', severity: 'medium', title: 'Missing Anchor Text', description: `${missingAnchors} links are missing anchor text.`, affectedUrl: url });
    }
    
    if (pageData.links.length > 200) {
      issues.push({ id: 'too-many-links', category: 'links', severity: 'medium', title: 'Too Many Links', description: `Page has ${pageData.links.length} links, which is very high.`, affectedUrl: url });
    }
  }
  
  return issues;
}
