const pending = new Map<string, Promise<unknown>>();

/** Share only concurrent reads. Responses and identity keys are discarded on settlement. */
export function inflightRead<T>(url: string, headers: Record<string, string>, read: () => Promise<T>): Promise<T> {
  const key = JSON.stringify([url, Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))]);
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  if (pending.size >= 64) return read();
  const result = read().finally(() => { if (pending.get(key) === result) pending.delete(key); });
  pending.set(key, result);
  return result;
}
