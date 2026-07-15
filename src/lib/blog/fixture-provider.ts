import { createBlogSlug } from './slug';
import { selectBlogSection, replaceSelectedBlogSection, type BlogSectionAction } from './section-regeneration';
import type { BlogArticleType, BlogFixtureScenario, BlogPost, BlogProviderDraft, BlogSource } from './types';

export const BLOG_FIXTURE_PROVIDER = 'fixture_test';
export const BLOG_FIXTURE_MODEL = 'deterministic-editorial-fixture-v1';

export class BlogFixtureProviderError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BlogFixtureProviderError';
    this.code = code;
  }
}

export function getBlogFixtureConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.BLOG_FIXTURE_PROVIDER_ENABLED === 'true' && env.ALLOW_BLOG_FIXTURE_GENERATION === 'true';
  const productionOverride = env.ALLOW_PRODUCTION_BLOG_FIXTURE_GENERATION === 'true' && env.BLOG_FIXTURE_STAGING_ONLY === 'true';
  return {
    enabled: enabled && (env.NODE_ENV !== 'production' || productionOverride),
    requested: enabled,
    productionBlocked: env.NODE_ENV === 'production' && enabled && !productionOverride,
  };
}

export function requireBlogFixtureProvider(env: NodeJS.ProcessEnv = process.env) {
  const configuration = getBlogFixtureConfiguration(env);
  if (!configuration.enabled) {
    throw new BlogFixtureProviderError(
      configuration.productionBlocked ? 'BLOG_FIXTURE_PRODUCTION_BLOCKED' : 'BLOG_FIXTURE_DISABLED',
      configuration.productionBlocked
        ? 'Fixture generation is blocked in production without the protected staging override.'
        : 'Fixture generation requires both protected fixture-provider switches.',
    );
  }
  return configuration;
}

const fixtureSources: BlogSource[] = [
  {
    url: 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide',
    title: 'SEO Starter Guide',
    publisher: 'Google Search Central',
    sourceType: 'official_documentation',
    supportedClaims: ['Useful page titles and descriptive links help people and search engines understand a page.'],
    primary: true,
    reliability: 'high',
    citationStatus: 'verified',
    accessedAt: '2026-01-01T00:00:00.000Z',
  },
];

const fixtureSections = [
  ['Establish a verifiable baseline', 'scope, expected behavior, and evidence'],
  ['Confirm search engine access', 'response codes, access rules, and sitemap discovery'],
  ['Review page-level signals', 'titles, descriptions, headings, and preferred URLs'],
  ['Map internal navigation', 'crawl paths, descriptive anchors, and orphan risks'],
  ['Prioritize by impact', 'user impact, affected templates, and repair effort'],
  ['Apply a bounded correction', 'ownership, deployment scope, and rollback steps'],
  ['Validate after deployment', 'repeatable checks, changed signals, and regressions'],
  ['Record the editorial decision', 'sources, review notes, and completion criteria'],
  ['Share the repair plan', 'plain-language impact, ownership, and delivery timing'],
  ['Monitor the corrected pages', 'follow-up dates, recurring checks, and reopened findings'],
] as const;

function fixtureParagraph(topic: string, heading: string, focus: string, index: number) {
  const paragraphs = [
    `For ${heading.toLowerCase()}, begin with ${focus}. Record the affected URL group and the observation time. Separate facts from assumptions, then state the result that a reviewer should see after the work is complete. This creates a repeatable ${topic} check instead of a vague recommendation.`,
    `Review representative pages before changing a shared template. Compare one healthy page, one affected page, and one edge case. Save the response status, visible metadata, relevant links, and indexability result for each example. A small evidence set helps the team understand scope without storing raw page HTML.`,
    `Assign an owner and choose one measurable correction. Note the deployment boundary, likely side effects, and rollback condition. After release, rerun the same observations and record what changed. If the expected signal is absent, restore the previous state and investigate the template, redirect, or delivery rule.`,
  ];
  return paragraphs[index % paragraphs.length];
}

