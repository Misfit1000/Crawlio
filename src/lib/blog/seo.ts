import { createBlogSlug } from './slug';
import { resolveBlogLengthRange } from './length-policy';

function cleanText(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function truncateAtWord(value: string, maxLength: number) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  const sliced = text.slice(0, Math.max(1, maxLength - 1));
  const boundary = sliced.lastIndexOf(' ');
  return `${(boundary > maxLength * 0.6 ? sliced.slice(0, boundary) : sliced).trim()}...`;
}

export function estimateReadingTime(contentText: string) {
  const words = cleanText(contentText).split(' ').filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

export function buildBlogSeoFields(input: {
  title: string;
  excerpt?: string;
  contentText?: string;
  focusKeyword?: string;
}) {
  const title = cleanText(input.title);
  const focusKeyword = cleanText(input.focusKeyword || '');
  const contentText = cleanText(input.contentText || '');
  const excerptSource = cleanText(input.excerpt || '') || contentText;
  const titleWithKeyword = focusKeyword && !title.toLowerCase().includes(focusKeyword.toLowerCase())
    ? `${title}: ${focusKeyword}`
    : title;

  return {
    slug: createBlogSlug(title),
    seoTitle: truncateAtWord(titleWithKeyword, 60),
    metaDescription: truncateAtWord(excerptSource, 160),
    excerpt: truncateAtWord(excerptSource, 280),
    focusKeyword,
  };
}

export function blogSeoChecklist(post: Pick<import('./types').BlogPostInput, 'title' | 'slug' | 'excerpt' | 'contentHtml' | 'focusKeyword' | 'seoTitle' | 'metaDescription' | 'articleType'>) {
  const text = cleanText(post.contentHtml.replace(/<[^>]+>/g, ' '));
  const keyword = cleanText(post.focusKeyword || '').toLowerCase();
  const words = text.split(' ').filter(Boolean).length;
  const length = resolveBlogLengthRange({ articleType: post.articleType });
  return [
    { label: 'SEO title is 30-60 characters', pass: Boolean(post.seoTitle && post.seoTitle.length >= 30 && post.seoTitle.length <= 60) },
    { label: 'Meta description is 120-160 characters', pass: Boolean(post.metaDescription && post.metaDescription.length >= 120 && post.metaDescription.length <= 160) },
    { label: 'Slug is readable and concise', pass: Boolean(post.slug && post.slug.length <= 75 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug)) },
    { label: `${length.label} targets ${length.minimum.toLocaleString()}-${length.maximum.toLocaleString()} useful words`, pass: words >= length.minimum && words <= length.maximum },
    { label: 'Focus phrase appears in title and introduction', pass: Boolean(keyword && post.title.toLowerCase().includes(keyword) && text.slice(0, 700).toLowerCase().includes(keyword)) },
    { label: 'Excerpt clearly summarizes the article', pass: Boolean(post.excerpt && post.excerpt.length >= 90) },
  ];
}
