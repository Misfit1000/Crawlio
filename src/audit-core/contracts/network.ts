/**
 * Safe fetch result for audit network operations.
 */
export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  durationMs: number;
  bodyBytes: number;
  contentType: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Options for safe fetch.
 */
export interface SafeFetchOptions {
  timeoutMs: number;
  dnsTimeoutMs?: number;
  maxRedirects: number;
  maxBytes: number;
  allowedContentTypes: string[];
  allowPrivateForTesting?: boolean;
  allowNonStandardPortsForTesting?: boolean;
}

/**
 * Abstract network adapter interface for audits.
 */
export interface AuditNetworkAdapter {
  fetchSafe(url: string, options: SafeFetchOptions): Promise<SafeFetchResult>;
  resolveUrl(input: string, base?: string): string | null;
}
