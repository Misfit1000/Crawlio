import { canonicalSiteOrigin } from './sitemap';

export function indexNowKey() {
  const key = String(process.env.INDEXNOW_KEY || '').trim();
  return /^[A-Za-z0-9-]{32,128}$/.test(key) ? key : '';
}

export async function notifyIndexNow(paths: string[]) {
  const key = indexNowKey();
  if (!key) return { configured: false, submitted: 0 };
  const origin = canonicalSiteOrigin();
  const originUrl = new URL(origin);
  const urlList = Array.from(new Set(paths.map((path) => new URL(path, origin).href).filter((url) => new URL(url).origin === originUrl.origin))).slice(0, 20);
  if (!urlList.length) return { configured: true, submitted: 0 };
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: originUrl.host, key, keyLocation: `${origin}/indexnow-key.txt`, urlList }),
    signal: AbortSignal.timeout(8_000),
  });
  if (![200, 202].includes(response.status)) throw new Error(`IndexNow returned HTTP ${response.status}.`);
  return { configured: true, submitted: urlList.length };
}
