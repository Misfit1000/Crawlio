import { AuditIssue } from '../../audit/types';

export function runContentChecks(pageData: any): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const url = pageData.url || '';
  
  if (pageData.wordCount !== undefined) {
    if (pageData.wordCount < 300 && pageData.status === 200) {
      issues.push({ id: 'low-word-count', category: 'content', severity: 'medium', title: 'Low Word Count', description: `Page has only ${pageData.wordCount} words (less than 300).`, affectedUrl: url });
    }
  }
  
  // Simulated spelling/grammar check (we don't have this, so we use dummy for now or skip)
  if (pageData.imagesWithoutAlt && pageData.imagesWithoutAlt > 0) {
    issues.push({ id: 'missing-image-alt', category: 'content', severity: 'medium', title: 'Missing Image Alt Text', description: `${pageData.imagesWithoutAlt} images are missing alt text.`, affectedUrl: url });
  }
  
  if (pageData.topPhrases && pageData.topPhrases.includes('lorem ipsum')) {
     issues.push({ id: 'lorem-ipsum', category: 'content', severity: 'high', title: 'Placeholder Content', description: 'Page contains "Lorem Ipsum" placeholder text.', affectedUrl: url });
  }

  return issues;
}
