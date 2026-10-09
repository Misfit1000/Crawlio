import { useCallback, useEffect, useState } from 'react';
import { useLocation } from '../../app/router';

export function useAdminFilter(key: string, fallback = '') {
  const location = useLocation();
  const read = () => new URLSearchParams(window.location.search).get(key) ?? fallback;
  const [value, setValue] = useState(read);
  useEffect(() => { setValue(read()); }, [location.pathname, location.search, key, fallback]);
  const update = useCallback((next: string) => {
    const url = new URL(window.location.href);
    if (!next || next === fallback) url.searchParams.delete(key); else url.searchParams.set(key, next);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    setValue(next);
  }, [key, fallback]);
  return [value, update] as const;
}
