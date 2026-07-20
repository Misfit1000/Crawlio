import { createBlogSlug } from './slug';
import type { BlogPost, BlogTopic } from './types';

export function getBlogTopicName(post: Pick<BlogPost, 'topicCluster' | 'tags'>) {
  return String(post.topicCluster || 'SEO guides').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function getBlogTopicSlug(value: string) {
  return createBlogSlug(value || 'seo-guides');
}

export function buildBlogTopics(posts: Array<Pick<BlogPost, 'topicCluster' | 'tags' | 'publishedAt'>>) {
  const topics = new Map<string, BlogTopic>();
  for (const post of posts) {
    const name = getBlogTopicName(post);
    const slug = getBlogTopicSlug(name);
    const existing = topics.get(slug);
    const publishedAt = post.publishedAt || null;
    topics.set(slug, {
      name: existing?.name || name,
      slug,
      articleCount: (existing?.articleCount || 0) + 1,
      latestPublishedAt: !existing?.latestPublishedAt || (publishedAt && publishedAt > existing.latestPublishedAt)
        ? publishedAt
        : existing.latestPublishedAt,
    });
  }
  return [...topics.values()].sort((left, right) => (
    right.articleCount - left.articleCount
    || String(right.latestPublishedAt || '').localeCompare(String(left.latestPublishedAt || ''))
    || left.name.localeCompare(right.name)
  ));
}

export function getArticleSchemaType(articleType: string) {
  return ['urgent_news', 'news_analysis'].includes(String(articleType || '')) ? 'NewsArticle' : 'BlogPosting';
}
