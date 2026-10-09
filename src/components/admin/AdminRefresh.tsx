import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

const Context = createContext({ seconds: 0, tick: 0, automaticTick: 0, resumeTick: 0, refreshAll: () => {} });
export const useAdminRefresh = () => useContext(Context);
export function AdminRefreshProvider({ children, controls = true, polling = true, toolbar }: { children: ReactNode; controls?: boolean; polling?: boolean; toolbar?: ReactNode }) {
  const [intervalSeconds, setSeconds] = useState(30);
  const seconds = controls && polling ? intervalSeconds : 0;
  const [tick, setTick] = useState(0);
  const [automaticTick, setAutomaticTick] = useState(0);
  const [resumeTick, setResumeTick] = useState(0);
  const lastAutomatic = useRef(0);
  const lastResume = useRef(0);
  const wasHidden = useRef(false);
  const refreshAll = useCallback(() => setTick(value => value + 1), []);
  useEffect(() => {
    let timer: number | undefined;
    const refreshAutomatic = () => {
      const now = Date.now();
      if (now - lastAutomatic.current < 1000) return;
      lastAutomatic.current = now;
      setAutomaticTick(value => value + 1);
    };
    const schedule = () => {
      window.clearTimeout(timer);
      if (!seconds || document.visibilityState !== 'visible') return;
      timer = window.setTimeout(() => { refreshAutomatic(); schedule(); }, seconds * 1000);
    };
    const resume = () => {
      if (document.visibilityState !== 'visible') { wasHidden.current = true; schedule(); return; }
      const now = Date.now();
      if (wasHidden.current || now - lastResume.current >= 1000) {
        wasHidden.current = false;
        lastResume.current = now;
        setResumeTick(value => value + 1);
        if (seconds) refreshAutomatic();
      }
      schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('focus', resume); };
  }, [seconds]);
  return <Context.Provider value={{ seconds, tick, automaticTick, resumeTick, refreshAll }}>
    {controls && <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm">
      {toolbar && <div className="min-w-0 max-w-xl flex-[1_1_16rem]">{toolbar}</div>}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
      {polling && <label className="flex items-center gap-2 whitespace-nowrap text-muted-foreground">Auto-refresh<select aria-label="Admin auto-refresh interval" value={intervalSeconds} onChange={event => setSeconds(Number(event.target.value))} className="suite-input min-h-11 w-auto"><option value={0}>Off</option><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>60 seconds</option></select></label>}
      <button type="button" className="quiet-button min-h-11 min-w-11" aria-label="Refresh current admin section" title="Refresh current admin section" onClick={refreshAll}><RefreshCw className="h-4 w-4" /></button>
      </div>
    </div>}
    {children}
  </Context.Provider>;
}