function articleHtml(topic: string, articleType: BlogArticleType) {
  const sections = articleType === 'urgent_news' ? fixtureSections.slice(0, 4) : fixtureSections;
  const introduction = `<p>A reliable ${topic} review starts with public evidence that another person can verify. Define the affected pages, current behavior, expected result, and review owner before making a change. This protected fixture demonstrates that workflow without contacting an external generation provider.</p><p>Use the <a href="/tools/seo-audit">SEO audit workspace</a> to collect findings and the <a href="/reports">report workspace</a> to keep decisions connected to their evidence. The steps below favor bounded corrections, safe validation, and useful records over broad unsupported claims.</p>`;
  const body = sections.map(([heading, focus], sectionIndex) => `<h2>${heading}</h2><p>${fixtureParagraph(topic, heading, focus, sectionIndex)}</p><p>${fixtureParagraph(topic, heading, focus, sectionIndex + 1)}</p><h3>Review checkpoint</h3><p>${fixtureParagraph(topic, heading, focus, sectionIndex + 2)}</p>`).join('');
  return `${introduction}${body}<h2>Next steps</h2><p>Summarize the evidence, choose the smallest useful correction, and record the validation result. Read the <a href="${fixtureSources[0].url}">official SEO Starter Guide</a> before changing shared search templates. Keep this fixture private and replace it with reviewed editorial content before publishing.</p>`;
}

export function generateBlogFixture(input: { topic?: string; headline?: string; articleType?: BlogArticleType; scenario?: BlogFixtureScenario }): BlogProviderDraft & { sources: BlogSource[]; fixtureLabel: string } {
  requireBlogFixtureProvider();
  const scenario = input.scenario || 'evergreen';
  if (scenario === 'timeout') throw new BlogFixtureProviderError('BLOG_FIXTURE_TIMEOUT', 'Fixture timeout simulated.');
  if (scenario === 'malformed') throw new BlogFixtureProviderError('BLOG_FIXTURE_MALFORMED_OUTPUT', 'Fixture structured-output failure simulated.');
  const topic = String(input.topic || 'technical SEO validation').replace(/\s+/g, ' ').trim().slice(0, 120);
  const articleType = input.articleType || (scenario === 'news' ? 'urgent_news' : 'evergreen_guide');
  const title = String(input.headline || `${topic.charAt(0).toUpperCase()}${topic.slice(1)}: a practical verification guide`).slice(0, 140);
  const contentHtml = scenario === 'invalid' ? '<p>Invalid fixture.</p>' : articleHtml(topic, articleType);
  return {
    title,
    excerpt: `A deterministic fixture guide for testing ${topic}, editorial review, scheduling, links, and static publishing without contacting an AI provider.`,
    tagline: 'Fixture test content for protected editorial workflow verification.',
    summary: `Use this noindex fixture to verify the complete editorial workflow for ${topic}. It is test content, not a public provider-generated article.`,
    contentHtml: scenario === 'originality_failure' ? `${contentHtml}${contentHtml}` : contentHtml,
    focusKeyword: topic,
    tags: ['fixture testing', 'editorial workflow', 'technical SEO'],
    suggestedSlug: `fixture-${createBlogSlug(topic)}`,
    seoTitle: `${title} | Crawlio fixture`,
    metaDescription: `Fixture test content used to validate Crawlio's protected editorial workflow for ${topic} without an external generation provider.`,
    articleType,
    targetWords: articleType === 'urgent_news' ? { minimum: 700, maximum: 1200, label: 'Brief news update' } : { minimum: 1500, maximum: 2500, label: 'Evergreen guide' },
    providerUsage: { model: BLOG_FIXTURE_MODEL, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    generationStages: ['fixture research', 'fixture outline', 'fixture drafting', 'fixture validation'],
    sources: scenario === 'missing_sources' ? [] : fixtureSources.map((source) => ({ ...source })),
    fixtureLabel: 'Fixture test content',
  };
}

export function regenerateFixtureSection(input: { post: BlogPost; sectionKey: string; action: BlogSectionAction }) {
  requireBlogFixtureProvider();
  const selection = selectBlogSection(input.post, input.sectionKey);
  const plain = selection.beforeHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const replacement = selection.field
    ? `${plain} Fixture revision: reviewed for ${input.action.replaceAll('_', ' ')}.`
    : `${selection.beforeHtml}<p><strong>Fixture revision:</strong> This selected section was reviewed for ${input.action.replaceAll('_', ' ')} while preserving the rest of the article.</p>`;
  return {
    selection,
    replacementHtml: replacement,
    candidate: replaceSelectedBlogSection(input.post, selection, replacement),
    changedClaims: [],
    providerUsage: { model: BLOG_FIXTURE_MODEL, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
}
