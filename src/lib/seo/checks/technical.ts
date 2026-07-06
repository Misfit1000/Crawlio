import { AuditIssue } from '../../audit/types';

export function runTechnicalChecks(pageData: any): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const url = pageData.url || '';
  
  // 1. 4xx Error
  if (pageData.status >= 400 && pageData.status < 500) {
    issues.push({ id: '4xx-error', category: 'technical', severity: 'critical', title: '4xx Client Error', description: `Page returned a ${pageData.status} status code.`, affectedUrl: url });
  }
  
  // 2. 5xx Error
  if (pageData.status >= 500) {
    issues.push({ id: '5xx-error', category: 'technical', severity: 'critical', title: '5xx Server Error', description: `Page returned a ${pageData.status} status code.`, affectedUrl: url });
  }
  
  // 3. Not HTTPS
  if (url && !url.startsWith('https://')) {
    issues.push({ id: 'not-https', category: 'security', severity: 'high', title: 'Not HTTPS', description: 'URL is not using secure HTTPS.', affectedUrl: url });
  }

  // 4. Missing Canonical
  if (!pageData.canonical) {
    issues.push({ id: 'missing-canonical', category: 'indexability', severity: 'medium', title: 'Missing Canonical Tag', description: 'Page does not have a rel="canonical" tag.', affectedUrl: url });
  } else if (pageData.canonical !== url) {
    // 5. Canonical Mismatch
    issues.push({ id: 'canonical-mismatch', category: 'indexability', severity: 'low', title: 'Canonical Pointing Elsewhere', description: `Canonical points to ${pageData.canonical}, not the current URL.`, affectedUrl: url });
  }

  // 6. Noindex present
  if (pageData.metaRobots && pageData.metaRobots.includes('noindex')) {
    issues.push({ id: 'noindex', category: 'indexability', severity: 'high', title: 'Noindex Tag Found', description: 'Page contains a noindex robots meta tag.', affectedUrl: url });
  }

  // 7. Slow Page load
  if (pageData.loadTimeMs && pageData.loadTimeMs > 3000) {
    issues.push({ id: 'slow-load', category: 'performance', severity: 'high', title: 'Slow Load Time', description: `Page took ${pageData.loadTimeMs}ms to load.`, affectedUrl: url });
  }

  // 8. Missing viewport
  if (!pageData.viewport) {
    issues.push({ id: 'missing-viewport', category: 'performance', severity: 'high', title: 'Missing Viewport Meta', description: 'Page is not mobile-friendly due to missing viewport tag.', affectedUrl: url });
  }
  
  // 9. Too large
  if (pageData.pageSizeBytes && pageData.pageSizeBytes > 500000) {
     issues.push({ id: 'large-dom', category: 'performance', severity: 'medium', title: 'Large Page Size', description: 'The page size is very large (over 500KB).', affectedUrl: url });
  }
  
  // 10. Missing Lang attribute
  if (!pageData.lang) {
     issues.push({ id: 'missing-lang', category: 'technical', severity: 'low', title: 'Missing HTML Lang Attribute', description: 'The <html> tag is missing a lang attribute.', affectedUrl: url });
  }

  return issues;
}
