export type AuditFailureCode =
  | 'DNS_NAME_NOT_FOUND'
  | 'DNS_TEMPORARY_FAILURE'
  | 'CONNECTION_TIMEOUT'
  | 'CONNECTION_REFUSED'
  | 'CONNECTION_RESET'
  | 'TLS_CERTIFICATE_INVALID'
  | 'HTTPS_UNAVAILABLE'
  | 'HTTP_400'
  | 'HTTP_401'
  | 'HTTP_403'
  | 'HTTP_404'
  | 'HTTP_410'
  | 'HTTP_429'
  | 'HTTP_500'
  | 'HTTP_502'
  | 'HTTP_503'
  | 'HTTP_504'
  | 'HTTP_ERROR'
  | 'REDIRECT_LOOP'
  | 'TOO_MANY_REDIRECTS'
  | 'INVALID_REDIRECT_TARGET'
  | 'UNSAFE_REDIRECT_TARGET'
  | 'ROBOTS_BLOCKED'
  | 'NOINDEX_DETECTED'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'RESPONSE_TOO_LARGE'
  | 'EMPTY_RESPONSE'
  | 'INVALID_HTML_RESPONSE'
  | 'PRIVATE_NETWORK_BLOCKED'
  | 'UNSUPPORTED_PORT'
  | 'EMBEDDED_CREDENTIALS'
  | 'CHECK_UNAVAILABLE'
  | 'AUDIT_DEADLINE_EXCEEDED'
  | 'UNKNOWN_TARGET_FAILURE';

export type AuditFailureCategory = 'dns' | 'connection' | 'tls' | 'http' | 'redirect' | 'crawl' | 'content' | 'security-policy' | 'analysis' | 'audit-limit';

export interface AuditFailure {
  code: AuditFailureCode;
  category: AuditFailureCategory;
  safeTitle: string;
  safeExplanation: string;
  suggestedAction: string;
  affectedUrl: string;
  httpStatus: number | null;
  retryable: boolean;
  attemptCount: number;
  recoveredAfterRetry: boolean;
  internalDetails: string;
}

export interface AuditFailureContext {
  affectedUrl?: string;
  httpStatus?: number | null;
  attemptCount?: number;
  recoveredAfterRetry?: boolean;
  internalDetails?: string;
}

type FailureCopy = Omit<AuditFailure, 'affectedUrl' | 'httpStatus' | 'attemptCount' | 'recoveredAfterRetry' | 'internalDetails'>;

