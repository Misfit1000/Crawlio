import { getAuditStartHeaders } from '../api/auth-headers';
import { API_ROUTES } from '../api/routes';
import { inflightRead } from './inflight-read';

export type AuditExportFormat = 'pdf' | 'json' | 'issues.csv' | 'pages.csv' | 'sitemap.xml';
export type AuditExportDownloadState = { format: AuditExportFormat; phase: 'preparing' | 'queued' | 'ready' | 'failed'; message: string };

function filenameFromDisposition(value: string | null, fallback: string) {
  const match = value?.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

export async function waitForAuditExport(
  request: () => Promise<Response>,
  options: {
    signal?: AbortSignal;
    maxAttempts?: number;
    isActive?: () => boolean;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  const attempts = Math.min(60, Math.max(1, options.maxAttempts || 60));
  const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(options.signal?.reason || new Error('Export download cancelled.')); };
    const timer = setTimeout(() => { options.signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    options.signal?.addEventListener('abort', cancel, { once: true });
  }));
  for (let attempt = 0; attempt < attempts; attempt++) {
    options.signal?.throwIfAborted();
    if (options.isActive && !options.isActive()) throw new Error('Export download paused. Request it again to resume.');
    const response = await request();
    if (response.status !== 202) return response;
    const body = await response.json().catch(() => null);
    if (!['queued', 'running'].includes(body?.data?.state)) {
      throw new Error(body?.error || 'Export is not available.');
    }
    if (attempt + 1 < attempts) {
      const seconds = Number(response.headers.get('retry-after') || 2);
      await sleep(Math.min(5000, Math.max(1000, Number.isFinite(seconds) ? seconds * 1000 : 2000)));
    }
  }
  throw new Error('Export is still being prepared. Request it again shortly to resume.');
}

function saveDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

interface DownloadDependencies {
  headers: () => Promise<Record<string, string>>;
  request: (url: string, options: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;
  save: (blob: Blob, filename: string) => void;
  isActive: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

/** Share preparation and the browser download once, scoped by exact session headers. No completed payload is cached. */
export function createAuditExportDownloader(dependencies: DownloadDependencies) {
  const listeners = new Map<string, { state: AuditExportDownloadState; callbacks: Set<(state: AuditExportDownloadState) => void> }>();
  return async (auditId: string, format: AuditExportFormat, options: {
    signal?: AbortSignal; onState?: (state: AuditExportDownloadState) => void;
  } = {}) => {
    options.signal?.throwIfAborted();
    options.onState?.({ format, phase: 'preparing', message: 'Preparing export...' });
    try {
      const headers = await dependencies.headers();
      options.signal?.throwIfAborted();
      const downloadUrl = API_ROUTES.auditExport(auditId, format);
      const key = JSON.stringify([downloadUrl, Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))]);
      let entry = listeners.get(key);
      if (!entry) {
        entry = { state: { format, phase: 'preparing', message: 'Preparing export...' }, callbacks: new Set() };
        listeners.set(key, entry);
      }
      if (options.onState) { entry.callbacks.add(options.onState); options.onState(entry.state); }
      const current = entry;
      const update = (phase: AuditExportDownloadState['phase'], message: string) => {
        if (current.state.phase === phase && current.state.message === message) return;
        current.state = { format, phase, message };
        for (const callback of current.callbacks) callback(current.state);
      };
      try {
        await inflightRead(downloadUrl, headers, async sharedSignal => {
          const signal = AbortSignal.any([sharedSignal, AbortSignal.timeout(120_000)]);
          try {
            let waiting = false;
            const response = await waitForAuditExport(async () => {
              if (waiting) {
                const status = await dependencies.request(downloadUrl.replace('/audit/export/', '/audit/export-status/'), { headers, signal });
                if (status.status !== 200) return status;
              }
              const result = await dependencies.request(waiting ? `${downloadUrl}?prepared=1` : downloadUrl, { headers, signal });
              waiting = result.status === 202;
              if (waiting) update('queued', 'Preparing export in the background...');
              return result;
            }, { signal, isActive: dependencies.isActive, sleep: dependencies.sleep });
            if (!response.ok) {
              let message = `Export failed with status ${response.status}.`;
              if ((response.headers.get('content-type') || '').includes('application/json')) {
                const body = await response.json().catch(() => null);
                if (typeof body?.error === 'string') message = body.error;
              } else {
                const body = await response.text().catch(() => '');
                if (body.trim()) message = body.slice(0, 180);
              }
              throw new Error(message);
            }
            const blob = await response.blob();
            signal.throwIfAborted();
            const extension = format.includes('.') ? format.split('.').pop() : format;
            const filename = filenameFromDisposition(response.headers.get('content-disposition'), `crawlio-audit.${extension}`);
            dependencies.save(blob, filename);
            update('ready', 'Export ready. Download started.');
          } catch (error) {
            update('failed', error instanceof Error ? error.message : 'The export could not be downloaded.');
            throw error;
          }
        }, options.signal);
      } finally {
        if (options.onState) current.callbacks.delete(options.onState);
        if (!current.callbacks.size && listeners.get(key) === current) listeners.delete(key);
      }
    } catch (error) {
      options.onState?.({ format, phase: 'failed', message: error instanceof Error ? error.message : 'The export could not be downloaded.' });
      throw error;
    }
  };
}

export const downloadAuditExport = createAuditExportDownloader({
  headers: getAuditStartHeaders, request: (url, options) => fetch(url, options), save: saveDownload,
  isActive: () => document.visibilityState !== 'hidden',
});
