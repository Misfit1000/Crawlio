const ADMIN_READ_CACHE_MAX_ENTRIES = 32;

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

type PendingRead = {
  generation: number;
  promise: Promise<unknown>;
};

export type AdminReadCacheStatus = 'hit' | 'miss' | 'shared';

const entries = new Map<string, CacheEntry>();
const pendingReads = new Map<string, PendingRead>();
let cacheGeneration = 0;

function pruneExpired(now: number) {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
  while (entries.size >= ADMIN_READ_CACHE_MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (!oldest) break;
    entries.delete(oldest);
  }
}

export async function readCachedAdminData<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  now = Date.now(),
): Promise<{ value: T; status: AdminReadCacheStatus }> {
  const cached = entries.get(key);
  if (cached && cached.expiresAt > now) {
    return { value: cached.value as T, status: 'hit' };
  }

  const pending = pendingReads.get(key);
  if (pending && pending.generation === cacheGeneration) {
    return { value: await pending.promise as T, status: 'shared' };
  }

  const loadGeneration = cacheGeneration;
  const load = loader();
  pendingReads.set(key, { generation: loadGeneration, promise: load });
  try {
    const value = await load;
    if (loadGeneration === cacheGeneration) {
      pruneExpired(now);
      entries.set(key, { value, expiresAt: now + Math.max(1, ttlMs) });
    }
    return { value, status: 'miss' };
  } finally {
    if (pendingReads.get(key)?.promise === load) pendingReads.delete(key);
  }
}

export function invalidateAdminReadCache(...prefixes: string[]) {
  cacheGeneration += 1;
  if (!prefixes.length) {
    entries.clear();
    return;
  }
  for (const key of entries.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) entries.delete(key);
  }
  for (const key of pendingReads.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) pendingReads.delete(key);
  }
}

export function resetAdminReadCacheForTests() {
  cacheGeneration = 0;
  entries.clear();
  pendingReads.clear();
}
