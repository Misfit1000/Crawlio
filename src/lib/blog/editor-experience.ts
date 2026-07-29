import { blogTextFromHtml } from './html-text';
import { buildBlogSeoFields, truncateAtWord } from './seo';
import { evaluateBlogQuality, inspectBlogLinks } from './quality';
import type { BlogPostInput } from './types';

export type BlogEditorStep = 'write' | 'review' | 'publish';
export type BlogAutosaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'failed';
export type BlogReadinessSeverity = 'required' | 'warning' | 'ready';

export interface BlogReadinessItem {
  id: string;
  label: string;
  explanation: string;
  severity: BlogReadinessSeverity;
  passed: boolean;
  fixableAutomatically: boolean;
  fixAction: string | null;
}

const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'what', 'when', 'with', 'your']);

function meaningfulWords(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function firstSentences(value: string, count: number) {
  return value.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean).slice(0, count).join(' ');
}

export function deriveAutomaticBlogFields(input: BlogPostInput) {
  const title = String(input.title || '').replace(/\s+/g, ' ').trim();
  const text = blogTextFromHtml(String(input.contentHtml || '')).replace(/\s+/g, ' ').trim();
  if (!title) return { slug: '', excerpt: '', tagline: '', summary: '', focusKeyword: '', tags: [], topicCluster: '', seoTitle: '', metaDescription: '' };
  const terms = [...new Set(meaningfulWords(title))];
  const focusKeyword = terms.slice(0, 5).join(' ') || title.toLowerCase();
  const excerpt = truncateAtWord(firstSentences(text, 2) || title, 280);
  const taglineCandidate = firstSentences(text, 1);
  const tagline = truncateAtWord(taglineCandidate && taglineCandidate.toLowerCase() !== title.toLowerCase()
    ? taglineCandidate
    : `${title} explained with practical checks and next steps.`, 180);
  const summary = truncateAtWord(firstSentences(text, 4) || excerpt, 580);
  const seo = buildBlogSeoFields({ title, excerpt, contentText: text, focusKeyword });
  const topicCluster = terms.slice(0, 3).map((word) => word[0]?.toUpperCase() + word.slice(1)).join(' ') || 'SEO guidance';
  const tags = [...new Set([...terms.slice(0, 6), 'SEO'])].slice(0, 8);
  return { slug: seo.slug, excerpt, tagline, summary, focusKeyword, tags, topicCluster, seoTitle: seo.seoTitle, metaDescription: seo.metaDescription };
}

export function buildBlogReadiness(input: BlogPostInput): BlogReadinessItem[] {
  const report = evaluateBlogQuality(input, { requireSources: true });
  const safeFixIds = new Set(['source-links', 'internal-links']);
  const items: BlogReadinessItem[] = report.checks.map((item) => ({
    id: item.id,
    label: item.label,
    explanation: item.detail,
    severity: item.passed ? 'ready' : item.critical ? 'required' : 'warning',
    passed: item.passed,
    fixableAutomatically: !item.passed && safeFixIds.has(item.id),
    fixAction: !item.passed && safeFixIds.has(item.id) ? 'fix_links' : item.id === 'headings' && !item.passed ? 'suggest_headings' : null,
  }));
  const fields = [
    ['excerpt', 'Add a clear excerpt', String(input.excerpt || '').length >= 60, 'At least 60 characters are required.', 'generate_metadata'],
    ['seo-title', 'Add a search title', String(input.seoTitle || '').length >= 20, 'At least 20 characters are required.', 'generate_metadata'],
    ['meta-description', 'Add a search description', String(input.metaDescription || '').length >= 70, 'At least 70 characters are required.', 'generate_metadata'],
  ] as const;
  fields.forEach(([id, label, passed, explanation, action]) => items.push({ id, label, explanation, passed, severity: passed ? 'ready' : 'required', fixableAutomatically: !passed, fixAction: passed ? null : action }));
  return items;
}

export function blogEditorWordCount(contentHtml: string) {
  const text = blogTextFromHtml(contentHtml);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

export function blogEditorHasMeaningfulChanges(input: BlogPostInput) {
  return String(input.title || '').trim().length >= 3 || blogEditorWordCount(String(input.contentHtml || '')) > 0;
}

export function currentBlogLinks(input: BlogPostInput) {
  return inspectBlogLinks(String(input.contentHtml || ''));
}
