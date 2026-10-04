import type { AuditScoreCategory } from './audit-scoring';

export const AUDIT_CHECK_GROUPS = ['seo', 'technical', 'crawlability', 'links', 'performance', 'structured-data', 'accessibility', 'security'] as const;
export type AuditCheckGroup = typeof AUDIT_CHECK_GROUPS[number];
export type AuditFocus = 'full' | AuditCheckGroup | 'custom';
export interface AuditScope {
  version: 1;
  focus: AuditFocus;
  checkGroups: AuditCheckGroup[];
  coverage: 'page' | 'site';
}

export const AUDIT_GROUP_DETAILS: Record<AuditCheckGroup, { label: string; description: string; modules: string[]; category: AuditScoreCategory }> = {
  seo: { label: 'On-page SEO', description: 'Titles, headings, content, images and local/international HTML signals.', modules: ['images', 'on-page', 'content', 'international', 'local'], category: 'onPage' },
  technical: { label: 'Technical SEO', description: 'HTTP delivery, redirects and static mobile-HTML signals.', modules: ['technical', 'mobile'], category: 'technical' },
  crawlability: { label: 'Crawlability', description: 'Robots access, indexing directives, canonical URLs and sitemaps.', modules: ['indexability', 'robots', 'sitemap'], category: 'crawlability' },
  links: { label: 'Internal links', description: 'Links and anchor text visible in the retrieved HTML.', modules: ['links'], category: 'internalLinks' },
  performance: { label: 'Performance', description: 'Observed HTML request duration and downloaded HTML size, not Core Web Vitals.', modules: ['performance'], category: 'performance' },
  'structured-data': { label: 'Structured data', description: 'Structured markup and social metadata found in the HTML.', modules: ['schema', 'social'], category: 'structuredData' },
  accessibility: { label: 'Accessibility', description: 'Automated HTML accessibility signals, not certification.', modules: ['accessibility'], category: 'accessibility' },
  security: { label: 'Passive security', description: 'HTTPS, browser-protection headers and insecure HTML references. No attack testing.', modules: ['security'], category: 'security' },
};

export function makeAuditScope(focus: AuditFocus = 'full', coverage: AuditScope['coverage'] = focus === 'full' ? 'site' : 'page', groups: readonly AuditCheckGroup[] = AUDIT_CHECK_GROUPS): AuditScope {
  return { version: 1, focus, coverage, checkGroups: focus === 'full' ? [...AUDIT_CHECK_GROUPS] : focus === 'custom' ? AUDIT_CHECK_GROUPS.filter(group => groups.includes(group)) : [focus] };
}

export function normalizeAuditScope(value: unknown, legacyType?: unknown): AuditScope | undefined {
  if (value == null) return legacyType === 'security' ? makeAuditScope('security') : undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a valid audit focus and coverage.');
  const input = value as Record<string, unknown>;
  if (input.version !== 1 || !['full', 'custom', ...AUDIT_CHECK_GROUPS].includes(String(input.focus)) || !['page', 'site'].includes(String(input.coverage))) throw new Error('Choose a valid audit focus and coverage.');
  if (!Array.isArray(input.checkGroups) || !input.checkGroups.length || input.checkGroups.length > AUDIT_CHECK_GROUPS.length || input.checkGroups.some(group => !AUDIT_CHECK_GROUPS.includes(group))) throw new Error('Select at least one supported check group.');
  const scope = makeAuditScope(input.focus as AuditFocus, input.coverage as AuditScope['coverage'], input.checkGroups as AuditCheckGroup[]);
  const supplied = [...new Set(input.checkGroups)];
  if (supplied.length !== scope.checkGroups.length || supplied.some(group => !scope.checkGroups.includes(group as AuditCheckGroup))) throw new Error('The selected checks do not match the audit focus.');
  if (legacyType === 'security' && (scope.focus !== 'security' || scope.checkGroups.length !== 1)) throw new Error('The requested audit types conflict.');
  return scope;
}

export function auditScopeFingerprint(scope?: AuditScope | null) {
  const normalized = scope || makeAuditScope();
  return `v1:${normalized.coverage}:${normalized.focus === 'full' ? 'full' : 'selected'}:${AUDIT_CHECK_GROUPS.filter(group => normalized.checkGroups.includes(group)).join(',')}`;
}

export function scopeForAudit(audit: { scope?: AuditScope | null } | null | undefined) { return audit?.scope || makeAuditScope(); }
export function isFocusedAudit(audit: { scope?: AuditScope | null } | null | undefined) { return !!audit?.scope && audit.scope.focus !== 'full'; }
export function auditFocusLabel(scope?: AuditScope | null) { return !scope || scope.focus === 'full' ? 'Full audit' : scope.focus === 'custom' ? 'Custom audit' : `${AUDIT_GROUP_DETAILS[scope.focus].label} audit`; }
export function auditScopeScoreLabel(scope?: AuditScope | null) { return !scope || scope.focus === 'full' ? 'Website health score' : scope.focus === 'custom' ? 'Selected checks score' : `${AUDIT_GROUP_DETAILS[scope.focus].label} score`; }
export function scopeIncludesGroup(scope: AuditScope | null | undefined, group: AuditCheckGroup) { return !scope || scope.checkGroups.includes(group); }
export function scopeIncludesSection(scope: AuditScope | null | undefined, section: string) {
  if (['overview', 'pages', 'activity'].includes(section)) return true;
  return scopeIncludesGroup(scope, section as AuditCheckGroup);
}
export function scopeScoreCategories(scope?: AuditScope | null): AuditScoreCategory[] {
  return (scope?.checkGroups || AUDIT_CHECK_GROUPS).map(group => AUDIT_GROUP_DETAILS[group].category);
}

export function auditScopesComparable(a: { scope?: AuditScope | null; effectiveMode?: string; mode?: string }, b: { scope?: AuditScope | null; effectiveMode?: string; mode?: string }) {
  return auditScopeFingerprint(a.scope) === auditScopeFingerprint(b.scope) && (a.effectiveMode || a.mode) === (b.effectiveMode || b.mode);
}
