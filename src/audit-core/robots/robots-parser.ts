export interface RobotsRules {
  allow: string[];
  disallow: string[];
  sitemaps: string[];
}

export function parseRobotsTxt(text: string): RobotsRules {
  const rules: RobotsRules = { allow: [], disallow: [], sitemaps: [] };
  const lines = text.split('\n');
  let currentUserAgentMatch = false;

  for (const line of lines) {
    const clean = line.split('#')[0].trim();
    if (!clean) continue;
    const [key, ...vals] = clean.split(':');
    const val = vals.join(':').trim();

    if (key.toLowerCase() === 'user-agent') {
      const normalizedAgent = val.toLowerCase();
      currentUserAgentMatch =
        val === '*' || normalizedAgent.includes('crawliobot') || normalizedAgent.includes('seointelbot');
    } else if (key.toLowerCase() === 'sitemap') {
      rules.sitemaps.push(val);
    } else if (currentUserAgentMatch) {
      if (key.toLowerCase() === 'allow') rules.allow.push(val);
      if (key.toLowerCase() === 'disallow') rules.disallow.push(val);
    }
  }
  return rules;
}

export function getSitemapUrlsFromRobots(text: string): string[] {
  return parseRobotsTxt(text).sitemaps;
}

export function isBlockedByRobots(url: string, rules: RobotsRules): boolean {
  try {
    const pathname = new URL(url).pathname;

    for (const rule of rules.allow) {
      if (rule === '' || rule === '/') continue;
      if (pathname.startsWith(rule)) return false;
    }

    for (const rule of rules.disallow) {
      if (rule === '') continue;
      if (pathname.startsWith(rule)) return true;
    }
  } catch {}
  return false;
}
