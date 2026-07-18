type UnknownRecord = Record<string, unknown>;

const SECRET_KEY_PATTERN = /(?:authorization|cookie|set-cookie|password|passwd|secret|token|api[_-]?key|service[_-]?role|private[_-]?key|connection[_-]?(?:string|url)|oauth[_-]?code|dsn)/i;
const CONTENT_KEY_PATTERN = /(?:^|[_-])(?:body|html|content|prompt|response|report|export|sitemap|robots|crawl[_-]?evidence)(?:$|[_-])/i;
const URL_KEY_PATTERN = /(?:^|[_-])(?:url|uri|href|origin|target)(?:$|[_-])/i;
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:sb_secret|sntrys|gsk|sk_live|sk_test)_[A-Za-z0-9_-]+\b/gi,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi,
];
const SECRET_ASSIGNMENT_PATTERN = /((?:authorization|password|secret|token|api[_-]?key|service[_-]?role|private[_-]?key)\s*[:=]\s*)[^\s,;}"']+/gi;

const EXPECTED_ERROR_PATTERNS = [
  /^AbortError$/i,
  /\bAUDIT_CANCELLED\b/i,
  /\buser[- ]initiated cancellation\b/i,
  /\bResizeObserver loop (?:limit exceeded|completed with undelivered notifications)\b/i,
];

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function sanitizeUrl(value: unknown, keepPath = false) {
  if (typeof value !== 'string' || !value.trim()) return value;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return keepPath ? `${url.origin}${url.pathname}` : url.origin;
  } catch {
    return redactSensitiveString(value);
  }
}

export function redactSensitiveString(value: string) {
  let output = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    output = output.replace(pattern, '[redacted]');
  }
  output = output.replace(SECRET_ASSIGNMENT_PATTERN, '$1[redacted]');
  output = output.replace(
    /https?:\/\/[^\s"'<>]+/gi,
    (match) => String(sanitizeUrl(match, false)),
  );
  return output.slice(0, 8_000);
}

export function scrubUnknown(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return redactSensitiveString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => scrubUnknown(entry, depth + 1));
  if (!isRecord(value)) return String(value);

  const output: UnknownRecord = {};
  for (const [key, entry] of Object.entries(value).slice(0, 100)) {
    const normalizedKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (SECRET_KEY_PATTERN.test(normalizedKey)) {
      output[key] = '[redacted]';
      continue;
    }
    if (CONTENT_KEY_PATTERN.test(normalizedKey)) {
      output[key] = '[omitted]';
      continue;
    }
    output[key] = URL_KEY_PATTERN.test(normalizedKey)
      ? sanitizeUrl(entry, false)
      : scrubUnknown(entry, depth + 1);
  }
  return output;
}

function scrubHeaders(headers: unknown) {
  if (!isRecord(headers)) return {};
  const output: UnknownRecord = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    output[key] = scrubUnknown(value);
  }
  return output;
}

function removeUserIdentity(user: unknown) {
  if (!isRecord(user)) return undefined;
  const safe = { ...user };
  delete safe.email;
  delete safe.ip_address;
  delete safe.username;
  delete safe.name;
  delete safe.id;
  return Object.keys(safe).length ? scrubUnknown(safe) : undefined;
}

export function isExpectedMonitoringError(error: unknown, offline = false) {
  if (offline) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (/failed to fetch|networkerror|network request failed/i.test(message)) return true;
  }
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error || '');
  return EXPECTED_ERROR_PATTERNS.some((pattern) => pattern.test(name) || pattern.test(message));
}

export function scrubSentryEvent<T extends UnknownRecord>(event: T, hint?: UnknownRecord): T | null {
  if (isExpectedMonitoringError(hint?.originalException)) return null;

  const safe = { ...event } as UnknownRecord;
  if (isRecord(safe.request)) {
    safe.request = {
      ...safe.request,
      url: sanitizeUrl(safe.request.url, true),
      query_string: undefined,
      cookies: undefined,
      data: undefined,
      headers: scrubHeaders(safe.request.headers),
    };
  }
  safe.user = removeUserIdentity(safe.user);
  if (safe.contexts) safe.contexts = scrubUnknown(safe.contexts);
  if (safe.extra) safe.extra = scrubUnknown(safe.extra);
  if (safe.tags) safe.tags = scrubUnknown(safe.tags);

  if (Array.isArray(safe.breadcrumbs)) {
    safe.breadcrumbs = safe.breadcrumbs.slice(-50).map((breadcrumb) => {
      if (!isRecord(breadcrumb)) return breadcrumb;
      return {
        ...breadcrumb,
        message: typeof breadcrumb.message === 'string' ? redactSensitiveString(breadcrumb.message) : breadcrumb.message,
        data: scrubUnknown(breadcrumb.data),
      };
    });
  }

  if (Array.isArray(safe.exception && isRecord(safe.exception) ? safe.exception.values : null)) {
    const exception = safe.exception as UnknownRecord;
    exception.values = (exception.values as unknown[]).map((entry) => {
      if (!isRecord(entry)) return entry;
      return {
        ...entry,
        value: typeof entry.value === 'string' ? redactSensitiveString(entry.value) : entry.value,
      };
    });
  }

  if (hint && Array.isArray(hint.attachments)) hint.attachments = [];
  return safe as T;
}

export function scrubSentryBreadcrumb<T extends UnknownRecord>(breadcrumb: T): T | null {
  if (breadcrumb.category === 'console' || breadcrumb.category === 'ui.input') return null;
  const safe = {
    ...breadcrumb,
    message: typeof breadcrumb.message === 'string' ? redactSensitiveString(breadcrumb.message) : breadcrumb.message,
    data: breadcrumb.category === 'ui.click' ? undefined : scrubUnknown(breadcrumb.data),
  };
  return safe as T;
}

export function scrubSentrySpan<T extends UnknownRecord>(span: T): T {
  const safe = {
    ...span,
    description: typeof span.description === 'string'
      ? redactSensitiveString(span.description)
      : span.description,
    data: scrubUnknown(span.data),
  };
  return safe as T;
}