const COPY: Record<AuditFailureCode, FailureCopy> = {
  DNS_NAME_NOT_FOUND: { code: 'DNS_NAME_NOT_FOUND', category: 'dns', safeTitle: 'Domain name did not resolve', safeExplanation: 'The hostname for this URL did not return a valid public IP address during the audit. The hostname may be incorrect, the subdomain may no longer exist, or its DNS records may be missing.', suggestedAction: 'Check the hostname and DNS records. Remove or update links pointing to this address if the page no longer exists.', retryable: false },
  DNS_TEMPORARY_FAILURE: { code: 'DNS_TEMPORARY_FAILURE', category: 'dns', safeTitle: 'Temporary DNS lookup failure', safeExplanation: 'The domain’s DNS service did not respond successfully during this attempt. The audit retried the request but could not confirm the page.', suggestedAction: 'Check the domain’s DNS availability and run the audit again if the issue was temporary.', retryable: true },
  CONNECTION_TIMEOUT: { code: 'CONNECTION_TIMEOUT', category: 'connection', safeTitle: 'Connection timed out', safeExplanation: 'The website did not respond within the audit’s safe request time limit.', suggestedAction: 'Check server response time, hosting availability, firewall rules, and CDN configuration.', retryable: true },
  CONNECTION_REFUSED: { code: 'CONNECTION_REFUSED', category: 'connection', safeTitle: 'Connection was refused', safeExplanation: 'The hostname responded, but the web server refused the connection.', suggestedAction: 'Confirm that the website server is online and accepting public HTTP or HTTPS traffic.', retryable: false },
  CONNECTION_RESET: { code: 'CONNECTION_RESET', category: 'connection', safeTitle: 'Connection was interrupted', safeExplanation: 'The connection was closed before the page response finished downloading.', suggestedAction: 'Check server stability, CDN settings, proxy configuration, and connection limits.', retryable: true },
  TLS_CERTIFICATE_INVALID: { code: 'TLS_CERTIFICATE_INVALID', category: 'tls', safeTitle: 'HTTPS certificate validation failed', safeExplanation: 'The website presented an HTTPS certificate that could not be validated. It may be expired, issued for another hostname, incomplete, or signed by an untrusted authority.', suggestedAction: 'Renew or correct the TLS certificate and verify that the certificate covers this hostname.', retryable: false },
  HTTPS_UNAVAILABLE: { code: 'HTTPS_UNAVAILABLE', category: 'tls', safeTitle: 'HTTPS was unavailable', safeExplanation: 'The audit could not establish a secure HTTPS connection to this URL.', suggestedAction: 'Enable HTTPS, install a valid certificate, and redirect public HTTP traffic to HTTPS.', retryable: false },
  HTTP_400: { code: 'HTTP_400', category: 'http', safeTitle: 'Page returned HTTP 400', safeExplanation: 'The server rejected the request as invalid.', suggestedAction: 'Check the URL, routing rules, request handling, and server or CDN configuration affecting this page.', retryable: false },
  HTTP_401: { code: 'HTTP_401', category: 'http', safeTitle: 'Authentication was required', safeExplanation: 'The page returned HTTP 401 and requires authentication. Public audit checks could not access its content.', suggestedAction: 'Confirm whether this page is intentionally private. Remove it from public sitemaps and crawl paths if it should not be indexed.', retryable: false },
  HTTP_403: { code: 'HTTP_403', category: 'http', safeTitle: 'Access was denied', safeExplanation: 'The server returned HTTP 403 and blocked the audit from accessing this page.', suggestedAction: 'Review firewall, CDN, bot-protection, geo-blocking, and access-control rules. Confirm whether search crawlers can access the page.', retryable: false },
  HTTP_404: { code: 'HTTP_404', category: 'http', safeTitle: 'Page returned 404 Not Found', safeExplanation: 'The requested URL does not currently contain an available page. Visitors and crawlers following links to it cannot reach the intended content.', suggestedAction: 'Restore the page, redirect it to the most relevant replacement, or remove internal links and sitemap entries pointing to it.', retryable: false },
  HTTP_410: { code: 'HTTP_410', category: 'http', safeTitle: 'Page was permanently removed', safeExplanation: 'The server returned HTTP 410, indicating that the resource was intentionally removed.', suggestedAction: 'Remove internal links and sitemap entries, or redirect the URL when a relevant replacement exists.', retryable: false },
  HTTP_429: { code: 'HTTP_429', category: 'http', safeTitle: 'The website rate-limited the audit', safeExplanation: 'The server returned HTTP 429 because too many requests were received within a short period.', suggestedAction: 'Review rate-limit, firewall, CDN, and bot-protection settings. Confirm that legitimate crawlers are not being unnecessarily blocked.', retryable: true },
  HTTP_500: { code: 'HTTP_500', category: 'http', safeTitle: 'Website returned an internal server error', safeExplanation: 'The server returned HTTP 500 while processing this page.', suggestedAction: 'Review application logs, server errors, plugin failures, and backend dependencies.', retryable: false },
  HTTP_502: { code: 'HTTP_502', category: 'http', safeTitle: 'Website gateway returned an error', safeExplanation: 'The server returned HTTP 502 because a gateway, proxy, CDN, or upstream service did not return the page successfully.', suggestedAction: 'Check gateway, proxy, CDN, hosting, and upstream application health.', retryable: true },
  HTTP_503: { code: 'HTTP_503', category: 'http', safeTitle: 'Website was temporarily unavailable', safeExplanation: 'The server returned HTTP 503 because the website or an upstream service was temporarily unavailable.', suggestedAction: 'Check hosting capacity, maintenance state, application health, and upstream dependencies.', retryable: true },
  HTTP_504: { code: 'HTTP_504', category: 'http', safeTitle: 'Website gateway timed out', safeExplanation: 'The server returned HTTP 504 because a gateway, proxy, CDN, or upstream service did not respond in time.', suggestedAction: 'Check upstream response time, gateway timeouts, hosting health, and application dependencies.', retryable: true },
  HTTP_ERROR: { code: 'HTTP_ERROR', category: 'http', safeTitle: 'Page returned an HTTP error', safeExplanation: 'The server returned an error response and the page content could not be audited reliably.', suggestedAction: 'Review the response status, URL routing, access controls, and server health.', retryable: false },
  REDIRECT_LOOP: { code: 'REDIRECT_LOOP', category: 'redirect', safeTitle: 'Redirect loop detected', safeExplanation: 'This URL repeatedly redirected between the same addresses and could not reach a final page.', suggestedAction: 'Correct the redirect rules so the URL reaches one final preferred destination.', retryable: false },
  TOO_MANY_REDIRECTS: { code: 'TOO_MANY_REDIRECTS', category: 'redirect', safeTitle: 'Too many redirects', safeExplanation: 'The URL exceeded the audit’s safe redirect limit before reaching a final page.', suggestedAction: 'Shorten the redirect chain and point links directly to the final destination.', retryable: false },
  INVALID_REDIRECT_TARGET: { code: 'INVALID_REDIRECT_TARGET', category: 'redirect', safeTitle: 'Redirect target was invalid', safeExplanation: 'The page redirected to an invalid, unsupported, or malformed destination.', suggestedAction: 'Correct the Location header or redirect rule.', retryable: false },
  UNSAFE_REDIRECT_TARGET: { code: 'UNSAFE_REDIRECT_TARGET', category: 'security-policy', safeTitle: 'Redirect pointed to a restricted network address', safeExplanation: 'The URL redirected away from a public website to an address that cannot be audited safely.', suggestedAction: 'Review the redirect target and ensure public URLs resolve only to valid public web addresses.', retryable: false },
  ROBOTS_BLOCKED: { code: 'ROBOTS_BLOCKED', category: 'crawl', safeTitle: 'Page was blocked by robots.txt', safeExplanation: 'The website’s robots.txt rules prevented the audit crawler from accessing this URL.', suggestedAction: 'Confirm whether the page should be blocked. Update robots.txt if search crawlers need access.', retryable: false },
  NOINDEX_DETECTED: { code: 'NOINDEX_DETECTED', category: 'crawl', safeTitle: 'Page contains a noindex directive', safeExplanation: 'This page instructs search engines not to include it in search results. The exclusion may be intentional and should be reviewed in context.', suggestedAction: 'Confirm whether noindex is intentional. Check sitemap inclusion and internal prominence, then remove it only when the page should appear in search.', retryable: false },
  UNSUPPORTED_CONTENT_TYPE: { code: 'UNSUPPORTED_CONTENT_TYPE', category: 'content', safeTitle: 'Content type was not suitable for an HTML audit', safeExplanation: 'The URL returned a file type that the page audit does not analyse, such as an image, archive, document, media file, or binary response.', suggestedAction: 'Confirm that internal links and sitemap entries point to the intended page or file.', retryable: false },
  RESPONSE_TOO_LARGE: { code: 'RESPONSE_TOO_LARGE', category: 'content', safeTitle: 'Page response exceeded the safe analysis limit', safeExplanation: 'The response was larger than the maximum size the audit can safely process.', suggestedAction: 'Reduce excessive HTML or inline data and check whether the URL is returning the intended page.', retryable: false },
  EMPTY_RESPONSE: { code: 'EMPTY_RESPONSE', category: 'content', safeTitle: 'Page returned an empty response', safeExplanation: 'The server responded, but no usable page content was returned.', suggestedAction: 'Check the application response, template rendering, server configuration, and caching layer.', retryable: false },
  INVALID_HTML_RESPONSE: { code: 'INVALID_HTML_RESPONSE', category: 'content', safeTitle: 'Page content could not be analysed reliably', safeExplanation: 'The response was received, but its markup could not be processed reliably by the audit engine.', suggestedAction: 'Validate the page markup and check whether the server returned incomplete or malformed content.', retryable: false },
  PRIVATE_NETWORK_BLOCKED: { code: 'PRIVATE_NETWORK_BLOCKED', category: 'security-policy', safeTitle: 'Address is not a public website', safeExplanation: 'The target resolved to a private, local, reserved, or otherwise restricted network address and was not requested.', suggestedAction: 'Use a publicly reachable HTTP or HTTPS website address.', retryable: false },
  UNSUPPORTED_PORT: { code: 'UNSUPPORTED_PORT', category: 'security-policy', safeTitle: 'Website port is not supported', safeExplanation: 'The address uses a network port outside the audit’s safe public HTTP and HTTPS policy.', suggestedAction: 'Use the website’s standard public HTTP or HTTPS address.', retryable: false },
  EMBEDDED_CREDENTIALS: { code: 'EMBEDDED_CREDENTIALS', category: 'security-policy', safeTitle: 'Website address contains credentials', safeExplanation: 'Addresses containing embedded usernames or passwords cannot be audited safely.', suggestedAction: 'Remove credentials and submit the public website address.', retryable: false },
  CHECK_UNAVAILABLE: { code: 'CHECK_UNAVAILABLE', category: 'analysis', safeTitle: 'One audit check was unavailable', safeExplanation: 'A single check could not process the available evidence. The remaining checks continued.', suggestedAction: 'Review the audit limitations and rerun the audit if this check is important.', retryable: false },
  AUDIT_DEADLINE_EXCEEDED: { code: 'AUDIT_DEADLINE_EXCEEDED', category: 'audit-limit', safeTitle: 'Audit time limit was reached', safeExplanation: 'The audit stopped scheduling additional pages after reaching its resource-safe time limit. Completed evidence was preserved.', suggestedAction: 'Review the completed coverage or run a narrower audit scope.', retryable: false },
  UNKNOWN_TARGET_FAILURE: { code: 'UNKNOWN_TARGET_FAILURE', category: 'connection', safeTitle: 'The page could not be analysed', safeExplanation: 'The website request did not complete successfully, but no more specific safe category was available.', suggestedAction: 'Check the URL and website availability, then run the audit again.', retryable: false },
};

