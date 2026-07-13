import type { BlogArticleType, BlogLengthMode } from './types';

export interface BlogLengthRange {
  minimum: number;
  maximum: number;
  label: string;
}

export const BLOG_ARTICLE_LENGTHS: Record<BlogArticleType, BlogLengthRange> = {
  urgent_news: { minimum: 700, maximum: 1200, label: 'Brief urgent news update' },
  news_analysis: { minimum: 1200, maximum: 2000, label: 'Detailed news analysis' },
  glossary: { minimum: 700, maximum: 1200, label: 'Focused glossary or explainer' },
  checklist: { minimum: 1000, maximum: 1800, label: 'Checklist article' },
  evergreen_guide: { minimum: 1500, maximum: 2500, label: 'Standard evergreen SEO guide' },
  troubleshooting_guide: { minimum: 1500, maximum: 2500, label: 'Troubleshooting guide' },
  technical_guide: { minimum: 2000, maximum: 3500, label: 'Deep technical guide' },
  comparison: { minimum: 1200, maximum: 2400, label: 'Comparison' },
};

const LEGACY_TYPES: Record<string, BlogArticleType> = {
  'urgent news': 'urgent_news',
  'news update': 'urgent_news',
  'news analysis': 'news_analysis',
  glossary: 'glossary',
  explainer: 'glossary',
  checklist: 'checklist',
  'evergreen guide': 'evergreen_guide',
  'technical tutorial': 'technical_guide',
  'troubleshooting guide': 'troubleshooting_guide',
  comparison: 'comparison',
};

export function normalizeBlogArticleType(value: unknown, fallback: BlogArticleType = 'evergreen_guide'): BlogArticleType {
  const normalized = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_') as BlogArticleType;
  if (normalized in BLOG_ARTICLE_LENGTHS) return normalized;
  return LEGACY_TYPES[String(value || '').trim().toLowerCase()] || fallback;
}

export function resolveBlogLengthRange(input: {
  articleType?: unknown;
  mode?: BlogLengthMode | string;
  customMinimum?: number;
  customMaximum?: number;
}): BlogLengthRange {
  const automatic = BLOG_ARTICLE_LENGTHS[normalizeBlogArticleType(input.articleType)];
  if (input.mode === 'brief') return { minimum: 700, maximum: 1200, label: 'Brief' };
  if (input.mode === 'standard') return { minimum: 1200, maximum: 2000, label: 'Standard' };
  if (input.mode === 'detailed') return { minimum: 1800, maximum: 3000, label: 'Detailed' };
  if (input.mode === 'custom') {
    const minimum = Math.max(500, Math.min(3500, Math.floor(Number(input.customMinimum) || automatic.minimum)));
    const maximum = Math.max(minimum, Math.min(4000, Math.floor(Number(input.customMaximum) || automatic.maximum)));
    return { minimum, maximum, label: 'Custom range' };
  }
  return automatic;
}
