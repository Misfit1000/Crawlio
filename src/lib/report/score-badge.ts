import type { ResourceAuditDocument } from '../audit/resource-types';
import { isCompletedAuditStatus } from '../audit/audit-time';
import { scoreToGrade } from '../audit/report-insights';
import { AUDIT_GROUP_DETAILS, auditScopeScoreLabel, normalizeAuditScope } from '../audit/audit-scope';

export type ScoreBadgeAudit = Pick<ResourceAuditDocument, 'id' | 'userId' | 'projectId' | 'status' | 'completedAt' | 'deletedAt' | 'scope'>;

function escapeText(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]!);
}

/** Uses the persisted final score, never a provisional score or sampled page calculation. */
export function renderScoreBadge(audit: ScoreBadgeAudit, scores: Record<string, unknown> | null): string | null {
  if (!isCompletedAuditStatus(audit.status) || audit.deletedAt || !scores) return null;
  const score = scores.overall;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) return null;
  const completedAt = audit.completedAt && Date.parse(audit.completedAt);
  if (typeof completedAt !== 'number' || !Number.isFinite(completedAt)) return null;

  const date = new Date(completedAt).toISOString().slice(0, 10);
  // Do not copy arbitrary stored text, URLs, limitations or version markup into public output.
  const version = typeof scores.scoringVersion === 'string' && /^\d{1,3}(?:\.\d{1,3}){0,2}$/.test(scores.scoringVersion)
    ? scores.scoringVersion : 'unknown';
  const coverage = scores.coverage && typeof scores.coverage === 'object' && !Array.isArray(scores.coverage)
    ? scores.coverage as Record<string, unknown> : null;
  const count = coverage?.pagesAnalysed;
  const coverageLabel = typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 && count <= 1_000_000
    ? `Limited coverage: ${count} page${count === 1 ? '' : 's'} analysed` : 'Limited coverage';
  const scoreLabel = `${score}/100 (${scoreToGrade(score)})`;
  const dateLabel = `${date} | Score version ${version}`;
  let scope;
  try { scope = normalizeAuditScope(audit.scope || scores.scope); } catch { return null; }
  if (scope) {
    const label = auditScopeScoreLabel(scope);
    const coverageText = `${scope.coverage === 'page' ? 'Single-page' : 'Site crawl'} scope | ${coverageLabel}`;
    const description = `${label}: ${scoreLabel}. ${dateLabel}. ${coverageText}. Selected checks: ${scope.checkGroups.map(group => AUDIT_GROUP_DETAILS[group].label).join(', ')}. Not a ranking or verification.`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="140" viewBox="0 0 440 140" role="img" aria-labelledby="badge-title badge-description">
<title id="badge-title">Crawlio ${escapeText(label)}: ${escapeText(scoreLabel)}</title>
<desc id="badge-description">${escapeText(description)}</desc>
<rect x="0.5" y="0.5" width="439" height="139" rx="6" fill="#181818" stroke="#525252"/>
<g font-family="Arial, sans-serif" fill="#fafafa">
<text x="14" y="25" font-size="14">Crawlio | ${escapeText(label)}</text>
<text x="14" y="51" font-size="16" font-weight="bold">${escapeText(scoreLabel)}</text>
<text x="14" y="75" font-size="12">${escapeText(dateLabel)}</text>
<text x="14" y="99" font-size="11">${escapeText(coverageText)}</text>
<text x="14" y="123" font-size="12" fill="#d4d4d4">Not a ranking or verification</text>
</g>
</svg>`;
  }
  const description = `Crawlio audit result: ${scoreLabel}. ${dateLabel}. ${coverageLabel}. Not a ranking or verification.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="116" viewBox="0 0 400 116" role="img" aria-labelledby="badge-title badge-description">
<title id="badge-title">Crawlio Audit result: ${escapeText(scoreLabel)}</title>
<desc id="badge-description">${escapeText(description)}</desc>
<rect x="0.5" y="0.5" width="399" height="115" rx="6" fill="#181818" stroke="#525252"/>
<g font-family="Arial, sans-serif" fill="#fafafa">
<text x="14" y="25" font-size="14">Crawlio | Audit result</text>
<text x="386" y="25" text-anchor="end" font-size="16" font-weight="bold">${escapeText(scoreLabel)}</text>
<text x="14" y="51" font-size="12">${escapeText(dateLabel)}</text>
<text x="14" y="75" font-size="12">${escapeText(coverageLabel)}</text>
<text x="14" y="99" font-size="12" fill="#d4d4d4">Not a ranking or verification</text>
</g>
</svg>`;
}
