import type { ExecutorType } from './executor';

/**
 * Normalized page evidence collected during an audit (Phase 4).
 */
export interface PageEvidence {
  evidenceVersion: string; // start with '1.0'
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  
  fetch: {
    responseTimeMs: number;
    contentType: string;
    contentLengthBytes: number;
  };
  
  metadata: {
    title: string;
    metaDescription: string;
    metaRobots: string;
    canonical: string;
    canonicalRaw: string;
    htmlLang: string;
    viewport: string;
  };
  
  headings: {
    h1: string[];
    h2: string[];
    h3: string[];
  };
  
  links: {
    internal: Array<{ href: string; text: string }>;
    external: Array<{ href: string; text: string; rel: string }>;
  };
  
  images: {
    total: number;
    missingAlt: number;
    emptyAlt: number;
  };
  
  hreflang: string[];
  structuredData: string[]; // JSON-LD strings
  
  openGraph: {
    title: string;
    description: string;
    image: string;
    siteName: string;
    type?: string;
  };
  
  twitter: {
    card: string;
    title: string;
    description: string;
    image: string;
  };
  
  securityHeaders: {
    hsts?: string;
    csp?: string;
    xContentTypeOptions?: string;
    xFrameOptions?: string;
    referrerPolicy?: string;
    permissionsPolicy?: string;
  };
  
  textStats: {
    wordCount: number;
    topKeywords: string[];
    topPhrases: string[];
  };
  
  accessibility: {
    unnamedLinks: number;
    unnamedButtons: number;
    unlabeledFields: number;
    mainLandmarks: number;
    duplicateIds: number;
    brokenAriaReferences: number;
    positiveTabindex: number;
    hiddenFocusableElements: number;
    zoomRestricted: boolean;
  };
  
  insecureResources: {
    resourceUrls: string[];
    formActionUrls: string[];
  };
  
  likelyJavascriptShell: boolean;
  
  discovery: {
    source: string;
    depth: number;
  };
  
  runtime: {
    executor: ExecutorType;
    extractorVersion: string;
  };
}
