import { cloudflarePublicFetch } from '../../../audit-core/adapters/cloudflare-network-adapter';
import { parseRobotsTxt, isBlockedByRobots } from '../../../audit-core/robots';
import { normalizeCrawlUrl } from '../../../audit-core/url';

export interface BotPermission {
  botName: string;
  category: 'search_engine' | 'ai_crawler' | 'seo_tool';
  allowedByRobotsTxt: boolean;
  metaRobotsDirectives: {
    noindex: boolean;
    nofollow: boolean;
    noarchive: boolean;
    nosnippet: boolean;
  };
  summary: 'allowed' | 'blocked_by_robots' | 'disallowed_from_indexing' | 'fully_blocked';
  notes: string;
}

export interface BotSimulationResult {
  url: string;
  origin: string;
  robotsTxtFound: boolean;
  robotsTxtRaw: string;
  sitemapsInRobots: string[];
  bots: BotPermission[];
  aiTrainingPolicy: {
    allowsOpenAiGptBot: boolean;
    allowsAnthropicClaudeBot: boolean;
    allowsPerplexityBot: boolean;
    allowsCommonCrawl: boolean;
    allowsGoogleExtended: boolean;
    summary: string;
  };
}

const TRACKED_BOTS = [
  { name: 'Googlebot', category: 'search_engine' as const },
  { name: 'Bingbot', category: 'search_engine' as const },
  { name: 'CrawlioBot', category: 'seo_tool' as const },
  { name: 'AhrefsBot', category: 'seo_tool' as const },
  { name: 'SemrushBot', category: 'seo_tool' as const },
  { name: 'GPTBot', category: 'ai_crawler' as const },
  { name: 'ClaudeBot', category: 'ai_crawler' as const },
  { name: 'PerplexityBot', category: 'ai_crawler' as const },
  { name: 'CCBot', category: 'ai_crawler' as const },
  { name: 'Bytespider', category: 'ai_crawler' as const },
  { name: 'Google-Extended', category: 'ai_crawler' as const },
];

function parseMetaDirectives(content: string, xRobotsHeader?: string) {
  const combined = `${content || ''}, ${xRobotsHeader || ''}`.toLowerCase();
  return {
    noindex: combined.includes('noindex'),
    nofollow: combined.includes('nofollow'),
    noarchive: combined.includes('noarchive'),
    nosnippet: combined.includes('nosnippet'),
  };
}

