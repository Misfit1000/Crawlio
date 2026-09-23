import { useEffect,useRef,useState,type DependencyList } from 'react';

export function useAdminData<T>(loader: () => Promise<T>, deps: DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const refresh = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const request = ++generation.current;
    setLoading(true);
    void loader().then((next) => {
      if (request !== generation.current) return;
      setData(next);
      setError(null);
    }).catch((nextError: unknown) => {
      if (request === generation.current) setError(nextError instanceof Error ? nextError.message : 'Admin data could not be loaded.');
    }).finally(() => {
      if (request === generation.current) { inFlight.current = false; setLoading(false); }
    });
  };
  useEffect(() => {
    refresh();
    return () => { generation.current += 1; inFlight.current = false; };
  }, deps);
  return { data, error, loading, refresh };
}
