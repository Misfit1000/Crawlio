import type { ResourceAuditPage } from '../audit/resource-types';

export const TOOL_LIMITS = Object.freeze({
  title: 512,
  description: 4000,
  siteName: 256,
  url: 2048,
  jsonBytes: 32 * 1024,
  outputBytes: 128 * 1024,
  jsonDepth: 8,
  jsonNodes: 2000,
  jsonString: 8192,
  jsonArray: 50,
  faqItems: 20,
  headerFindings: 32,
});

export interface PreviewMetadata {
  url: string;
  title: string;
  description: string;
  siteName: string;
  ogTitle: string;
  ogDescription: string;
  ogUrl: string;
  ogImage: string;
}

export const PREVIEW_FIELD_LIMITS: Readonly<Record<keyof PreviewMetadata, number>> = Object.freeze({
  url: TOOL_LIMITS.url,
  title: TOOL_LIMITS.title,
  description: TOOL_LIMITS.description,
  siteName: TOOL_LIMITS.siteName,
  ogTitle: TOOL_LIMITS.title,
  ogDescription: TOOL_LIMITS.description,
  ogUrl: TOOL_LIMITS.url,
  ogImage: TOOL_LIMITS.url,
});

export function normalizePreviewMetadata(input: Partial<PreviewMetadata> = {}): PreviewMetadata {
  return Object.fromEntries(Object.entries(PREVIEW_FIELD_LIMITS).map(([key, limit]) => [
    key, typeof input[key] === 'string'
      ? (['url', 'ogUrl', 'ogImage'].includes(key) && input[key].length > limit ? '' : input[key].slice(0, limit).trim()) : '',
  ])) as unknown as PreviewMetadata;
}

export function previewMetadataFromPage(page?: ResourceAuditPage): PreviewMetadata {
  return normalizePreviewMetadata({
    url: page?.url,
    title: page?.title,
    description: page?.metaDescription,
    siteName: page?.siteName,
    ogImage: page?.openGraphImage,
    ogTitle: page?.toolEvidence?.version === 1 ? page.toolEvidence.ogTitle : undefined,
    ogDescription: page?.toolEvidence?.version === 1 ? page.toolEvidence.ogDescription : undefined,
  });
}

/** Validation only: this never fetches or strips meaningful URL query/path data. */
export function safeHttpUrl(value: string): string | null {
  if (typeof value !== 'string' || value.length > TOOL_LIMITS.url || !/^https?:\/\//i.test(value.trim())
    || /[\u0000-\u001f\u007f\\]/.test(value) || /\s/.test(value.trim())) return null;
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href.length <= TOOL_LIMITS.url ? url.href : null;
  } catch {
    return null;
  }
}

export function buildMetadataPreview(input: Partial<PreviewMetadata>) {
  const metadata = normalizePreviewMetadata(input);
  const url = safeHttpUrl(metadata.url);
  const ogUrl = safeHttpUrl(metadata.ogUrl);
  const ogImage = safeHttpUrl(metadata.ogImage);
  return {
    metadata,
    serp: { url, title: metadata.title, description: metadata.description, siteName: metadata.siteName },
    // No HTML-title, URL, description, or hostname fallbacks masquerading as OG evidence.
    social: { url: ogUrl, title: metadata.ogTitle, description: metadata.ogDescription, siteName: metadata.siteName, imageUrl: ogImage },
    warnings: (['url', 'ogUrl', 'ogImage'] as const)
      .filter(key => typeof input[key] === 'string' && input[key].trim() && !safeHttpUrl(input[key]))
      .map(key => `${key}: enter an absolute HTTP/HTTPS URL without credentials or whitespace.`),
  };
}

export const SCHEMA_TYPES = ['Article', 'Organization', 'FAQPage'] as const;
export type SupportedSchemaType = typeof SCHEMA_TYPES[number];
type JsonObject = Record<string, unknown>;
export type StructuredDataResult =
  | { ok: true; type: SupportedSchemaType; json: string; embed: string }
  | { ok: false; error: string };

export function structuredDataTemplate(type: SupportedSchemaType): string {
  if (!SCHEMA_TYPES.includes(type)) throw new Error('Unsupported structured-data type.');
  const fields = type === 'Article' ? { headline: '' }
    : type === 'Organization' ? { name: '' }
      : { mainEntity: [{ '@type': 'Question', name: '', acceptedAnswer: { '@type': 'Answer', text: '' } }] };
  return JSON.stringify({ '@context': 'https://schema.org', '@type': type, ...fields }, null, 2);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function fail(message: string): never {
  throw new Error(message);
}

function object(value: unknown, path: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== 'object') fail(`${path} must be an object.`);
  return value as JsonObject;
}

