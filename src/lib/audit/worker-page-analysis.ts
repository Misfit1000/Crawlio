import { parseHtml, type HtmlExtractionOptions, type ParsedPageData } from '../seo/html-parser';
import { normalizeUrl, stripTrackingParams } from '../seo/url-utils';
import type { SafePublicResponse } from '../security/safe-public-fetch';
import type { AuditIssue } from './types';
import type { AuditSeverity, ResourceAuditIssue } from './resource-types';

export type FetchedPage = {
  url: string;
  finalUrl: string;
  statusCode: number;
  responseTimeMs: number;
  pageSizeBytes: number;
  headers: Record<string, string>;
  contentType: string;
  html: string;
  parsed: ParsedPageData | null;
};

function toSeverity(value: string | undefined): AuditSeverity {
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low' || value === 'info') {
    return value;
  }
  return 'medium';
}

export function mapAuditIssue(issue: AuditIssue, fallbackUrl: string): Omit<ResourceAuditIssue, 'id' | 'detectedAt'> {
  const affectedUrl = issue.affectedUrl || fallbackUrl;
  return {
    severity: toSeverity(issue.severity),
    category: String(issue.category || 'seo'),
    title: issue.title || 'Audit issue',
    description: issue.description || issue.title || 'Audit issue detected.',
    affectedUrl,
    evidence: issue.evidence || issue.element || '',
    recommendation: issue.recommendation || 'Review this item and update the affected page.',
    checkId: issue.id,
    findingKey: `${issue.id}|${affectedUrl}`.toLowerCase(),
    sourceUrls: [],
    affectedPageCount: 1,
  };
}

export function buildSecurityIssues(page: FetchedPage, registeredChecks?: ReadonlySet<string>): Omit<ResourceAuditIssue, 'id' | 'detectedAt'>[] {
  const issues: Omit<ResourceAuditIssue, 'id' | 'detectedAt'>[] = [];
  const headers = page.headers;
  const add = (severity: AuditSeverity, title: string, evidence: string, recommendation: string, checkId?: string) => {
    if (checkId && registeredChecks?.has(checkId)) return;
    issues.push({
      severity,
      category: 'security',
      title,
      description: title,
      affectedUrl: page.finalUrl,
      evidence,
      recommendation,
      ...(registeredChecks && checkId ? { checkId } : {}),
    });
  };

  if (!page.finalUrl.startsWith('https://')) {
    add('high', 'Page is not served over HTTPS', page.finalUrl, 'Serve all public pages over HTTPS and redirect HTTP to HTTPS.');
  }
  if (!headers['strict-transport-security'] && page.finalUrl.startsWith('https://')) {
    add('medium', 'Missing HSTS header', 'strict-transport-security header not present', 'Add a Strict-Transport-Security header after HTTPS is stable.', 'missing-hsts');
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
  const securityEvidence = page.parsed?.insecureResourceUrls !== undefined && page.parsed?.insecureFormActionUrls !== undefined
    ? page.parsed
    : parseHtml(page.html, page.finalUrl);
  if (securityEvidence.insecureResourceUrls?.length) {
    add('medium', 'Mixed content references detected',
      `The downloaded HTML references HTTP resources: ${securityEvidence.insecureResourceUrls.join(', ')}. Browser loading or blocking was not observed.`,
      'Update insecure asset references to HTTPS.');
  }
  if (securityEvidence.insecureFormActionUrls?.length) {
    add('high', 'Insecure form action detected',
      `The downloaded HTML contains HTTP form targets: ${securityEvidence.insecureFormActionUrls.join(', ')}. Browser submission was not observed.`,
      'Use HTTPS form actions for all public forms.');
  }

  return issues;
}

export function parseFetchedPage(url: string, response: SafePublicResponse, extraction?: HtmlExtractionOptions): FetchedPage {
  let parsed: ParsedPageData | null = null;
  if (response.body) {
    try {
      parsed = parseHtml(response.body, response.finalUrl, { keywords: false, ...extraction });
    } catch (error) {
      const parseError = new Error(error instanceof Error ? error.message : 'HTML parsing failed.');
      (parseError as Error & { code: string }).code = 'INVALID_HTML_RESPONSE';
      throw parseError;
    }
  }
  return {
    url,
    finalUrl: response.finalUrl,
    statusCode: response.status,
    responseTimeMs: response.durationMs,
    pageSizeBytes: response.bodyBytes,
    headers: response.headers,
    contentType: response.contentType,
    html: response.body,
    parsed,
  };
}

export function normalizeCrawlUrl(input: string, base?: string) {
  const normalized = normalizeUrl(input, base);
  if (!normalized) return null;
  const url = new URL(stripTrackingParams(normalized));
  url.hash = '';
  return url.toString();
}
