import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from '../../app/router';
import type { AdminRecord, AdminSearchResults } from '../../lib/admin/types';
import { adminGet, adminRecord } from './client';
import { useAdminData } from './useAdminData';
import { DataNotice, Evidence, HealthBadge } from './operations-shared';
import { DetailDrawer } from './DetailDrawer';

export default function AdminSearch() {
  const [query, setQuery] = useState('');
  const [settled, setSettled] = useState('');
  const [open, setOpen] = useState(false);
  const [schedule, setSchedule] = useState<AdminRecord | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const location = useLocation();
  useEffect(() => { const timer = window.setTimeout(() => setSettled(query.trim()), 350); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => { setOpen(false); setSchedule(null); }, [location.pathname, location.search]);
  const valid = settled.length >= 2 && settled.length <= 120 && !/[\x00-\x1f*]/.test(settled);
  const results = useAdminData(signal => adminGet<AdminSearchResults>(`search?query=${encodeURIComponent(settled)}&limit=5`, signal), [settled], { enabled: valid && open, autoRefresh: false });
  const groups = results.data && Object.entries(results.data) as Array<[keyof AdminSearchResults, AdminRecord[]]>;
  return <div className="relative min-w-0 flex-1" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); input.current?.focus(); } }}>
    <label className="relative block"><span className="sr-only">Search accounts, audits, and schedules</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input ref={input} type="search" maxLength={120} value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); }} aria-controls={open && query.trim().length >= 2 ? 'admin-search-results' : undefined} placeholder="Search accounts, audits, schedules" className="suite-input min-h-11 pl-9" /></label>
    {open && query.trim().length >= 2 && <section id="admin-search-results" aria-label="Admin search results" className="absolute inset-x-0 top-full z-20 mt-2 max-h-[65dvh] overflow-y-auto rounded-lg border border-border bg-card p-4 shadow-lg">
      <div className="mb-2 flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Search results</h2><button type="button" onClick={() => { setOpen(false); input.current?.focus(); }} className="quiet-button min-h-11 min-w-11" aria-label="Close search results" title="Close search results"><X className="h-4 w-4" /></button></div>
      <DataNotice {...results} />
      {(!valid || query.trim() !== settled || results.loading && !results.data) && <p role="status" className="text-sm text-muted-foreground">{query.trim() !== settled || valid ? 'Searching...' : 'Use 2 to 120 plain characters.'}</p>}
      {query.trim() === settled && groups?.map(([kind, rows]) => <div key={kind} className="border-t border-border py-3"><h3 className="text-xs font-semibold capitalize text-muted-foreground">{kind}</h3>{rows.slice(0, 5).length ? <ul className="mt-1 space-y-1">{rows.slice(0, 5).map(raw => { const row = adminRecord(raw); const label = row.email || row.hostname || row.name || row.id; return <li key={row.id} className="min-w-0">{kind === 'schedules' ? <button type="button" className="min-h-11 w-full break-all rounded px-2 text-left text-sm hover:bg-muted" onClick={() => { setSchedule(row); setOpen(false); }}>{label}</button> : <Link onClick={() => setOpen(false)} className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded px-2 text-sm hover:bg-muted" to={kind === 'users' ? `/admin/users?userId=${encodeURIComponent(row.id)}` : `/admin/audits?auditId=${encodeURIComponent(row.id)}`}><span className="min-w-0 break-all">{label}</span>{row.status && <HealthBadge status={row.status} />}</Link>}</li>; })}</ul> : <p className="mt-2 text-sm text-muted-foreground">No {kind} found.</p>}</div>)}
    </section>}
    {schedule && <DetailDrawer title="Scheduled project" onClose={() => setSchedule(null)}><Evidence value={schedule} label="Schedule evidence" />{schedule.userId && <div className="flex flex-wrap gap-2"><Link className="quiet-button min-h-11" to={`/admin/users?userId=${encodeURIComponent(schedule.userId)}`}>Account details</Link><Link className="quiet-button min-h-11" to={`/admin/audits?userId=${encodeURIComponent(schedule.userId)}`}>Account audits</Link></div>}</DetailDrawer>}
  </div>;
}
