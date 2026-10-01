import type { AuditSeverity, ResourceAuditIssue } from '../../lib/audit/resource-types';

export interface SecurityCheckInput {
  finalUrl: string;
  headers: Record<string, string>;
  parsed?: {
    insecureResourceUrls?: string[];
    insecureFormActionUrls?: string[];
  } | null;
}

export function buildSecurityIssues(page: SecurityCheckInput): Omit<ResourceAuditIssue, 'id' | 'detectedAt'>[] {
  const issues: Omit<ResourceAuditIssue, 'id' | 'detectedAt'>[] = [];
  const headers = page.headers;
  const add = (severity: AuditSeverity, title: string, evidence: string, recommendation: string) => {
    issues.push({
      severity,
      category: 'security',
      title,
      description: title,
      affectedUrl: page.finalUrl,
      evidence,
      recommendation,
    });
  };

  if (!page.finalUrl.startsWith('https://')) {
    add('high', 'Page is not served over HTTPS', page.finalUrl, 'Serve all public pages over HTTPS and redirect HTTP to HTTPS.');
  }
  if (!headers['strict-transport-security'] && page.finalUrl.startsWith('https://')) {
    add('medium', 'Missing HSTS header', 'strict-transport-security header not present', 'Add a Strict-Transport-Security header after HTTPS is stable.');
  }
  if (!headers['content-security-policy']) {
    add('medium', 'Missing Content-Security-Policy header', 'content-security-policy header not present', 'Add a CSP that restricts scripts, frames, images, and form targets.');
  }
  if (!headers['x-frame-options'] && !headers['content-security-policy']?.includes('frame-ancestors')) {
    add('medium', 'Missing clickjacking protection', 'x-frame-options/frame-ancestors not present', 'Add X-Frame-Options or a CSP frame-ancestors directive.');
  }
  if (!headers['x-content-type-options']) {
    add('low', 'Missing X-Content-Type-Options header', 'x-content-type-options header not present', 'Add X-Content-Type-Options: nosniff.');
  }
  if (!headers['referrer-policy']) {
    add('low', 'Missing Referrer-Policy header', 'referrer-policy header not present', 'Add a privacy-aware Referrer-Policy header.');
  }
  if (!headers['permissions-policy']) {
    add('low', 'Missing Permissions-Policy header', 'permissions-policy header not present', 'Add a Permissions-Policy header for unused browser features.');
  }

  const insecureResources = page.parsed?.insecureResourceUrls;
  if (insecureResources && insecureResources.length > 0) {
    add(
      'medium',
      'Mixed content references detected',
      `The downloaded HTML references HTTP resources: ${insecureResources.join(', ')}. Browser loading or blocking was not observed.`,
      'Update insecure asset references to HTTPS.'
    );
  }

  const insecureFormActions = page.parsed?.insecureFormActionUrls;
  if (insecureFormActions && insecureFormActions.length > 0) {
    add(
      'high',
      'Insecure form action detected',
      `The downloaded HTML contains HTTP form targets: ${insecureFormActions.join(', ')}. Browser submission was not observed.`,
      'Use HTTPS form actions for all public forms.'
    );
  }

  return issues;
}
