import { useCallback, useEffect, useState } from 'react';

export function useUrlFilter(key: string, defaultValue = '') {
  const read = () => new URLSearchParams(window.location.search).get(key) ?? defaultValue;
  const [value, setValue] = useState(read);
  useEffect(() => {
    const restore = () => setValue(read());
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [key, defaultValue]);
  const update = useCallback((next: string) => {
    setValue(next);
    const url = new URL(window.location.href);
    if (!next || next === defaultValue) url.searchParams.delete(key);
    else url.searchParams.set(key, next);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [key, defaultValue]);
  return [value, update] as const;
}
