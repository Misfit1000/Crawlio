import { createHash, timingSafeEqual } from 'node:crypto';

export function schedulerSecretMatches(supplied: string, expected: string | undefined) {
  if (!expected || expected.length < 24 || supplied.length < 24) return false;
  return timingSafeEqual(createHash('sha256').update(expected).digest(), createHash('sha256').update(supplied).digest());
}

export function authorizeScheduler(supplied: string, scope: 'cron' | 'dispatch', env: NodeJS.ProcessEnv = process.env) {
  return schedulerSecretMatches(supplied, scope === 'cron' ? env.CRON_SECRET : env.BLOG_DISPATCH_SECRET);
}
