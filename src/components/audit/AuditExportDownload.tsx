import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { downloadAuditExport, type AuditExportDownloadState, type AuditExportFormat } from '../../lib/http/download';
import { Notice } from '../ui/page-system';

export function useAuditExportDownload(auditId: string | null) {
  const [state, setState] = useState<AuditExportDownloadState | null>(null);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    setState(null);
    pending.current = false;
    return () => { controller.current?.abort(); controller.current = null; };
  }, [auditId]);
  const start = useCallback(async (format: AuditExportFormat) => {
    if (!auditId || pending.current) return;
    pending.current = true;
    const current = new AbortController();
    controller.current = current;
    try {
      await downloadAuditExport(auditId, format, { signal: current.signal, onState: next => {
        if (controller.current === current && !current.signal.aborted) setState(next);
      } });
    } catch { /* The download state keeps the actionable failure visible. */ }
    finally { if (controller.current === current) pending.current = false; }
  }, [auditId]);
  const busy = state?.phase === 'preparing' || state?.phase === 'queued';
  return { state, busy, start, retry: () => { if (state) void start(state.format); } };
}

export function AuditExportDownloadNotice({ download }: { download: ReturnType<typeof useAuditExportDownload> }) {
  if (!download.state) return null;
  const failed = download.state.phase === 'failed';
  return <Notice tone={failed ? 'danger' : download.busy ? 'info' : 'success'}>
    <div role={failed ? 'alert' : 'status'} aria-live="polite" className="flex flex-wrap items-center gap-3">
      {download.busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : !failed && <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 flex-1 break-words">{download.state.message}</span>
      {failed && <button type="button" className="quiet-button min-h-9 px-3 py-1 text-xs" onClick={download.retry}><RefreshCw className="h-4 w-4" />Try again</button>}
    </div>
  </Notice>;
}
