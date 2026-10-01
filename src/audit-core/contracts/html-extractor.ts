import type { PageEvidence } from './evidence';
import type { ExecutorType } from './executor';

/**
 * Input for HTML extraction.
 */
export interface HtmlExtractionInput {
  url: string;
  finalUrl: string;
  statusCode: number;
  responseTimeMs: number;
  pageSizeBytes: number;
  contentType: string;
  headers: Record<string, string>;
  body: string;
  depth: number;
  source: string;
  executor: ExecutorType;
}

/**
 * Abstract HTML extractor interface.
 */
export interface AuditHtmlExtractor {
  extract(input: HtmlExtractionInput): PageEvidence;
  readonly extractorVersion: string;
}
