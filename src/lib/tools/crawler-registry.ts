export const CRAWLER_REGISTRY = [
  { token: 'CrawlioBot', label: 'Crawlio', use: 'Audit crawler', documentation: 'https://www.rfc-editor.org/rfc/rfc9309.html' },
  { token: 'Googlebot', label: 'Google Search', use: 'Search crawler', documentation: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers' },
  { token: 'OAI-SearchBot', label: 'OpenAI Search', use: 'Search crawler', documentation: 'https://developers.openai.com/api/docs/bots' },
  { token: 'GPTBot', label: 'OpenAI GPTBot', use: 'Training crawler', documentation: 'https://developers.openai.com/api/docs/bots' },
  { token: 'ChatGPT-User', label: 'ChatGPT user request', use: 'User fetch; robots may not apply', documentation: 'https://developers.openai.com/api/docs/bots' },
  { token: 'Claude-SearchBot', label: 'Claude Search', use: 'Search crawler', documentation: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler' },
  { token: 'ClaudeBot', label: 'ClaudeBot', use: 'Training crawler', documentation: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler' },
  { token: 'Claude-User', label: 'Claude user request', use: 'User fetch', documentation: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler' },
  { token: 'PerplexityBot', label: 'Perplexity Search', use: 'Search crawler', documentation: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers' },
  { token: 'Perplexity-User', label: 'Perplexity user request', use: 'User fetch; generally ignores robots', documentation: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers' },
  { token: 'Applebot', label: 'Applebot', use: 'Search crawler; Googlebot fallback', documentation: 'https://support.apple.com/en-us/119829' },
  { token: 'Google-Extended', label: 'Google-Extended', use: 'Usage control, not a crawler', documentation: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers', control: true },
  { token: 'Applebot-Extended', label: 'Applebot-Extended', use: 'Usage control, not a crawler', documentation: 'https://support.apple.com/en-us/119829', control: true },
] as const;
export const CRAWLER_REGISTRY_VERIFIED_AT = '2026-10-02';