const LEGACY_CODE_MAP: Record<string, AuditFailureCode> = {
  DNS_FAILURE: 'DNS_NAME_NOT_FOUND', DNS_TIMEOUT: 'DNS_TEMPORARY_FAILURE', REQUEST_TIMEOUT: 'CONNECTION_TIMEOUT',
  REQUEST_FAILED: 'UNKNOWN_TARGET_FAILURE', PRIVATE_NETWORK_TARGET: 'PRIVATE_NETWORK_BLOCKED',
  REDIRECT_WITHOUT_LOCATION: 'INVALID_REDIRECT_TARGET',
};

export function isAuditFailureCode(value: unknown): value is AuditFailureCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(COPY, value);
}

export function failureForCode(code: AuditFailureCode, context: AuditFailureContext = {}): AuditFailure {
  const copy = COPY[code];
  return {
    ...copy,
    affectedUrl: context.affectedUrl || '',
    httpStatus: context.httpStatus ?? null,
    attemptCount: Math.max(1, context.attemptCount || 1),
    recoveredAfterRetry: Boolean(context.recoveredAfterRetry),
    internalDetails: context.internalDetails || '',
  };
}

export function failureForHttpStatus(status: number, context: AuditFailureContext = {}) {
  const exact = `HTTP_${status}` as AuditFailureCode;
  const code = exact in COPY ? exact : 'HTTP_ERROR';
  return failureForCode(code, { ...context, httpStatus: status });
}

function rawErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return '';
  const value = error as { code?: unknown; cause?: { code?: unknown } };
  return String(value.code || value.cause?.code || '').toUpperCase();
}

export function internalDiagnostic(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 4000);
  return String(error || 'Unknown error').slice(0, 4000);
}

export function classifyAuditFailure(error: unknown, context: AuditFailureContext = {}): AuditFailure {
  const code = rawErrorCode(error);
  const detail = context.internalDetails || internalDiagnostic(error);
  const mappedCode = LEGACY_CODE_MAP[code] || (code in COPY ? code as AuditFailureCode : null);
  if (mappedCode) return failureForCode(mappedCode, { ...context, internalDetails: detail });

  if (code === 'ENOTFOUND' || code === 'ENODATA') return failureForCode('DNS_NAME_NOT_FOUND', { ...context, internalDetails: detail });
  if (code === 'EAI_AGAIN') return failureForCode('DNS_TEMPORARY_FAILURE', { ...context, internalDetails: detail });
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return failureForCode('CONNECTION_TIMEOUT', { ...context, internalDetails: detail });
  if (code === 'ECONNREFUSED') return failureForCode('CONNECTION_REFUSED', { ...context, internalDetails: detail });
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET') return failureForCode('CONNECTION_RESET', { ...context, internalDetails: detail });
  if (/CERT|TLS|SSL|UNABLE_TO_VERIFY|SELF_SIGNED|WRONG_VERSION_NUMBER/.test(code)) return failureForCode('TLS_CERTIFICATE_INVALID', { ...context, internalDetails: detail });

  const message = detail.toLowerCase();
  if (/getaddrinfo|name or service not known|enotfound/.test(message)) return failureForCode('DNS_NAME_NOT_FOUND', { ...context, internalDetails: detail });
  if (/timed? ?out|timeout/.test(message)) return failureForCode('CONNECTION_TIMEOUT', { ...context, internalDetails: detail });
  if (/certificate|tls|ssl/.test(message)) return failureForCode('TLS_CERTIFICATE_INVALID', { ...context, internalDetails: detail });
  if (/redirect loop/.test(message)) return failureForCode('REDIRECT_LOOP', { ...context, internalDetails: detail });
  return failureForCode('UNKNOWN_TARGET_FAILURE', { ...context, internalDetails: detail });
}

