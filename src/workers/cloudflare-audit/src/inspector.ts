import { cloudflarePublicFetch } from '../../../audit-core/adapters/cloudflare-network-adapter';
import { extractWithHtmlRewriter, type ExtractedPageEvidence } from '../../../audit-core/extractors/cloudflare-html-extractor';
import { runAllChecksSafely, buildSecurityIssues, mapAuditIssue } from '../../../audit-core/checks';
import { normalizeCrawlUrl } from '../../../audit-core/url';

export interface SecurityAuditResult {
  score: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  https: boolean;
  hsts: boolean;
  csp: boolean;
  xFrameOptions: boolean;
  xContentTypeOptions: boolean;
  referrerPolicy: boolean;
  permissionsPolicy: boolean;
  findings: string[];
}

export interface HeadingOutlineItem {
  level: number;
  text: string;
}

export interface SchemaValidationItem {
  raw: string;
  parsed: unknown | null;
  types: string[];
  isValidJson: boolean;
  errors: string[];
}

export interface PageInspectionReport {
  url: string;
  finalUrl: string;
  statusCode: number;
  fetchDurationMs: number;
  htmlSizeBytes: number;
  wordCount: number;
  estimatedReadingTimeMinutes: number;
  meta: {
    title: string;
    titleLength: number;
    metaDescription: string;
    descriptionLength: number;
    canonical: string;
    metaRobots: string;
    lang: string;
    viewport: string;
  };
  social: {
    openGraph: {
      title: string;
      description: string;
      image: string;
      siteName: string;
    };
    twitter: {
      card: string;
      title: string;
      description: string;
      image: string;
    };
    faviconUrl: string;
    themeColor: string;
  };
  headings: {
    h1: string[];
    h2: string[];
    h3: string[];
    outline: HeadingOutlineItem[];
    hierarchyIssues: string[];
  };
  structuredData: {
    totalBlocks: number;
    schemas: SchemaValidationItem[];
  };
  security: SecurityAuditResult;
  accessibility: {
    totalImages: number;
    missingAlt: number;
    emptyAlt: number;
    altCoveragePercent: number;
    unnamedLinks: number;
    unnamedButtons: number;
    unlabeledFields: number;
    zoomRestricted: boolean;
  };
  links: {
    internalCount: number;
    externalCount: number;
    sampleInternal: Array<{ href: string; text: string }>;
    sampleExternal: Array<{ href: string; text: string; rel: string }>;
  };
  seoIssues: Array<{
    severity: string;
    category: string;
    title: string;
    description: string;
    recommendation: string;
  }>;
}

function calculateSecurityGrade(headers: Record<string, string>, isHttps: boolean): SecurityAuditResult {
  let score = 0;
  const findings: string[] = [];

  if (isHttps) {
    score += 20;
  } else {
    findings.push('Page is not served over secure HTTPS.');
  }

  const hsts = Boolean(headers['strict-transport-security']);
  if (hsts && isHttps) {
    score += 20;
  } else {
    findings.push('Missing Strict-Transport-Security (HSTS) header.');
  }

  const csp = Boolean(headers['content-security-policy']);
  if (csp) {
    score += 20;
  } else {
    findings.push('Missing Content-Security-Policy (CSP) header.');
  }

  const xfo = Boolean(headers['x-frame-options']) || (csp && headers['content-security-policy'].includes('frame-ancestors'));
  if (xfo) {
    score += 15;
  } else {
    findings.push('Missing Clickjacking protection (X-Frame-Options or frame-ancestors).');
  }

  const xcto = Boolean(headers['x-content-type-options']);
  if (xcto) {
    score += 10;
  } else {
    findings.push('Missing X-Content-Type-Options: nosniff header.');
  }

  const referrer = Boolean(headers['referrer-policy']);
  if (referrer) {
    score += 10;
  } else {
    findings.push('Missing Referrer-Policy header.');
  }

  const permissions = Boolean(headers['permissions-policy']);
  if (permissions) {
    score += 5;
  } else {
    findings.push('Missing Permissions-Policy header.');
  }

  let grade: SecurityAuditResult['grade'] = 'F';
  if (score >= 95) grade = 'A+';
  else if (score >= 85) grade = 'A';
  else if (score >= 70) grade = 'B';
  else if (score >= 55) grade = 'C';
  else if (score >= 40) grade = 'D';

  return {
    score,
    grade,
    https: isHttps,
    hsts,
    csp,
    xFrameOptions: xfo,
    xContentTypeOptions: xcto,
    referrerPolicy: referrer,
    permissionsPolicy: permissions,
    findings,
  };
}

function parseAndValidateJsonLd(jsonStrings: string[]): SchemaValidationItem[] {
  return jsonStrings.map((raw) => {
    const trimmed = raw.trim();
    const errors: string[] = [];
    let parsed: any = null;
    let types: string[] = [];

    try {
      parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item?.['@type']) types.push(String(item['@type']));
        }
      } else if (parsed && typeof parsed === 'object') {
        if (parsed['@graph'] && Array.isArray(parsed['@graph'])) {
          for (const item of parsed['@graph']) {
            if (item?.['@type']) types.push(String(item['@type']));
          }
        } else if (parsed['@type']) {
          types.push(String(parsed['@type']));
        }
        if (!parsed['@context']) {
          errors.push('Schema block is missing "@context": "https://schema.org".');
        }
      } else {
        errors.push('JSON-LD does not contain a valid schema object or graph array.');
      }
    } catch (err: any) {
      errors.push(`JSON Syntax Error: ${err.message || 'Invalid JSON syntax'}`);
    }

    return {
      raw: trimmed.length > 500 ? `${trimmed.slice(0, 500)}...` : trimmed,
      parsed: errors.length === 0 ? parsed : null,
      types: [...new Set(types)],
      isValidJson: errors.length === 0,
      errors,
    };
  });
}

