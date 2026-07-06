import { ParsedPageData } from './html-parser';

export interface SeoIssue {
  id: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  evidence: string;
  recommendation: string;
  affectedUrl: string;
}

export interface AuditResult {
  score: number;
  passed: number;
  issues: SeoIssue[];
}

export function auditPage(url: string, data: ParsedPageData): AuditResult {
  const issues: SeoIssue[] = [];
  let score = 100;
  let passed = 0;

  // Title checks
  if (!data.title) {
    issues.push({
      id: 'missing-title', category: 'On-Page', severity: 'critical',
      title: 'Missing Page Title', description: 'The page has no <title> tag.',
      evidence: 'Title is empty', recommendation: 'Add a descriptive <title> tag.', affectedUrl: url
    });
    score -= 20;
  } else if (data.title.length < 30) {
    issues.push({
      id: 'short-title', category: 'On-Page', severity: 'medium',
      title: 'Title Too Short', description: 'The title is too short (under 30 characters).',
      evidence: `Length: ${data.title.length}`, recommendation: 'Expand the title to 50-60 characters.', affectedUrl: url
    });
    score -= 5;
  } else if (data.title.length > 60) {
    issues.push({
      id: 'long-title', category: 'On-Page', severity: 'medium',
      title: 'Title Too Long', description: 'The title may be truncated in search results.',
      evidence: `Length: ${data.title.length}`, recommendation: 'Keep the title under 60 characters.', affectedUrl: url
    });
    score -= 5;
  } else {
    passed++;
  }

  // Meta Description checks
  if (!data.metaDescription) {
    issues.push({
      id: 'missing-meta-desc', category: 'On-Page', severity: 'high',
      title: 'Missing Meta Description', description: 'No meta description found.',
      evidence: 'Meta description is empty', recommendation: 'Add a compelling meta description.', affectedUrl: url
    });
    score -= 15;
  } else if (data.metaDescription.length < 70) {
    issues.push({
      id: 'short-meta-desc', category: 'On-Page', severity: 'low',
      title: 'Meta Description Too Short', description: 'The description is very short.',
      evidence: `Length: ${data.metaDescription.length}`, recommendation: 'Expand to 120-150 characters.', affectedUrl: url
    });
    score -= 2;
  } else if (data.metaDescription.length > 160) {
    issues.push({
      id: 'long-meta-desc', category: 'On-Page', severity: 'low',
      title: 'Meta Description Too Long', description: 'The description may be truncated.',
      evidence: `Length: ${data.metaDescription.length}`, recommendation: 'Keep it under 160 characters.', affectedUrl: url
    });
    score -= 2;
  } else {
    passed++;
  }

  // H1 Checks
  if (data.h1.length === 0) {
    issues.push({
      id: 'missing-h1', category: 'Structure', severity: 'high',
      title: 'Missing H1 Heading', description: 'The page has no H1 tag.',
      evidence: '0 H1 tags found', recommendation: 'Add exactly one H1 tag describing the main topic.', affectedUrl: url
    });
    score -= 10;
  } else if (data.h1.length > 1) {
    issues.push({
      id: 'multiple-h1', category: 'Structure', severity: 'medium',
      title: 'Multiple H1 Headings', description: 'Found multiple H1 tags, which can confuse search engines.',
      evidence: `${data.h1.length} H1 tags found`, recommendation: 'Use only one H1 tag per page.', affectedUrl: url
    });
    score -= 5;
  } else {
    passed++;
  }

  // Content length
  if (data.wordCount < 300) {
    issues.push({
      id: 'thin-content', category: 'Content', severity: 'high',
      title: 'Thin Content', description: 'The page has very little text content.',
      evidence: `${data.wordCount} words`, recommendation: 'Expand the content to at least 300-500 words.', affectedUrl: url
    });
    score -= 10;
  } else {
    passed++;
  }

  // Image Alt text
  if (data.imagesWithoutAlt > 0) {
    issues.push({
      id: 'missing-alt', category: 'Accessibility', severity: 'medium',
      title: 'Missing Image Alt Text', description: 'Some images are missing alt attributes.',
      evidence: `${data.imagesWithoutAlt} images without alt text`, recommendation: 'Add descriptive alt text to all non-decorative images.', affectedUrl: url
    });
    score -= 5;
  } else {
    passed++;
  }

  return {
    score: Math.max(0, score),
    passed,
    issues
  };
}
