import './server-only';

export const PROVIDER_TIMEOUT_MS = 6_000;
export const MAX_RANK_RESPONSE_BYTES = 256 * 1024;

export async function boundedResponseText(response: Response, maximumBytes: number) {
  if (Number(response.headers.get('content-length') || 0) > maximumBytes) {
    await response.body?.cancel();
    throw new Error('Provider response was too large.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error('Provider response was too large.');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function fetchProviderJson(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init, signal: controller.signal, redirect: 'error',
      headers: { Accept: 'application/json', ...init.headers },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Domain evidence provider returned HTTP ${response.status}.`);
    }
    if (!String(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
      await response.body?.cancel();
      throw new Error('Provider returned an unexpected content type.');
    }
    return JSON.parse(await boundedResponseText(response, MAX_RANK_RESPONSE_BYTES)) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}
