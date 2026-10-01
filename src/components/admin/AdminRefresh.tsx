import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

const Context = createContext({ seconds: 30, tick: 0, refreshAll: () => {} });
export const useAdminRefresh = () => useContext(Context);
export function AdminRefreshProvider({ children, controls = true }: { children: ReactNode; controls?: boolean }) {
  const [seconds, setSeconds] = useState(30);
  const [tick, setTick] = useState(0);
  const refreshAll = useCallback(() => setTick(value => value + 1), []);
  useEffect(() => {
    if (!seconds || !controls) return;
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== 'visible') return;
      timer = window.setTimeout(() => { refreshAll(); schedule(); }, seconds * 1000);
    };
    const visible = () => { if (document.visibilityState === 'visible') refreshAll(); schedule(); };
    schedule();
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [seconds, controls, refreshAll]);
  return <Context.Provider value={{ seconds, tick, refreshAll }}>
    {controls && <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
      <label className="flex items-center gap-2 text-muted-foreground">Auto-refresh<select aria-label="Admin auto-refresh interval" value={seconds} onChange={event => setSeconds(Number(event.target.value))} className="suite-input min-h-11 w-auto"><option value={0}>Off</option><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>60 seconds</option></select></label>
      <button type="button" className="quiet-button min-h-11 min-w-11" aria-label="Refresh current admin section" title="Refresh current admin section" onClick={refreshAll}><RefreshCw className="h-4 w-4" /></button>
    </div>}
    {children}
  </Context.Provider>;
}
