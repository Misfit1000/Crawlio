export const ADMIN_SORT_FIELDS = {
  users: { created_at: 'Created', email: 'Email', plan: 'Plan', role: 'Role', audit_quota_used_daily: 'Daily quota used', audit_quota_used_monthly: 'Monthly quota used' },
  audits: { created_at: 'Created', updated_at: 'Updated', status: 'Status', queue_priority: 'Queue priority', effective_mode: 'Audit mode', plan: 'Plan' },
} as const;
export function allowedSort(kind: keyof typeof ADMIN_SORT_FIELDS, value: string) { return Object.hasOwn(ADMIN_SORT_FIELDS[kind], value) ? value : 'created_at'; }
export function AdminSort({ kind, sort, direction, onSort, onDirection }: { kind: keyof typeof ADMIN_SORT_FIELDS; sort: string; direction: string; onSort: (value: string) => void; onDirection: (value: string) => void }) {
  return <div className="mb-4 flex flex-wrap gap-3"><label className="flex items-center gap-2 text-sm">Sort<select className="suite-input min-h-11 w-auto" value={allowedSort(kind, sort)} onChange={event => onSort(event.target.value)}>{Object.entries(ADMIN_SORT_FIELDS[kind]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="flex items-center gap-2 text-sm">Order<select className="suite-input min-h-11 w-auto" value={direction === 'asc' ? 'asc' : 'desc'} onChange={event => onDirection(event.target.value)}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label></div>;
}
