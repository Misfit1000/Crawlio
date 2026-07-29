import { load } from 'cheerio';
import { blogTextFromHtml, sanitizeBlogHtml } from '../sanitize';
import { generateGroqStructured } from './groq';

function hasHeadingPayload(value: unknown): value is { headings: string[] } {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as any).headings)
    && (value as any).headings.length >= 3
    && (value as any).headings.every((heading: unknown) => typeof heading === 'string' && heading.trim().length >= 4));
}

export async function suggestBlogHeadingStructure(contentHtml: string) {
  const sanitized = sanitizeBlogHtml(contentHtml);
  const currentHeadings = [...sanitized.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map((match) => blogTextFromHtml(match[1] || ''));
  if (currentHeadings.length >= 3) return { contentHtml: sanitized, headings: currentHeadings, changed: false };
  const text = blogTextFromHtml(sanitized).replace(/\s+/g, ' ').trim().slice(0, 12_000);
  if (text.split(/\s+/).length < 120) throw new Error('Write more article content before generating section headings.');
  const result = await generateGroqStructured({
    role: 'structured',
    system: 'Return only JSON. Suggest concise H2 headings that organize the supplied article without adding facts or changing its meaning.',
    user: `Return {"headings":["","",""]}. Each heading must describe a distinct existing part of this article. Article: ${JSON.stringify(text)}`,
    validate: hasHeadingPayload,
    temperature: 0.1,
    maxTokens: 500,
  });
  const headings = result.data.headings.map((heading) => heading.replace(/\s+/g, ' ').trim().slice(0, 100)).slice(0, 3);
  const $ = load(`<main id="article-root">${sanitized}</main>`);
  const paragraphs = $('#article-root > p').toArray().filter((node) => $(node).text().trim().length >= 40);
  if (paragraphs.length < 3) throw new Error('Use at least three substantial paragraphs before generating headings.');
  const positions = [0, Math.floor(paragraphs.length / 3), Math.floor((paragraphs.length * 2) / 3)];
  headings.forEach((heading, index) => $(paragraphs[positions[index]]).before(`<h2>${heading.replace(/[&<>"']/g, '')}</h2>`));
  return { contentHtml: sanitizeBlogHtml($('#article-root').html() || sanitized), headings, changed: true };
}
