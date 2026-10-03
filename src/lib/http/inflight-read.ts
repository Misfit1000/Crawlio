interface PendingRead {
  controller: AbortController;
  promise: Promise<unknown>;
  consumers: Set<() => void>;
  settled: boolean;
}

const pending = new Map<string, PendingRead>();
const activeReads = new Set<PendingRead>();

function aborted() { return new DOMException('The request was cancelled.', 'AbortError'); }

/** Share concurrent work, not responses. Each consumer owns its cancellation. */
export function inflightRead<T>(url: string, headers: Record<string, string>, read: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(aborted());
  const key = JSON.stringify([url, Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))]);
  let entry = pending.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, promise: Promise.resolve(), consumers: new Set(), settled: false };
    const current = entry;
    activeReads.add(current);
    current.promise = Promise.resolve().then(() => read(controller.signal)).finally(() => {
      current.settled = true;
      activeReads.delete(current);
      if (pending.get(key) === current) pending.delete(key);
    });
    if (pending.size < 64) pending.set(key, current);
  }
  const current = entry;
  return new Promise<T>((resolve, reject) => {
    let active = true;
    const release = () => {
      active = false;
      signal?.removeEventListener('abort', cancel);
      current.consumers.delete(cancel);
      if (!current.settled && !current.consumers.size) {
        if (pending.get(key) === current) pending.delete(key);
        current.controller.abort();
      }
    };
    const cancel = () => { if (active) { release(); reject(aborted()); } };
    current.consumers.add(cancel);
    signal?.addEventListener('abort', cancel, { once: true });
    current.promise.then(value => {
      if (active) { release(); resolve(value as T); }
    }, error => {
      if (active) { release(); reject(error); }
    });
  });
}

export function clearInflightReads() {
  for (const entry of activeReads) {
    for (const cancel of [...entry.consumers]) cancel();
    entry.controller.abort();
  }
  pending.clear();
  activeReads.clear();
}
