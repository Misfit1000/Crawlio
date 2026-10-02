// RFC 9309 requires a parsing limit of at least 500 KiB (512,000 bytes).
export const ROBOTS_MAX_BYTES = 512_000;
export const ROBOTS_MAX_RAW_BYTES = 128_000;
export const ROBOTS_MAX_WARNINGS = 100;
export const DEFAULT_ROBOTS_USER_AGENT = 'CrawlioBot';

export interface LegacyRobotsRules {
  allow: string[];
  disallow: string[];
  sitemaps?: string[];
}

export interface RobotsWarning {
  code: 'input-truncated' | 'warnings-truncated' | 'malformed-line' | 'invalid-user-agent'
    | 'invalid-rule' | 'orphan-rule' | 'invalid-sitemap' | 'unsupported-directive'
    | 'legacy-rules' | 'invalid-path';
  line: number | null;
  message: string;
}

export interface RobotsRule {
  directive: 'allow' | 'disallow';
  path: string;
  normalizedPattern: string;
  specificity: number;
  /** One-based source line; null for persisted legacy arrays. */
  line: number | null;
}

export interface RobotsGroup {
  index: number;
  line: number;
  userAgents: { value: string; line: number }[];
  rules: RobotsRule[];
}

export interface RobotsDocument extends LegacyRobotsRules {
  version: 1;
  sitemaps: string[];
  groups: RobotsGroup[];
  warnings: string[];
  diagnostics: RobotsWarning[];
  /** Retained UTF-8 bytes, never more than ROBOTS_MAX_BYTES. */
  byteLength: number;
  truncated: boolean;
  hasContent: boolean;
  hasValidRecords: boolean;
}

export interface RobotsSelectedGroup {
  kind: 'specific' | 'wildcard' | 'legacy';
  specificity: number;
  groupIndexes: number[];
  userAgents: string[];
  lines: number[];
}

export interface RobotsRuleEvidence extends RobotsRule {
  groupIndex: number | null;
}

export interface RobotsEvaluation {
  allowed: boolean;
  blocked: boolean;
  userAgent: string;
  path: string;
  normalizedPath: string;
  /** Matching product tokens, with equally specific groups combined. */
  groups: string[];
  selectedGroup: RobotsSelectedGroup | null;
  matchedRule?: RobotsRuleEvidence;
  reason: 'allow-rule' | 'disallow-rule' | 'no-matching-rule' | 'no-matching-group'
    | 'implicit-robots-allow' | 'invalid-path' | 'robots-missing' | 'robots-empty' | 'robots-unavailable';
  warnings: string[];
  diagnostics: RobotsWarning[];
}

export type RobotsFetchState = 'missing' | 'empty' | 'available' | 'malformed' | 'unavailable';

export interface RobotsFetchEvidenceInput {
  status?: number;
  body?: string;
  url?: string;
  fetchedAt?: string;
  error?: boolean;
}

export interface RobotsFetchEvidence {
  state: RobotsFetchState;
  raw: string;
  statusCode?: number;
  url?: string;
  fetchedAt: string;
  warnings: string[];
  /** Raw retention may truncate before the separate, larger parser limit. */
  truncated: boolean;
  byteLength: number;
  policy: 'allow-all' | 'use-rules' | 'disallow-all';
  /** Only successful, supplied bodies are parsed; HTTP error pages are not rules. */
  document?: RobotsDocument;
}

interface BoundedText {
  text: string;
  byteLength: number;
  truncated: boolean;
}

function boundText(text: string, maxBytes: number): BoundedText {
  let index = 0;
  let byteLength = 0;
  while (index < text.length) {
    const point = text.codePointAt(index)!;
    const bytes = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (byteLength + bytes > maxBytes) break;
    byteLength += bytes;
    index += point > 0xffff ? 2 : 1;
  }
  return { text: text.slice(0, index), byteLength, truncated: index < text.length };
}

function addWarning(warnings: RobotsWarning[], warning: RobotsWarning) {
  if (warnings.length < ROBOTS_MAX_WARNINGS) warnings.push(warning);
  else warnings[ROBOTS_MAX_WARNINGS - 1] = {
    code: 'warnings-truncated', line: null, message: 'Additional parser warnings were omitted.',
  };
}

