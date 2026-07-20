import { blogTextFromHtml } from './sanitize';
import type { BlogPostInput, BlogQualityCheck, BlogQualityReport, BlogSource } from './types';
import { resolveBlogLengthRange, type BlogLengthRange } from './length-policy';

const PROHIBITED_PHRASES = [
  "in today's digital landscape",
  'take your seo to the next level',
  'whether you are a beginner or an expert',
  'it is important to note',
  'game-changing',
  'cutting-edge',
  'unlock the power',
  'supercharge',
  'seamlessly',
  'powerful insights',
];

export function blogWordCount(value: string) {
  return blogTextFromHtml(value).split(/\s+/).filter(Boolean).length;
}

function words(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function sentences(value: string) {
  return value.split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
}

function check(id: string, label: string, passed: boolean, detail: string, critical = true): BlogQualityCheck {
  return { id, label, passed, detail, critical };
}

export function inspectBlogLinks(contentHtml: string) {
  return [...contentHtml.matchAll(/<a\b[^>]*\bhref=(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => ({
    href: String(match[1] || match[2] || ''),
    anchor: blogTextFromHtml(match[3] || '').replace(/\s+/g, ' ').trim(),
  }));
}

export function evaluateBlogOriginality(contentHtml: string, sourceTexts: string[]) {
  const articleWords = words(blogTextFromHtml(contentHtml));
  const articleHeadings = [...contentHtml.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)].map((match) => blogTextFromHtml(match[1] || '').toLowerCase().replace(/\s+/g, ' ').trim());
  const copiedPhrases = new Set<string>();
  let headingSequenceRisk = false;
  let closeParaphraseRisk = false;

  for (const sourceText of sourceTexts) {
    const sourceWords = words(sourceText);
    const sourceWindows = new Set<string>();
    for (let index = 0; index <= sourceWords.length - 10; index += 1) sourceWindows.add(sourceWords.slice(index, index + 10).join(' '));
    for (let index = 0; index <= articleWords.length - 10; index += 1) {
      const phrase = articleWords.slice(index, index + 10).join(' ');
      if (sourceWindows.has(phrase)) copiedPhrases.add(phrase);
    }

    const articleSentences = sentences(blogTextFromHtml(contentHtml)).map(words).filter((item) => item.length >= 12);
    const sourceSentences = sentences(sourceText).map(words).filter((item) => item.length >= 12);
    closeParaphraseRisk ||= articleSentences.some((articleSentence) => sourceSentences.some((sourceSentence) => {
      const articleSet = new Set(articleSentence);
      const sourceSet = new Set(sourceSentence);
      const intersection = [...articleSet].filter((word) => sourceSet.has(word)).length;
      const union = new Set([...articleSet, ...sourceSet]).size;
      return union > 0 && intersection / union >= 0.7;
    }));

    const sourceHeadings = sourceText.split('\n').map((item) => item.replace(/^#+\s*/, '').trim().toLowerCase()).filter(Boolean);
    if (articleHeadings.length >= 3 && sourceHeadings.length >= 3) {
      const matchingOrder = articleHeadings.filter((heading) => sourceHeadings.includes(heading));
      headingSequenceRisk ||= matchingOrder.length / articleHeadings.length >= 0.6;
    }
  }

  return {
    passed: copiedPhrases.size === 0 && !headingSequenceRisk && !closeParaphraseRisk,
    copiedPhrases: [...copiedPhrases].slice(0, 10),
    headingSequenceRisk,
    closeParaphraseRisk,
  };
}

export function evaluateBlogQuality(input: BlogPostInput, options: {
  sourceTexts?: string[];
  requireImage?: boolean;
  requireSources?: boolean;
  now?: Date;
  lengthRange?: BlogLengthRange;
} = {}): BlogQualityReport {
  const contentHtml = String(input.contentHtml || '');
  const text = blogTextFromHtml(contentHtml);
  const textWords = words(text);
  const wordCount = textWords.length;
  const links = inspectBlogLinks(contentHtml);
  const externalLinks = links.filter((link) => /^https?:\/\//i.test(link.href));
  const internalLinks = links.filter((link) => /^\/(?!\/)/.test(link.href));
  const sourceUrls = new Set((input.sources || []).map((source) => source.url));
  const sourceLinksPresent = [...sourceUrls].every((url) => externalLinks.some((link) => link.href === url));
  const sentenceList = sentences(text);
  const longSentences = sentenceList.filter((sentence) => words(sentence).length > 35);
  const paragraphTexts = [...contentHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => blogTextFromHtml(match[1] || ''));
  const veryLongParagraphs = paragraphTexts.filter((paragraph) => words(paragraph).length > 180);
  const lowerText = text.toLowerCase();
  const prohibited = PROHIBITED_PHRASES.filter((phrase) => lowerText.includes(phrase));
  const focusWords = words(input.focusKeyword || '');
  const focusPhrase = focusWords.join(' ');
  const focusMatches = focusPhrase ? lowerText.split(focusPhrase).length - 1 : 0;
  const keywordDensity = focusWords.length && wordCount ? (focusMatches * focusWords.length) / wordCount : 0;
  const originality = evaluateBlogOriginality(contentHtml, options.sourceTexts || []);
  const sources = input.sources || [];
  const sourceMetadataValid = sources.every((source: BlogSource) => /^https?:\/\//.test(source.url) && source.title.trim() && source.publisher.trim());
  const headingCount = [...contentHtml.matchAll(/<h2\b/gi)].length;
  const headingTags = [...contentHtml.matchAll(/<(h[234])\b/gi)].map((match) => match[1].toLowerCase());
  const logicalHeadings = headingTags.length > 0 && headingTags[0] === 'h2' && headingTags.every((tag, index) => {
    if (index === 0 || tag === 'h2') return true;
    const previousLevel = Number(headingTags[index - 1].slice(1));
    return Number(tag.slice(1)) <= previousLevel + 1;
  });
  const bodyH1Count = [...contentHtml.matchAll(/<h1\b/gi)].length;
  const lengthRange = options.lengthRange || resolveBlogLengthRange({ articleType: input.articleType });
  const normalizedTitle = words(input.title).join(' ');
  const normalizedTagline = words(input.tagline || '').join(' ');
  const checks = [
    check('article-length', `${lengthRange.label} length is appropriate`, wordCount >= lengthRange.minimum && wordCount <= lengthRange.maximum, `${wordCount} words found; ${lengthRange.minimum}-${lengthRange.maximum} is the editorial target.`, false),
    check('useful-substance', 'Article contains enough useful substance', wordCount >= 500, `${wordCount} words found; at least 500 are required.`),
    check('single-h1', 'The page renderer supplies exactly one H1', bodyH1Count === 0, bodyH1Count ? 'Remove H1 elements from the article body.' : 'No duplicate body H1 found.'),
    check('tagline', 'Tagline adds context', String(input.tagline || '').trim().length >= 25 && normalizedTagline !== normalizedTitle && !normalizedTagline.startsWith(normalizedTitle), 'Use a concise subtitle that does not repeat the title.'),
    check('headings', 'Article has useful H2 structure', headingCount >= 3, `${headingCount} H2 headings found.`),
    check('heading-order', 'Heading levels are logical', logicalHeadings, 'Start with H2 and do not skip heading levels.'),
    check('sources', 'Required research sources are recorded', !options.requireSources || sources.length > 0, `${sources.length} research sources recorded; add a source URL, title, and publisher.`),
    check('source-metadata', 'Source metadata is complete', sourceMetadataValid, 'Every source needs a valid URL, title, and publisher.'),
    check('source-links', 'Every stored source is hyperlinked', sourceLinksPresent, 'Source URLs must appear as crawlable links in the article.'),
    check('descriptive-anchors', 'Links use descriptive anchor text', links.every((link) => link.anchor.length >= 3 && !/^(click here|here|read more)$/i.test(link.anchor)), `${links.length} crawlable links checked.`),
    check('internal-links', 'At least two internal links are crawlable', internalLinks.length >= 2 && internalLinks.every((link) => /^\/(?:[a-z0-9]|#)[^\s]*$/i.test(link.href)), `${internalLinks.length} internal links checked; add at least two relative links such as /blog and /#start-audit.`),
    check('image', 'Required image is present', !options.requireImage || Boolean(input.ogImageUrl), input.ogImageUrl ? 'Featured image URL supplied.' : 'No featured image supplied.'),
    check('originality', 'No copied phrases, close paraphrases, or source-order imitation', originality.passed, originality.copiedPhrases.length ? `${originality.copiedPhrases.length} matching long phrases found.` : originality.closeParaphraseRisk ? 'A sentence is too close to source wording.' : originality.headingSequenceRisk ? 'Heading order is too close to a source.' : 'No high-risk source overlap found.'),
    check('generated-phrases', 'No generic generated-language phrases', prohibited.length === 0, prohibited.length ? `Remove: ${prohibited.join(', ')}` : 'No prohibited phrases found.'),
    check('sentence-length', 'Sentences stay concise', sentenceList.length === 0 || longSentences.length / sentenceList.length <= 0.08, `${longSentences.length} of ${sentenceList.length} sentences exceed 35 words.`, false),
    check('paragraph-length', 'Paragraphs stay readable', veryLongParagraphs.length === 0, `${veryLongParagraphs.length} paragraphs exceed 180 words.`, false),
    check('keyword-use', 'Focus phrase is not repeated excessively', keywordDensity <= 0.035, `Estimated exact-phrase density is ${(keywordDensity * 100).toFixed(1)}%.`),
  ];
  const blockedReasons = checks.filter((item) => item.critical && !item.passed).map((item) => item.label);
  const warnings = checks.filter((item) => !item.critical && !item.passed).map((item) => item.label);

  return {
    status: blockedReasons.length ? 'blocked' : warnings.length ? 'needs_review' : 'passed',
    wordCount,
    checks,
    blockedReasons,
    warnings,
    checkedAt: (options.now || new Date()).toISOString(),
  };
}

export { PROHIBITED_PHRASES };