function fields(value: JsonObject, allowed: readonly string[], path: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${path}: unsupported field ${key.slice(0, 64)}.`);
  }
}

function text(value: unknown, path: string) {
  if (typeof value !== 'string' || !value.trim()) fail(`${path} must be non-empty text containing real facts.`);
}

function url(value: unknown, path: string) {
  if (typeof value !== 'string' || !safeHttpUrl(value)) fail(`${path} must be an absolute HTTP/HTTPS URL without credentials.`);
}

function optionalFields(value: JsonObject, textKeys: readonly string[], urlKeys: readonly string[], path: string) {
  for (const key of textKeys) if (Object.hasOwn(value, key)) text(value[key], `${path}.${key}`);
  for (const key of urlKeys) if (Object.hasOwn(value, key)) url(value[key], `${path}.${key}`);
}

function urlList(value: unknown, path: string) {
  const values = Array.isArray(value) ? value : [value];
  if (!values.length || values.length > 20) fail(`${path} must contain 1-20 URLs.`);
  values.forEach((item, index) => url(item, `${path}[${index}]`));
}

function date(value: unknown, path: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.test(value)) {
    fail(`${path} must be a real ISO date or timestamp with a timezone.`);
  }
  const parsed = new Date(value.slice(0, 10));
  if (!Number.isFinite(Date.parse(value)) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    fail(`${path} is not a valid calendar date.`);
  }
}

function organization(value: unknown, path: string) {
  const item = object(value, path);
  fields(item, ['@type', '@id', 'name', 'url', 'description', 'logo', 'sameAs'], path);
  if (item['@type'] !== 'Organization') fail(`${path}.@type must be Organization.`);
  text(item.name, `${path}.name`);
  optionalFields(item, ['description'], ['@id', 'url', 'logo'], path);
  if (Object.hasOwn(item, 'sameAs')) {
    if (!Array.isArray(item.sameAs)) fail(`${path}.sameAs must be an array.`);
    urlList(item.sameAs, `${path}.sameAs`);
  }
}

function author(value: unknown, path: string) {
  const item = object(value, path);
  if (item['@type'] === 'Organization') return organization(item, path);
  fields(item, ['@type', '@id', 'name', 'url'], path);
  if (item['@type'] !== 'Person') fail(`${path}.@type must be Person or Organization.`);
  text(item.name, `${path}.name`);
  optionalFields(item, [], ['@id', 'url'], path);
}

// Iterative traversal bounds work before schema-specific validation or serialization.
function assertJsonBounds(root: unknown) {
  const pending = [{ value: root, depth: 1 }];
  let nodes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++nodes > TOOL_LIMITS.jsonNodes) fail(`JSON exceeds ${TOOL_LIMITS.jsonNodes} values.`);
    if (depth > TOOL_LIMITS.jsonDepth) fail(`JSON exceeds depth ${TOOL_LIMITS.jsonDepth}.`);
    if (typeof value === 'string' && value.length > TOOL_LIMITS.jsonString) fail(`JSON text exceeds ${TOOL_LIMITS.jsonString} characters.`);
    if (Array.isArray(value)) {
      if (value.length > TOOL_LIMITS.jsonArray) fail(`JSON arrays exceed ${TOOL_LIMITS.jsonArray} items.`);
      for (const item of value) pending.push({ value: item, depth: depth + 1 });
    } else if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length > 32) fail('JSON objects exceed 32 fields.');
      for (const [key, item] of entries) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('Unsafe JSON property name.');
        pending.push({ value: item, depth: depth + 1 });
      }
    } else if (typeof value === 'number' && !Number.isFinite(value)) fail('JSON numbers must be finite.');
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])]));
  }
  return value;
}

/** JSON only. No HTML parser, eval, remote context loading, or inferred business facts. */
export function buildStructuredData(input: string): StructuredDataResult {
  try {
    if (typeof input !== 'string') fail('Enter JSON text only.');
    if (input.length > TOOL_LIMITS.jsonBytes || byteLength(input) > TOOL_LIMITS.jsonBytes) fail(`JSON exceeds ${TOOL_LIMITS.jsonBytes} bytes.`);
    let parsed: unknown;
    try { parsed = JSON.parse(input); } catch { fail('Invalid JSON. Paste a JSON object, not JavaScript or a script tag.'); }
    assertJsonBounds(parsed);
    const schema = object(parsed, 'Schema');
    if (schema['@context'] !== 'https://schema.org' && schema['@context'] !== 'http://schema.org') fail('@context must be https://schema.org or http://schema.org.');
    const type = schema['@type'] as SupportedSchemaType;
    if (!SCHEMA_TYPES.includes(type)) fail('Supported types: Article, Organization, FAQPage.');
    const common = ['@context', '@type', '@id', 'url', 'description'];
    optionalFields(schema, ['description'], ['@id', 'url'], 'Schema');
    if (type === 'Article') {
      fields(schema, [...common, 'headline', 'author', 'publisher', 'image', 'datePublished', 'dateModified', 'mainEntityOfPage'], 'Article');
      text(schema.headline, 'Article.headline');
      if (Object.hasOwn(schema, 'author')) {
        const authors = Array.isArray(schema.author) ? schema.author : [schema.author];
        if (!authors.length || authors.length > 20) fail('Article.author must contain 1-20 authors.');
        authors.forEach((item, index) => author(item, `Article.author[${index}]`));
      }
      if (Object.hasOwn(schema, 'publisher')) organization(schema.publisher, 'Article.publisher');
      if (Object.hasOwn(schema, 'image')) urlList(schema.image, 'Article.image');
      if (Object.hasOwn(schema, 'mainEntityOfPage')) url(schema.mainEntityOfPage, 'Article.mainEntityOfPage');
      for (const key of ['datePublished', 'dateModified']) if (Object.hasOwn(schema, key)) date(schema[key], `Article.${key}`);
    } else if (type === 'Organization') {
      fields(schema, [...common, 'name', 'logo', 'sameAs'], 'Organization');
      const { '@context': context, ...item } = schema;
      organization(item, 'Organization');
    } else {
      fields(schema, [...common, 'name', 'mainEntity'], 'FAQPage');
      optionalFields(schema, ['name'], [], 'FAQPage');
      if (!Array.isArray(schema.mainEntity) || !schema.mainEntity.length || schema.mainEntity.length > TOOL_LIMITS.faqItems) {
        fail(`FAQPage.mainEntity must contain 1-${TOOL_LIMITS.faqItems} questions.`);
      }
      schema.mainEntity.forEach((value, index) => {
        const path = `FAQPage.mainEntity[${index}]`;
        const question = object(value, path);
        fields(question, ['@type', 'name', 'acceptedAnswer'], path);
        if (question['@type'] !== 'Question') fail(`${path}.@type must be Question.`);
        text(question.name, `${path}.name`);
        const answer = object(question.acceptedAnswer, `${path}.acceptedAnswer`);
        fields(answer, ['@type', 'text'], `${path}.acceptedAnswer`);
        if (answer['@type'] !== 'Answer') fail(`${path}.acceptedAnswer.@type must be Answer.`);
        text(answer.text, `${path}.acceptedAnswer.text`);
      });
    }
    const json = JSON.stringify(sortJson(schema), null, 2)
      .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const embed = `<script type="application/ld+json">\n${json}\n</script>`;
    if (byteLength(embed) > TOOL_LIMITS.outputBytes) fail(`Output exceeds ${TOOL_LIMITS.outputBytes} bytes.`);
    return { ok: true, type, json, embed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid structured data.' };
  }
}

export const HEADER_TARGETS = ['Nginx', 'Apache', 'Vercel', 'Caddy'] as const;
export type HeaderTarget = typeof HEADER_TARGETS[number];
export const OBSERVED_HEADER_NAMES = [
  'Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy',
  'Content-Security-Policy', 'Content-Security-Policy-Report-Only',
] as const;
export type ObservedHeaderName = typeof OBSERVED_HEADER_NAMES[number];
export interface ObservedHeaderFinding {
  header: ObservedHeaderName;
  state: 'absent' | 'present' | 'unknown';
}

export function headerFindingsFromPage(page?: ResourceAuditPage): ObservedHeaderFinding[] {
  const headers = page?.toolEvidence?.version === 1 ? page.toolEvidence.securityHeaders : undefined;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return [];
  const entries = Object.entries(headers);
  if (entries.length > TOOL_LIMITS.headerFindings) fail(`Use at most ${TOOL_LIMITS.headerFindings} header observations.`);
  return OBSERVED_HEADER_NAMES.flatMap(header => entries
    .filter(([key]) => key.toLowerCase() === header.toLowerCase())
    .map(([, value]) => ({ header, state: value === false ? 'absent' as const : value === true ? 'present' as const : 'unknown' as const })));
}

export const HEADER_DOCUMENTATION: Readonly<Record<HeaderTarget, string>> = Object.freeze({
  Nginx: 'https://nginx.org/en/docs/http/ngx_http_headers_module.html',
  Apache: 'https://httpd.apache.org/docs/2.4/en/mod/mod_headers.html',
  Vercel: 'https://vercel.com/docs/project-configuration/vercel-json#headers',
  Caddy: 'https://caddyserver.com/docs/caddyfile/directives/header',
});

export interface HeaderRemediation {
  snippet: string;
  headers: Array<{ key: ObservedHeaderName; value: string }>;
  warnings: string[];
}

export function buildHeaderRemediation(
  target: HeaderTarget,
  findings: readonly ObservedHeaderFinding[],
  options: { httpsConfirmed?: boolean } = {},
): HeaderRemediation {
  if (!HEADER_TARGETS.includes(target)) fail('Unsupported deployment target.');
  if (!Array.isArray(findings) || findings.length > TOOL_LIMITS.headerFindings) fail(`Use at most ${TOOL_LIMITS.headerFindings} header observations.`);
  const states = new Map<ObservedHeaderName, Set<ObservedHeaderFinding['state']>>();
  for (const finding of findings) {
    if (!finding || !OBSERVED_HEADER_NAMES.includes(finding.header) || !['absent', 'present', 'unknown'].includes(finding.state)) fail('Invalid header observation.');
    const existing = states.get(finding.header) ?? new Set();
    existing.add(finding.state);
    states.set(finding.header, existing);
  }
  const absent = (name: ObservedHeaderName) => states.get(name)?.size === 1 && states.get(name)?.has('absent');
  const headers: HeaderRemediation['headers'] = [];
  const warnings: string[] = [];
  for (const [name, observations] of states) {
    if (observations.size > 1) warnings.push(`${name}: conflicting observations; no change generated for this header.`);
  }
  if (absent('Strict-Transport-Security')) {
    if (options.httpsConfirmed === true) {
      headers.push({ key: 'Strict-Transport-Security', value: 'max-age=300' });
      warnings.push('HSTS starts at five minutes. Apply only to HTTPS responses after checking certificates and HTTPS availability. No subdomain or preload commitment.');
    } else warnings.push('HSTS withheld: confirm working HTTPS before generating this directive.');
  }
  if (absent('X-Content-Type-Options')) {
    headers.push({ key: 'X-Content-Type-Options', value: 'nosniff' });
    warnings.push('Verify correct Content-Type for scripts and styles before enabling nosniff.');
  }
  if (absent('Referrer-Policy')) headers.push({ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' });
  if (absent('Content-Security-Policy')) {
    if (absent('Content-Security-Policy-Report-Only')) {
      headers.push({ key: 'Content-Security-Policy-Report-Only', value: "default-src 'self'; object-src 'none'; base-uri 'self'" });
      warnings.push('CSP is report-only, not enforcement. Inventory real script, style, image, font, frame and connection sources in staging; configure a reporting endpoint separately. Keep any existing enforced CSP.');
    } else warnings.push('CSP withheld: confirm the report-only header is also absent; never overwrite an existing policy.');
  }
  if (!headers.length) return { snippet: '', headers, warnings };
  warnings.push('These are observed-response suggestions, not site-wide findings or ranking guarantees. Recheck relevant paths, status codes and proxy layers in staging; merge once into existing configuration.');
  let snippet: string;
  if (target === 'Vercel') {
    snippet = JSON.stringify({ headers: [{ source: '/(.*)', headers }] }, null, 2);
    warnings.push('Merge the headers rule into vercel.json without replacing existing routes or rules. Scope the rule to verified paths; verify upstream and framework header precedence.');
  } else if (target === 'Nginx') {
    snippet = '# Merge into the existing HTTPS server block. Preserve all inherited add_header directives.\n'
      + headers.map(({ key, value }) => `add_header ${key} "${value}" always;`).join('\n');
    warnings.push('Nginx add_header can change inheritance. Preserve inherited security headers, especially CSP, and check for duplicate upstream headers; do not paste into a new location block.');
  } else if (target === 'Apache') {
    snippet = '# Requires mod_headers; merge into the existing HTTPS virtual host.\n'
      + headers.map(({ key, value }) => `Header always setifempty ${key} "${value}"`).join('\n');
    warnings.push('Apache uses separate response-header tables. Check both onsuccess and always, plus upstream headers, for duplicates; setifempty alone does not resolve cross-table conflicts.');
  } else {
    snippet = '# Merge inside the existing HTTPS site block; ? preserves existing values.\n'
      + headers.map(({ key, value }) => `header ?${key} "${value}"`).join('\n');
  }
  return { snippet, headers, warnings };
}
