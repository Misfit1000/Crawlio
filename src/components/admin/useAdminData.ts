import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { useAdminRefresh } from './AdminRefresh';

export function useAdminData<T>(loader: (signal: AbortSignal) => Promise<T>, deps: DependencyList = [], options: { enabled?: boolean; autoRefresh?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const lastStarted = useRef(0);
  const updatedAtRef = useRef<string | null>(null);
  const enabled = options.enabled !== false;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const { tick, automaticTick, resumeTick, seconds } = useAdminRefresh();
  const previousTicks = useRef({ tick, automaticTick, resumeTick });
  const refresh = useCallback(async () => {
    if (!mounted.current || !enabledRef.current || controller.current || document.visibilityState !== 'visible') return;
    const current = new AbortController();
    controller.current = current;
    lastStarted.current = Date.now();
    setLoading(true);
    try {
      const next = await loaderRef.current(current.signal);
      if (!mounted.current || current.signal.aborted) return;
      const observedAt = new Date().toISOString();
      updatedAtRef.current = observedAt;
      setData(next); setError(null); setUpdatedAt(observedAt);
    } catch (nextError) {
      if (mounted.current && !current.signal.aborted) setError(nextError instanceof Error ? nextError.message : 'Admin data could not be loaded.');
    } finally {
      if (controller.current === current) { controller.current = null; if (mounted.current) setLoading(false); }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    updatedAtRef.current = null;
    setData(null); setError(null); setUpdatedAt(null); setLoading(enabled);
    void refresh();
    return () => { mounted.current = false; controller.current?.abort(); controller.current = null; };
  }, [...deps, enabled, refresh]);
  useEffect(() => {
    const changed = () => {
      if (document.visibilityState !== 'visible') { controller.current?.abort(); controller.current = null; setLoading(false); }
    };
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(() => {
    const previous = previousTicks.current;
    previousTicks.current = { tick, automaticTick, resumeTick };
    if (tick !== previous.tick) { void refresh(); return; }
    const automatic = automaticTick !== previous.automaticTick && seconds > 0 && options.autoRefresh !== false;
    const resumed = resumeTick !== previous.resumeTick && !updatedAtRef.current;
    if (resumed || automatic && Date.now() - lastStarted.current >= 1000) void refresh();
  }, [tick, automaticTick, resumeTick, seconds, refresh, options.autoRefresh]);
  return { data, error, loading, refresh, updatedAt, stale: Boolean(data && error) };
}