function warningMessages(warnings: RobotsWarning[]) {
  return warnings.map((warning) => warning.line == null ? warning.message : `Line ${warning.line}: ${warning.message}`);
}

function trimWhitespace(value: string) {
  let start = 0;
  let end = value.length;
  while (start < end && (value[start] === ' ' || value[start] === '\t')) start += 1;
  while (end > start && (value[end - 1] === ' ' || value[end - 1] === '\t')) end -= 1;
  return value.slice(start, end);
}

function completeLines(text: string) {
  return text.slice(0, Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r')) + 1);
}

function isValidPattern(pattern: string) {
  if (pattern === '') return true;
  // RFC 9309's example also permits a leading wildcard (e.g. *.gif$).
  if (!pattern.startsWith('/') && !pattern.startsWith('*')) return false;
  if (/[\u0000-\u0020\u007f\ufffd]/.test(pattern) || /%(?![\da-f]{2})/i.test(pattern)) return false;
  try { encodeURIComponent(pattern); return true; } catch { return false; }
}

function normalizeOctets(value: string, pattern = false) {
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '%' && /^[\da-f]{2}$/i.test(value.slice(index + 1, index + 3))) {
      const hex = value.slice(index + 1, index + 3).toUpperCase();
      const decoded = String.fromCharCode(Number.parseInt(hex, 16));
      result.push(/[A-Za-z0-9._~-]/.test(decoded) ? decoded : `%${hex}`);
      index += 2;
    } else if ((character === '*' && pattern) || (character === '$' && pattern && index === value.length - 1)) {
      result.push(character);
    } else if ('*#$%'.includes(character)) {
      result.push(`%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    } else {
      const point = value.codePointAt(index)!;
      const literal = String.fromCodePoint(point);
      // Keep URI separators distinct from encoded counterparts (%2F, %3F, etc.).
      result.push(point > 0x7e || point <= 0x20 ? encodeURIComponent(literal) : literal);
      if (point > 0xffff) index += 1;
    }
  }
  return result.join('');
}

function makeRule(directive: RobotsRule['directive'], path: string, line: number | null): RobotsRule {
  const normalizedPattern = normalizeOctets(path, true);
  return { directive, path, normalizedPattern, specificity: normalizedPattern.length, line };
}

function selectGroups(groups: RobotsGroup[], userAgent: string) {
  const agent = userAgent.toLowerCase();
  let specificity = -1;
  let selected: RobotsGroup[] = [];
  for (const group of groups) {
    let groupSpecificity = -1;
    for (const token of group.userAgents) {
      if (token.value === '*') groupSpecificity = Math.max(groupSpecificity, 0);
      else if (agent.includes(token.value.toLowerCase())) groupSpecificity = Math.max(groupSpecificity, token.value.length);
    }
    if (groupSpecificity < 0 || groupSpecificity < specificity) continue;
    if (groupSpecificity > specificity) selected = [];
    selected.push(group);
    specificity = groupSpecificity;
  }
  const selection: RobotsSelectedGroup | null = selected.length ? {
    kind: specificity === 0 ? 'wildcard' : 'specific', specificity,
    groupIndexes: selected.map((group) => group.index),
    userAgents: [...new Set(selected.flatMap((group) => group.userAgents
      .filter((token) => specificity === 0 ? token.value === '*'
        : token.value.length === specificity && agent.includes(token.value.toLowerCase()))
      .map((token) => token.value)))],
    lines: selected.map((group) => group.line),
  } : null;
  return { groups: selected, selection };
}

function parseBoundedRobots(bounded: BoundedText): RobotsDocument {
  const document: RobotsDocument = {
    version: 1, allow: [], disallow: [], sitemaps: [], groups: [], warnings: [], diagnostics: [],
    byteLength: bounded.byteLength, truncated: bounded.truncated, hasContent: false, hasValidRecords: false,
  };
  let text = bounded.text.replace(/^\uFEFF/, '');
  if (bounded.truncated) {
    addWarning(document.diagnostics, {
      code: 'input-truncated', line: null,
      message: `Only the first ${ROBOTS_MAX_BYTES} UTF-8 bytes are parsed; an incomplete final line is ignored.`,
    });
    // Never turn a partially retained rule into a broader matching prefix.
    text = completeLines(text);
  }
  let group: RobotsGroup | undefined;
  let seenRule = false;
  const lines = text.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1;
    const clean = trimWhitespace(lines[index].split('#', 1)[0]);
    if (!clean) continue;
    document.hasContent = true;
    const separator = clean.indexOf(':');
    if (separator < 1) {
      addWarning(document.diagnostics, { code: 'malformed-line', line, message: 'Expected a directive followed by a colon.' });
      continue;
    }
    const key = trimWhitespace(clean.slice(0, separator)).toLowerCase();
    const value = trimWhitespace(clean.slice(separator + 1));
    if (key === 'user-agent') {
      if (!/^(?:\*|[A-Za-z_-]+)$/.test(value)) {
        addWarning(document.diagnostics, { code: 'invalid-user-agent', line, message: 'Expected * or a product token containing letters, underscores, or hyphens.' });
        group = undefined;
        seenRule = false;
        continue;
      }
      if (!group || seenRule) {
        group = { index: document.groups.length, line, userAgents: [], rules: [] };
        document.groups.push(group);
      }
      group.userAgents.push({ value, line });
      seenRule = false;
      document.hasValidRecords = true;
    } else if (key === 'allow' || key === 'disallow') {
      seenRule = true;
      if (!group) {
        addWarning(document.diagnostics, { code: 'orphan-rule', line, message: 'Rules before a valid user-agent group are ignored.' });
      } else if (!isValidPattern(value)) {
        addWarning(document.diagnostics, { code: 'invalid-rule', line, message: 'Ignored an invalid path pattern or encoding.' });
      } else {
        group.rules.push(makeRule(key, value, line));
      }
    } else if (key === 'sitemap') {
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /\s/.test(value)) throw new Error();
        document.sitemaps.push(value);
        document.hasValidRecords = true;
      } catch {
        addWarning(document.diagnostics, { code: 'invalid-sitemap', line, message: 'Expected an absolute HTTP(S) sitemap URL without credentials.' });
      }
    } else {
      addWarning(document.diagnostics, { code: 'unsupported-directive', line, message: 'This directive does not affect robots access rules.' });
    }
  }
  const selected = selectGroups(document.groups, DEFAULT_ROBOTS_USER_AGENT);
  for (const selectedGroup of selected.groups) {
    for (const rule of selectedGroup.rules) document[rule.directive].push(rule.path);
  }
  document.warnings = warningMessages(document.diagnostics);
  return document;
}

/** Browser-safe, JSON-serializable document, with default-crawler legacy arrays. */
export function parseRobotsTxt(text: string): RobotsDocument {
  return parseBoundedRobots(boundText(text, ROBOTS_MAX_BYTES));
}

export function getSitemapUrlsFromRobots(text: string): string[] {
  return parseRobotsTxt(text).sitemaps;
}

function findLiteral(path: string, literal: string, offset: number) {
  if (!literal) return offset;
  const prefix = new Uint32Array(literal.length);
  for (let index = 1, matched = 0; index < literal.length; index += 1) {
    while (matched > 0 && literal[index] !== literal[matched]) matched = prefix[matched - 1];
    if (literal[index] === literal[matched]) matched += 1;
    prefix[index] = matched;
  }
  // KMP bounds even repetitive literal searches to linear time.
  for (let index = offset, matched = 0; index < path.length; index += 1) {
    while (matched > 0 && path[index] !== literal[matched]) matched = prefix[matched - 1];
    if (path[index] === literal[matched]) matched += 1;
    if (matched === literal.length) return index - literal.length + 1;
  }
  return -1;
}

function matchesPattern(path: string, pattern: string) {
  if (!pattern) return false;
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const segments = body.split('*');
  if (!path.startsWith(segments[0])) return false;
  let offset = segments[0].length;
  // Literal searches avoid exponential regex backtracking on untrusted wildcards.
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (anchored && index === segments.length - 1) {
      return path.endsWith(segment) && path.length - segment.length >= offset;
    }
    const position = findLiteral(path, segment, offset);
    if (position < 0) return false;
    offset = position + segment.length;
  }
  return !anchored || offset === path.length;
}

function requestPath(value: string) {
  if (value.startsWith('/')) return value.split('#', 1)[0];
  const url = new URL(value);
  return `${url.pathname || '/'}${url.search}`;
}

/** Evaluates a path plus query (or absolute URL), ignoring fragments. */
export function evaluateRobots(
  input: string | RobotsDocument | LegacyRobotsRules | RobotsFetchEvidence,
  path: string,
  userAgent = DEFAULT_ROBOTS_USER_AGENT,
): RobotsEvaluation {
  if (isRobotsFetchEvidence(input)) {
    const evaluation = evaluateRobots(input.document ?? (input.policy === 'use-rules' ? input.raw : ''), path, userAgent);
    evaluation.warnings = [...new Set([...input.warnings, ...evaluation.warnings])].slice(0, ROBOTS_MAX_WARNINGS);
    if (input.policy !== 'use-rules') {
      evaluation.allowed = input.policy === 'allow-all';
      evaluation.blocked = !evaluation.allowed;
      evaluation.groups = [];
      evaluation.selectedGroup = null;
      delete evaluation.matchedRule;
      evaluation.reason = input.state === 'missing' ? 'robots-missing'
        : input.state === 'empty' ? 'robots-empty' : 'robots-unavailable';
    }
    return evaluation;
  }
  const document = typeof input === 'string' ? parseRobotsTxt(input) : input;
  const parsedDocument = isRobotsDocument(document) ? document : null;
  const diagnostics: RobotsWarning[] = parsedDocument ? [...parsedDocument.diagnostics] : [{
    code: 'legacy-rules', line: null,
    message: 'Persisted rule arrays have no user-agent groups or source line evidence.',
  }];
  const selected = parsedDocument ? selectGroups(parsedDocument.groups, userAgent) : null;
  const evaluation: RobotsEvaluation = {
    allowed: true, blocked: false, userAgent, path, normalizedPath: '',
    groups: selected?.selection?.userAgents ?? [],
    selectedGroup: selected ? selected.selection : {
      kind: 'legacy', specificity: 0, groupIndexes: [], userAgents: [], lines: [],
    },
    reason: 'no-matching-group', warnings: warningMessages(diagnostics), diagnostics,
  };
  try {
    const extracted = requestPath(path);
    if (!extracted.startsWith('/') || /[\u0000-\u001f\u007f\ufffd]/.test(extracted)) throw new Error();
    evaluation.path = extracted;
    evaluation.normalizedPath = normalizeOctets(extracted);
  } catch {
    evaluation.reason = 'invalid-path';
    addWarning(diagnostics, { code: 'invalid-path', line: null, message: 'Expected an absolute URL or root-relative path with valid Unicode.' });
    evaluation.warnings = warningMessages(diagnostics);
    return evaluation;
  }
  if (evaluation.normalizedPath.split('?', 1)[0] === '/robots.txt') {
    evaluation.reason = 'implicit-robots-allow';
    return evaluation;
  }
  if (!evaluation.selectedGroup) return evaluation;
  evaluation.reason = 'no-matching-rule';
  const consider = (rule: RobotsRule, groupIndex: number | null) => {
    if (!matchesPattern(evaluation.normalizedPath, rule.normalizedPattern)) return;
    const previous = evaluation.matchedRule;
    if (!previous || rule.specificity > previous.specificity
      || (rule.specificity === previous.specificity && rule.directive === 'allow' && previous.directive === 'disallow')) {
      evaluation.matchedRule = { ...rule, groupIndex };
    }
  };
  if (selected) {
    for (const group of selected.groups) for (const rule of group.rules) consider(rule, group.index);
  } else {
    for (const directive of ['allow', 'disallow'] as const) {
      for (const pattern of document[directive]) {
        if (isValidPattern(pattern)) consider(makeRule(directive, pattern, null), null);
      }
    }
  }
  if (evaluation.matchedRule) {
    evaluation.blocked = evaluation.matchedRule.directive === 'disallow';
    evaluation.allowed = !evaluation.blocked;
    evaluation.reason = evaluation.blocked ? 'disallow-rule' : 'allow-rule';
  }
  return evaluation;
}

function isRobotsDocument(input: LegacyRobotsRules): input is RobotsDocument {
  const document = input as Partial<RobotsDocument>;
  return document.version === 1 && Array.isArray(document.groups) && Array.isArray(document.diagnostics);
}

function isRobotsFetchEvidence(input: unknown): input is RobotsFetchEvidence {
  if (!input || typeof input !== 'object') return false;
  const evidence = input as Partial<RobotsFetchEvidence>;
  return ['missing', 'empty', 'available', 'malformed', 'unavailable'].includes(evidence.state ?? '')
    && typeof evidence.raw === 'string' && Array.isArray(evidence.warnings)
    && ['allow-all', 'use-rules', 'disallow-all'].includes(evidence.policy ?? '');
}

/** Accepts both new documents and persisted legacy { allow, disallow } objects. */
export function isBlockedByRobots(url: string, rules: unknown): boolean {
  if (!rules || typeof rules !== 'object') return false;
  if (isRobotsFetchEvidence(rules)) {
    try { new URL(url); return evaluateRobots(rules, url).blocked; } catch { return false; }
  }
  const candidate = rules as Partial<RobotsDocument>;
  if (!Array.isArray(candidate.allow) || !Array.isArray(candidate.disallow)) return false;
  try {
    new URL(url);
    const input: RobotsDocument | LegacyRobotsRules = candidate.version === 1
      && Array.isArray(candidate.groups) && Array.isArray(candidate.diagnostics) ? candidate as RobotsDocument : {
        allow: candidate.allow.filter((rule) => typeof rule === 'string'),
        disallow: candidate.disallow.filter((rule) => typeof rule === 'string'),
      };
    return evaluateRobots(input, url).blocked;
  } catch { return false; }
}

/** No I/O: build evidence from a response already fetched during audit initialization. */
export function createRobotsFetchEvidence(input: RobotsFetchEvidenceInput): RobotsFetchEvidence {
  const bounded = boundText(input.body ?? '', ROBOTS_MAX_RAW_BYTES);
  const retained = bounded.truncated ? boundText(completeLines(bounded.text), ROBOTS_MAX_RAW_BYTES) : bounded;
  const statusCode = Number.isInteger(input.status) && input.status! >= 100 && input.status! <= 599 ? input.status : undefined;
  const evidence: RobotsFetchEvidence = {
    state: 'unavailable', raw: retained.text, fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    warnings: [], truncated: bounded.truncated, byteLength: retained.byteLength, policy: 'disallow-all',
    ...(statusCode == null ? {} : { statusCode }), ...(input.url == null ? {} : { url: input.url }),
  };
  if (bounded.truncated) evidence.warnings.push(`Retained raw robots text is limited to ${ROBOTS_MAX_RAW_BYTES} UTF-8 bytes and complete lines; use the parsed document for the complete bounded rules.`);
  if (input.error) evidence.warnings.push('Robots retrieval failed; access is conservatively disallowed until a successful retrieval.');
  else if (statusCode === 404 || statusCode === 410) {
    evidence.state = 'missing';
    evidence.policy = 'allow-all';
  } else if (statusCode != null && statusCode >= 200 && statusCode < 300 && typeof input.body === 'string') {
    evidence.document = parseRobotsTxt(input.body);
    evidence.warnings = [...evidence.warnings, ...evidence.document.warnings].slice(0, ROBOTS_MAX_WARNINGS);
    evidence.state = !evidence.document.hasContent && !evidence.document.truncated ? 'empty'
      : evidence.document.hasValidRecords ? 'available' : 'malformed';
    evidence.policy = evidence.state === 'empty' ? 'allow-all' : 'use-rules';
  } else {
    evidence.warnings.push('Robots response was not a successful, supplied document; access is conservatively disallowed.');
  }
  return evidence;
}
