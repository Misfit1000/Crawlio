import type { AuditIssue } from '../../audit/types';
import { CHECK_REGISTRY } from './registry';

export function run(pageData: any): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const url = String(pageData.url || '');
  const data = pageData.accessibility || {};
  const add = (id: string, evidence: string) => {
    const check = CHECK_REGISTRY[id];
    if (!check) return;
    issues.push({
      id: check.id,
      category: check.category,
      severity: check.severity,
      title: check.title,
      description: check.description,
      recommendation: check.recommendation,
      affectedUrl: url,
      evidence,
    });
  };

  if (!String(pageData.lang || '').trim()) add('a11y-document-language', 'The html element has no lang attribute.');
  if (Number(data.unnamedLinks) > 0) add('a11y-unnamed-links', `${data.unnamedLinks} link${data.unnamedLinks === 1 ? '' : 's'} have no accessible name.`);
  if (Number(data.unnamedButtons) > 0) add('a11y-unnamed-buttons', `${data.unnamedButtons} button${data.unnamedButtons === 1 ? '' : 's'} have no accessible name.`);
  if (Number(data.unlabeledFields) > 0) add('a11y-unlabeled-fields', `${data.unlabeledFields} form field${data.unlabeledFields === 1 ? '' : 's'} have no detectable label.`);
  if (Number(data.mainLandmarks) === 0) add('a11y-missing-main-landmark', 'No main element or role="main" landmark was found.');
  if (Number(data.mainLandmarks) > 1) add('a11y-multiple-main-landmarks', `${data.mainLandmarks} main landmarks were found.`);
  if (Number(data.duplicateIds) > 0) add('a11y-duplicate-ids', `${data.duplicateIds} duplicate ID occurrence${data.duplicateIds === 1 ? '' : 's'} were found.`);
  if (Number(data.brokenAriaReferences) > 0) add('a11y-broken-aria-references', `${data.brokenAriaReferences} ARIA reference${data.brokenAriaReferences === 1 ? '' : 's'} point to missing IDs.`);
  if (Number(data.positiveTabindex) > 0) add('a11y-positive-tabindex', `${data.positiveTabindex} element${data.positiveTabindex === 1 ? '' : 's'} use a positive tabindex.`);
  if (Number(data.hiddenFocusableElements) > 0) add('a11y-hidden-focusable', `${data.hiddenFocusableElements} aria-hidden region${data.hiddenFocusableElements === 1 ? '' : 's'} contain focusable controls.`);
  if (data.zoomRestricted) add('a11y-zoom-restricted', `The viewport value restricts page zoom: ${pageData.viewport || 'restricted viewport'}.`);
  if (pageData.likelyJavascriptShell) add('javascript-shell-limited-evidence', 'The downloaded HTML contains an application root and scripts but very little readable content.');
  return issues;
}
