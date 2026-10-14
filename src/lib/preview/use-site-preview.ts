import { useEffect, useRef, useState, type RefObject } from 'react';
import { API_ROUTES } from '../api/routes';
import { getAuditAccessHeaders } from '../api/auth-headers';
import { inflightRead } from '../http/inflight-read';
import { safeJsonFetch } from '../http/safe-json';
import type { SitePreview } from './types';

export function useSitePreview(container: RefObject<HTMLElement>, auditId?: string, shareToken?: string, retry = 0) {
  const [preview, setPreview] = useState<SitePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setPreview(null);
    if (!auditId && !shareToken) return;
    let active = true, visible = false, inflight = false, initialized = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const startedAt = Date.now();
    let terminal = false;
    const url = shareToken ? API_ROUTES.sharedPreview(shareToken) : API_ROUTES.auditPreview(auditId!);
    const refresh = async () => {
      if (!active || !visible || document.hidden || inflight || terminal) return;
      inflight = true;
      setLoading(true);
      try {
        const headers = shareToken ? {} : await getAuditAccessHeaders();
        const method = !shareToken && !initialized ? 'POST' : 'GET';
        initialized = true;
        const response = await inflightRead(`${method}:${url}`, headers,
          signal => safeJsonFetch<{ success: boolean; data: SitePreview }>(url, { method, headers, signal }), controller.signal);
        if (!active || generation.current !== current) return;
        if (!response.success || !response.data.success || !response.data.data) {
          setPreview({ status: 'unavailable', targetUrl: '', failureCode: 'PREVIEW_REQUEST_FAILED' });
          terminal = 'status' in response && [401,403,404].includes(response.status || 0);
        } else {
          const result = response.data.data;
          setPreview(result);
          terminal = result.status !== 'queued' && result.status !== 'running';
        }
      } catch { /* A disposed consumer cannot restore stale preview state. */ }
      finally {
        inflight = false;
        if (active) setLoading(false);
        if (active && !terminal && !document.hidden && visible && Date.now()-startedAt < 120000) timer = setTimeout(refresh, 5000);
      }
    };
    const resume = () => { clearTimeout(timer); if (active && !document.hidden) void refresh(); };
    const observer = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      clearTimeout(timer);
      if (visible) void refresh();
    }, { rootMargin: '200px' }) : undefined;
    if (observer && container.current) observer.observe(container.current);
    else { visible = true; void refresh(); }
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      active = false; controller.abort(); clearTimeout(timer); observer?.disconnect();
      document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume);
    };
  }, [auditId, shareToken, retry, container]);
  return { preview, loading };
}
