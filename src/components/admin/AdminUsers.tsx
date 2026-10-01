import { Loader2, Search, Users } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ActionResult, AdminRecord, UserDetail } from '../../lib/admin/types';
import { Notice } from '../ui/page-system';
import { useAdminActionReason } from './AdminActionDialog';
import { Pagination } from './Pagination';
import { useAdminList } from './useAdminList';
import { UserDetailDrawer } from './AdminDetails';
import { Empty, Loading, Panel, Select } from './shared';
import { ActionFeedback, DataNotice } from './operations-shared';
import { adminGet, adminPost, adminRecord } from './client';
import { AdminSort, allowedSort } from './AdminSort';
import { useAdminFilter } from './useAdminFilter';

export default function AdminUsers({ adminUserId }: { adminUserId: string }) {
  const requestReason = useAdminActionReason();
  const [search, setSearch] = useAdminFilter('search');
  const [plan, setPlan] = useAdminFilter('plan', 'all');
  const [role, setRole] = useAdminFilter('role', 'all');
  const [sort, setSort] = useAdminFilter('sort', 'created_at');
  const [direction, setDirection] = useAdminFilter('direction', 'desc');
  const [selectedId, setSelectedId] = useAdminFilter('userId');
  const users = useAdminList('users', { search, plan, role, sort: allowedSort('users', sort), direction: direction === 'asc' ? 'asc' : 'desc' });
  const busy = useRef(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ActionResult | null>(null);
  const update = async (item: AdminRecord, patch: Record<string, unknown>, label: string) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const reset = patch.resetQuotas === true;
      const reason = await requestReason(`${label} for ${item.email || item.id}`, {
        changes: reset ? [{ label: 'Daily quota used', before: item.auditQuotaUsedDaily, after: 0 }, { label: 'Monthly quota used', before: item.auditQuotaUsedMonthly, after: 0 }] : Object.entries(patch).map(([key, value]) => ({ label: key.replace(/_/g, ' '), before: item[key === 'subscription_status' ? 'subscriptionStatus' : key], after: value })),
        warning: 'Role and suspension controls remain separate from plan entitlements. Server administrator protections still apply.',
      });
      if (!reason) return;
      setPendingId(item.id); setError(''); setResult(null);
      const response = await adminPost<ActionResult>(`users/${encodeURIComponent(item.id)}/${reset ? 'reset-quota' : 'update'}`, reset ? { reason } : { patch, reason });
      setResult(response);
      if (!response.confirmedState) {
        try {
          const detail = await adminGet<UserDetail>(`users/${encodeURIComponent(item.id)}/detail`, new AbortController().signal);
          const profile = adminRecord(detail.profile);
          const matches = reset ? detail.usage.dailyUsed === 0 && detail.usage.monthlyUsed === 0 : Object.entries(patch).every(([key, value]) => profile[key === 'subscription_status' ? 'subscriptionStatus' : key] === value);
          setResult({ ...response, outcome: response.outcome || (matches ? 'verified' : 'verification mismatch'), ...(matches ? { confirmedState: reset ? detail.usage : profile } : {}) });
        } catch { setResult({ ...response, outcome: response.outcome || 'accepted; fresh verification unavailable' }); }
      }
      await users.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Account update failed.'); }
    finally { setPendingId(null); busy.current = false; }
  };
  const controls = (item: AdminRecord) => <div className="flex flex-wrap items-end gap-3">
    <label className="text-xs text-muted-foreground">Role<Select label={`Role for ${item.email || item.id}`} value={item.role || 'user'} options={['user', 'support', 'admin']} disabled={Boolean(pendingId) || item.id === adminUserId} onChange={value => update(item, { role: value }, 'changing role')} /></label>
    <label className="text-xs text-muted-foreground">Plan preset<Select label={`Plan preset for ${item.email || item.id}`} value={item.plan || 'free'} options={['free', 'paid', 'agency', 'admin']} disabled={Boolean(pendingId)} onChange={value => update(item, { plan: value, subscription_status: value === 'free' ? 'inactive' : 'active' }, `applying ${value} plan preset`)} /></label>
    <label className="text-xs text-muted-foreground">Subscription<Select label={`Subscription for ${item.email || item.id}`} value={item.subscriptionStatus || 'inactive'} options={['inactive', 'trialing', 'active', 'past_due', 'cancelled']} disabled={Boolean(pendingId)} onChange={value => update(item, { subscription_status: value }, 'changing subscription')} /></label>
    <button type="button" disabled={Boolean(pendingId)} onClick={() => update(item, { resetQuotas: true }, 'resetting quota')} className="quiet-button min-h-11 text-xs">Reset quota</button>
    <button type="button" disabled={Boolean(pendingId) || item.id === adminUserId} onClick={() => update(item, { disabled: !item.disabled }, item.disabled ? 'restoring access' : 'suspending access')} className="quiet-button min-h-11 text-xs">{item.disabled ? 'Restore access' : 'Suspend access'}</button>
  </div>;
  const identity = (item: AdminRecord) => <><button type="button" onClick={() => setSelectedId(item.id)} className="min-h-11 break-all text-left font-semibold text-accent hover:underline">{item.displayName || item.fullName || item.email || 'Unnamed account'}</button>{item.id === adminUserId && <span className="ml-2 text-xs">You</span>}<div className="break-all text-xs text-muted-foreground">{item.email || item.id}</div>{item.disabled && <div className="mt-1 text-xs font-semibold text-red-700 dark:text-red-300">Suspended</div>}</>;
  return <Panel title="User management" description="Accounts, access, entitlements, and quota usage." icon={Users} action={<span className="suite-chip">{users.rows.length} shown</span>}>
    <DataNotice {...users} />
    {pendingId && <Notice tone="info" className="mb-4"><span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Account change pending server confirmation.</span></Notice>}
    {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
    {result && <div className="mb-4"><ActionFeedback result={result} /></div>}
    <div className="mb-4 grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
      <label className="relative block"><span className="sr-only">Search users</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search email" className="suite-input min-h-11 pl-9" /></label>
      <select aria-label="Filter by role" value={role} onChange={event => setRole(event.target.value)} className="suite-input min-h-11"><option value="all">All roles</option>{['user', 'support', 'admin'].map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="Filter by plan" value={plan} onChange={event => setPlan(event.target.value)} className="suite-input min-h-11"><option value="all">All plans</option>{['free', 'paid', 'agency', 'admin'].map(value => <option key={value}>{value}</option>)}</select>
    </div>
    <AdminSort kind="users" sort={sort} direction={direction} onSort={setSort} onDirection={setDirection} />
    <Pagination page={users.page} hasMore={users.hasMore} loading={users.loading} onChange={users.setPage} />
    {users.loading && !users.data ? <Loading /> : <>
      <div className="space-y-4 md:hidden">{users.rows.map(item => <article key={item.id} className="min-w-0 rounded-lg border border-border p-3"><div className="mb-3">{identity(item)}</div><p className="mb-3 text-xs text-muted-foreground">Quota used: {item.auditQuotaUsedDaily ?? 0} daily / {item.auditQuotaUsedMonthly ?? 0} monthly</p>{controls(item)}</article>)}</div>
      <div className="hidden max-w-full overflow-x-auto rounded-lg border border-border md:block"><table className="suite-table min-w-[900px]"><caption className="sr-only">Accounts and guarded access controls, server ordered</caption><thead><tr>{['Account', 'Quota use', 'Access and entitlements'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{users.rows.map(item => <tr key={item.id}><td className="max-w-64">{identity(item)}</td><td><div>{item.auditQuotaUsedDaily ?? 0} daily</div><div className="text-xs text-muted-foreground">{item.auditQuotaUsedMonthly ?? 0} monthly</div></td><td>{controls(item)}</td></tr>)}</tbody></table></div>
      {!users.rows.length && <Empty text="No accounts match these filters." />}
    </>}
    {selectedId && <UserDetailDrawer key={selectedId} id={selectedId} onClose={() => setSelectedId('')} />}
  </Panel>;
}