const PRIVATE_DIAGNOSTIC_PATTERN = /\b(?:ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|getaddrinfo|socket hang up|SUPABASE|VERCEL|RENDER|ORACLE|worker-[\w-]+)\b/i;

export function customerSafeDiagnosticText(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (PRIVATE_DIAGNOSTIC_PATTERN.test(text) || /(?:at\s+\S+\s*\(|node:internal|\.ts:\d+:\d+)/i.test(text)) {
    return 'Additional technical diagnostics are available to administrators.';
  }
  return text;
}

export function aggregateFailureCounts(failures: AuditFailure[]) {
  return failures.reduce<Record<string, number>>((counts, failure) => {
    counts[failure.code] = (counts[failure.code] || 0) + 1;
    return counts;
  }, {});
}

export function failureProgressMessage(failure: AuditFailure, count = 1) {
  const subject = count === 1 ? '1 URL' : `${count} URLs`;
  if (failure.code === 'DNS_NAME_NOT_FOUND') return `${subject} did not resolve. The audit is continuing.`;
  if (failure.code === 'HTTP_404') return `${subject} returned HTTP 404. The audit is continuing.`;
  if (failure.code === 'HTTP_403') return `${subject} returned HTTP 403 and could not be analysed.`;
  if (failure.code === 'CONNECTION_TIMEOUT') return `${subject} timed out after retrying. The audit is continuing.`;
  if (failure.code === 'ROBOTS_BLOCKED') return `${subject} was blocked by robots.txt.`;
  if (failure.code === 'REDIRECT_LOOP') return `${count} redirect loop${count === 1 ? ' was' : 's were'} detected.`;
  return `${count} URL${count === 1 ? '' : 's'} reported: ${failure.safeTitle}. The audit is continuing.`;
}