function evaluateHeadingHierarchy(h1: string[], h2: string[], h3: string[]): { outline: HeadingOutlineItem[]; issues: string[] } {
  const outline: HeadingOutlineItem[] = [];
  const issues: string[] = [];

  if (h1.length === 0) {
    issues.push('Missing H1 heading: Every page should have exactly one main H1 heading.');
  } else if (h1.length > 1) {
    issues.push(`Multiple H1 headings detected (${h1.length}): Best practice is a single main H1 topic per page.`);
  }

  for (const text of h1) outline.push({ level: 1, text });
  for (const text of h2) outline.push({ level: 2, text });
  for (const text of h3) outline.push({ level: 3, text });

  if (h1.length === 0 && (h2.length > 0 || h3.length > 0)) {
    issues.push('Heading hierarchy skipped H1: Page has subheadings (H2/H3) without a primary H1.');
  }

  return { outline, issues };
}

export async function inspectPage(targetUrl: string): Promise<PageInspectionReport> {
  const normalized = normalizeCrawlUrl(targetUrl) || targetUrl;
  const fetchResult = await cloudflarePublicFetch(normalized, {
    timeoutMs: 10_000,
    maxBytes: 3_000_000,
    maxRedirects: 5,
  });

  const responseObj = new Response(fetchResult.body, {
    status: fetchResult.status,
    headers: fetchResult.headers,
  });

  const evidence: ExtractedPageEvidence = await extractWithHtmlRewriter(responseObj, {
    url: targetUrl,
    finalUrl: fetchResult.finalUrl,
    statusCode: fetchResult.status,
    responseTimeMs: fetchResult.durationMs,
    pageSizeBytes: fetchResult.bodyBytes,
    contentType: fetchResult.contentType,
    headers: fetchResult.headers,
    depth: 0,
    source: 'inspect',
  });

  const isHttps = fetchResult.finalUrl.startsWith('https://');
  const security = calculateSecurityGrade(fetchResult.headers, isHttps);
  const headingsAnalysis = evaluateHeadingHierarchy(evidence.h1, evidence.h2, evidence.h3);
  const schemas = parseAndValidateJsonLd(evidence.jsonLd);

  const checkRun = runAllChecksSafely(evidence);
  const seoIssues = checkRun.issues.map((issue) => {
    const mapped = mapAuditIssue(issue, fetchResult.finalUrl);
    return {
      severity: mapped.severity,
      category: mapped.category,
      title: mapped.title,
      description: mapped.description,
      recommendation: mapped.recommendation,
    };
  });

  const securityIssues = buildSecurityIssues({
    finalUrl: fetchResult.finalUrl,
    headers: fetchResult.headers,
    parsed: evidence,
  });
  for (const sec of securityIssues) {
    seoIssues.push({
      severity: sec.severity,
      category: 'security',
      title: sec.title,
      description: sec.description,
      recommendation: sec.recommendation,
    });
  }

  const totalImages = evidence.imageCount;
  const missingAlt = evidence.imagesWithoutAlt;
  const emptyAlt = evidence.imagesWithEmptyAlt || 0;
  const goodAlt = Math.max(0, totalImages - missingAlt - emptyAlt);
  const altCoveragePercent = totalImages > 0 ? Math.round((goodAlt / totalImages) * 100) : 100;

  return {
    url: targetUrl,
    finalUrl: fetchResult.finalUrl,
    statusCode: fetchResult.status,
    fetchDurationMs: fetchResult.durationMs,
    htmlSizeBytes: fetchResult.bodyBytes,
    wordCount: evidence.wordCount,
    estimatedReadingTimeMinutes: Math.max(1, Math.ceil(evidence.wordCount / 200)),
    meta: {
      title: evidence.title,
      titleLength: evidence.title.length,
      metaDescription: evidence.metaDescription,
      descriptionLength: evidence.metaDescription.length,
      canonical: evidence.canonical,
      metaRobots: evidence.metaRobots,
      lang: evidence.lang,
      viewport: evidence.viewport,
    },
    social: {
      openGraph: {
        title: evidence.ogTitle,
        description: evidence.ogDescription,
        image: evidence.ogImage,
        siteName: evidence.siteName,
      },
      twitter: {
        card: evidence.twitterCard,
        title: evidence.ogTitle,
        description: evidence.ogDescription,
        image: evidence.ogImage,
      },
      faviconUrl: evidence.faviconUrl,
      themeColor: evidence.themeColor,
    },
    headings: {
      h1: evidence.h1,
      h2: evidence.h2,
      h3: evidence.h3,
      outline: headingsAnalysis.outline,
      hierarchyIssues: headingsAnalysis.issues,
    },
    structuredData: {
      totalBlocks: schemas.length,
      schemas,
    },
    security,
    accessibility: {
      totalImages,
      missingAlt,
      emptyAlt,
      altCoveragePercent,
      unnamedLinks: evidence.accessibility.unnamedLinks,
      unnamedButtons: evidence.accessibility.unnamedButtons,
      unlabeledFields: evidence.accessibility.unlabeledFields,
      zoomRestricted: evidence.accessibility.zoomRestricted,
    },
    links: {
      internalCount: evidence.internalLinks.length,
      externalCount: evidence.externalLinks.length,
      sampleInternal: evidence.internalLinks.slice(0, 10),
      sampleExternal: evidence.externalLinks.slice(0, 10),
    },
    seoIssues,
  };
}
