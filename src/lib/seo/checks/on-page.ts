import { AuditIssue } from '../../audit/types';

export function runOnPageChecks(pageData: any): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const url = pageData.url || '';
  
  // 1. Missing Title
  if (!pageData.title) {
    issues.push({ id: 'missing-title', category: 'on-page', severity: 'critical', title: 'Missing Title Tag', description: 'The page does not have a title tag.', affectedUrl: url });
  } else {
    // 2. Title too short
    if (pageData.title.length < 30) {
      issues.push({ id: 'title-too-short', category: 'on-page', severity: 'medium', title: 'Title Too Short', description: 'Title is under 30 characters.', affectedUrl: url });
    }
    // 3. Title too long
    if (pageData.title.length > 60) {
      issues.push({ id: 'title-too-long', category: 'on-page', severity: 'medium', title: 'Title Too Long', description: 'Title is over 60 characters.', affectedUrl: url });
    }
  }

  // 4. Missing Meta Description
  if (!pageData.metaDescription) {
    issues.push({ id: 'missing-meta-desc', category: 'on-page', severity: 'high', title: 'Missing Meta Description', description: 'The page lacks a meta description.', affectedUrl: url });
  } else {
    // 5. Meta Description too short
    if (pageData.metaDescription.length < 50) {
      issues.push({ id: 'desc-too-short', category: 'on-page', severity: 'medium', title: 'Meta Description Too Short', description: 'Meta description is under 50 characters.', affectedUrl: url });
    }
    // 6. Meta Description too long
    if (pageData.metaDescription.length > 160) {
      issues.push({ id: 'desc-too-long', category: 'on-page', severity: 'medium', title: 'Meta Description Too Long', description: 'Meta description is over 160 characters.', affectedUrl: url });
    }
  }

  // 7. Missing H1
  if (!pageData.headings?.h1 || pageData.headings.h1.length === 0) {
    issues.push({ id: 'missing-h1', category: 'on-page', severity: 'high', title: 'Missing H1 Heading', description: 'The page does not have an H1 tag.', affectedUrl: url });
  } else if (pageData.headings.h1.length > 1) {
    // 8. Multiple H1s
    issues.push({ id: 'multiple-h1', category: 'on-page', severity: 'low', title: 'Multiple H1 Headings', description: 'The page has multiple H1 tags.', affectedUrl: url });
  }
  
  // 9. H1 same as Title
  if (pageData.title && pageData.headings?.h1 && pageData.headings.h1[0] && pageData.title.trim() === pageData.headings.h1[0].trim()) {
    issues.push({ id: 'h1-equals-title', category: 'on-page', severity: 'info', title: 'H1 Same as Title', description: 'H1 heading and Title tag are exactly the same.', affectedUrl: url });
  }

  // 10. Missing OG Tags
  if (!pageData.ogTitle) {
    issues.push({ id: 'missing-og-title', category: 'on-page', severity: 'low', title: 'Missing Open Graph Title', description: 'Page lacks OG title tag for social sharing.', affectedUrl: url });
  }

  // 11. Missing Twitter Cards
  if (!pageData.twitterCard) {
    issues.push({ id: 'missing-twitter', category: 'on-page', severity: 'low', title: 'Missing Twitter Card', description: 'Page lacks Twitter card tag.', affectedUrl: url });
  }

  return issues;
}
