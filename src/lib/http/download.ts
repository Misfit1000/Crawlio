import { getAuditStartHeaders } from '../api/auth-headers';
import { API_ROUTES } from '../api/routes';

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

export async function downloadAuditExport(auditId: string, format: 'pdf' | 'json' | 'issues.csv' | 'pages.csv', options: { signal?: AbortSignal } = {}) {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);
  let waiting = false;
  const response = await waitForAuditExport(async () => {
    const headers = await getAuditStartHeaders();
    const downloadUrl = API_ROUTES.auditExport(auditId, format);
    if (waiting) {
      const status = await fetch(downloadUrl.replace('/audit/export/', '/audit/export-status/'), { headers, signal });
      if (status.status !== 200) return status;
    }
    const result = await fetch(downloadUrl, { headers, signal });
    waiting = result.status === 202;
    return result;
  }, { signal, isActive: () => document.visibilityState !== 'hidden' });

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    let message = `Export failed with status ${response.status}.`;
    if (contentType.includes('application/json')) {
      const body = await response.json().catch(() => null);
      message = body?.error || message;
    } else {
      const body = await response.text().catch(() => '');
      if (body.trim()) message = body.slice(0, 180);
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const extension = format.includes('.') ? format.split('.').pop() : format;
  const filename = filenameFromDisposition(response.headers.get('content-disposition'), `crawlio-audit.${extension}`);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
