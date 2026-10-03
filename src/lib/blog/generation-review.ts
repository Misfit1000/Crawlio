export interface BlogGenerationReview {
  status: 'passed' | 'needs_review' | 'unavailable';
  warnings: string[];
  recommendation: string;
}

function reviewText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b(?:Bearer\s+\S+|(?:sk|gsk|sb_secret)_[A-Za-z0-9_-]+)/gi, '[redacted]')
    .slice(0, limit);
}

export function projectBlogGenerationReview(value: unknown): BlogGenerationReview {
  const review = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const warnings = Array.isArray(review.warnings)
    ? [...new Set(review.warnings.map((item) => reviewText(item, 800)).filter(Boolean))].slice(0, 30)
    : [];
  return {
    status: review.claimsSupported === true ? 'passed' : review.claimsSupported === false ? 'needs_review' : 'unavailable',
    warnings,
    recommendation: reviewText(review.publicationRecommendation, 1600),
  };
}
