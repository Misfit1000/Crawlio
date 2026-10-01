import { useEffect,useState } from 'react';
import { adminList } from './client';
import { useAdminData } from './useAdminData';

export function useAdminList(kind: 'users' | 'audits', filters: Record<string, string>) {
  const [page, setPage] = useState(0);
  const encoded = JSON.stringify(filters);
  const [settled, setSettled] = useState(encoded);
  useEffect(() => {
    const timer = window.setTimeout(() => { setPage(0); setSettled(encoded); }, 350);
    return () => window.clearTimeout(timer);
  }, [encoded]);
  const state = useAdminData(signal => {
    const query = new URLSearchParams({ ...JSON.parse(settled), offset: String(page * 50), limit: '50' });
    return adminList(`${kind}?${query}`, signal);
  }, [kind, settled, page]);
  return { ...state, page, setPage, rows: state.data?.rows || [], hasMore: state.data?.hasMore || false };
}