export async function simulateBotAccess(targetUrl: string): Promise<BotSimulationResult> {
  const cleanUrl = normalizeCrawlUrl(targetUrl) || targetUrl;
  const origin = new URL(cleanUrl).origin;

  let robotsTxtRaw = '';
  let robotsRules = { allow: [] as string[], disallow: [] as string[], sitemaps: [] as string[] };
  let robotsTxtFound = false;

  try {
    const robotsResp = await cloudflarePublicFetch(`${origin}/robots.txt`, {
      timeoutMs: 6000,
      maxBytes: 512_000,
      allowedContentTypes: ['text/plain', 'text/html'],
    });
    if (robotsResp.status >= 200 && robotsResp.status < 300) {
      robotsTxtRaw = robotsResp.body;
      robotsRules = parseRobotsTxt(robotsTxtRaw);
      robotsTxtFound = true;
    }
  } catch {}

  let metaContent = '';
  let xRobotsHeader = '';

  try {
    const pageResp = await cloudflarePublicFetch(cleanUrl, {
      timeoutMs: 8000,
      maxBytes: 1_000_000,
    });
    xRobotsHeader = pageResp.headers['x-robots-tag'] || '';

    const metaMatch = pageResp.body.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
    if (metaMatch) {
      metaContent = metaMatch[1];
    }
  } catch {}

  const metaDirectives = parseMetaDirectives(metaContent, xRobotsHeader);

  const bots: BotPermission[] = TRACKED_BOTS.map((bot) => {
    let allowedByRobots = true;

    if (robotsTxtFound) {
      const botSpecificRules = parseRobotsForBot(robotsTxtRaw, bot.name);
      if (botSpecificRules.hasSpecificRules) {
        allowedByRobots = !isBlockedByRobots(cleanUrl, botSpecificRules.rules);
      } else {
        allowedByRobots = !isBlockedByRobots(cleanUrl, robotsRules);
      }
    }

    let summary: BotPermission['summary'] = 'allowed';
    let notes = 'Permitted to crawl and index.';

    if (!allowedByRobots && metaDirectives.noindex) {
      summary = 'fully_blocked';
      notes = 'Blocked by robots.txt and flagged noindex.';
    } else if (!allowedByRobots) {
      summary = 'blocked_by_robots';
      notes = 'Blocked by robots.txt directive.';
    } else if (metaDirectives.noindex) {
      summary = 'disallowed_from_indexing';
      notes = 'Crawling permitted, but noindex directive instructs bot not to index.';
    }

    return {
      botName: bot.name,
      category: bot.category,
      allowedByRobotsTxt: allowedByRobots,
      metaRobotsDirectives: metaDirectives,
      summary,
      notes,
    };
  });

  const allowsOpenAiGptBot = bots.find((b) => b.botName === 'GPTBot')?.allowedByRobotsTxt ?? true;
  const allowsAnthropicClaudeBot = bots.find((b) => b.botName === 'ClaudeBot')?.allowedByRobotsTxt ?? true;
  const allowsPerplexityBot = bots.find((b) => b.botName === 'PerplexityBot')?.allowedByRobotsTxt ?? true;
  const allowsCommonCrawl = bots.find((b) => b.botName === 'CCBot')?.allowedByRobotsTxt ?? true;
  const allowsGoogleExtended = bots.find((b) => b.botName === 'Google-Extended')?.allowedByRobotsTxt ?? true;

  const aiAllowedCount = [allowsOpenAiGptBot, allowsAnthropicClaudeBot, allowsPerplexityBot, allowsCommonCrawl, allowsGoogleExtended].filter(Boolean).length;
  let aiSummary = 'All AI crawlers and LLM training bots are currently permitted.';
  if (aiAllowedCount === 0) {
    aiSummary = 'Strict AI opt-out: All major AI training crawlers (OpenAI, Anthropic, Common Crawl, Gemini) are blocked.';
  } else if (aiAllowedCount < 5) {
    aiSummary = 'Partial AI opt-out: Selected AI crawlers are blocked while others have access.';
  }

  return {
    url: cleanUrl,
    origin,
    robotsTxtFound,
    robotsTxtRaw: robotsTxtRaw.slice(0, 2000),
    sitemapsInRobots: robotsRules.sitemaps,
    bots,
    aiTrainingPolicy: {
      allowsOpenAiGptBot,
      allowsAnthropicClaudeBot,
      allowsPerplexityBot,
      allowsCommonCrawl,
      allowsGoogleExtended,
      summary: aiSummary,
    },
  };
}

function parseRobotsForBot(text: string, targetBotName: string) {
  const lines = text.split('\n');
  const rules = { allow: [] as string[], disallow: [] as string[], sitemaps: [] as string[] };
  let hasSpecificRules = false;
  let isCurrentTarget = false;
  const lowerTarget = targetBotName.toLowerCase();

  for (const line of lines) {
    const clean = line.split('#')[0].trim();
    if (!clean) continue;
    const [key, ...vals] = clean.split(':');
    const val = vals.join(':').trim();

    if (key.toLowerCase() === 'user-agent') {
      const agent = val.toLowerCase();
      if (agent === lowerTarget) {
        hasSpecificRules = true;
        isCurrentTarget = true;
      } else {
        isCurrentTarget = false;
      }
    } else if (isCurrentTarget) {
      if (key.toLowerCase() === 'allow') rules.allow.push(val);
      if (key.toLowerCase() === 'disallow') rules.disallow.push(val);
    }
  }

  return { hasSpecificRules, rules };
}
