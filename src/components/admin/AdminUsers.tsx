import { Loader2,RefreshCw,Search,Users } from 'lucide-react';
import { useState } from 'react';
import { useUrlFilter } from '../../app/use-url-filter';
import {
updateUserAdminFields
} from '../../services/supabaseDataService';
import { Notice } from '../ui/page-system';
import { useAdminActionReason } from './AdminActionDialog';
import { Pagination } from './Pagination';
import { useAdminList } from './useAdminList';
import { DetailDrawer, DetailFields } from './DetailDrawer';


import { Empty,Loading,Panel,Select } from './shared';
export default function AdminUsers({ adminUserId }: { adminUserId: string }) {
  const requestAdminReason = useAdminActionReason();
  const [search, setSearch] = useUrlFilter('search');
  const [planFilter, setPlanFilter] = useUrlFilter('plan', 'all');
  const [roleFilter, setRoleFilter] = useUrlFilter('role', 'all');
  const users = useAdminList('users', { search, plan: planFilter, role: roleFilter });
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const rows = users.rows;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((row) => row.id === selectedId);

  const updateUser = async (id: string, patch: any) => {
    const reason = await requestAdminReason(patch.resetQuotas ? 'resetting this user quota' : 'changing this user access');
    if (!reason) return;
    setUpdatingId(id);
    setMutationError(null);
    setMessage('');
    try {
      await updateUserAdminFields(id, patch, adminUserId, reason);
      setMessage('User access updated.');
      users.refresh();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'User update failed.');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <Panel title="User management" description="Search by email and manage access, plans, and audit quotas." icon={Users} action={<span className="suite-chip">{rows.length} shown</span>}>
      <Pagination page={users.page} hasMore={users.hasMore} loading={users.loading} onChange={users.setPage} />
      {(users.error || mutationError) && <Notice tone="danger" className="mb-4">{users.error || mutationError}</Notice>}
      {message && <Notice tone="success" className="mb-4">{message}</Notice>}
      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(240px,1fr)_180px_180px]">
        <label className="relative block"><span className="sr-only">Search users</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search email" className="suite-input pl-9" /></label>
        <label><span className="sr-only">Filter by role</span><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="suite-input"><option value="all">All roles</option><option value="user">User</option><option value="support">Support</option><option value="admin">Admin</option></select></label>
        <label><span className="sr-only">Filter by plan</span><select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)} className="suite-input"><option value="all">All plans</option>{['free', 'paid', 'agency', 'admin'].map((plan) => <option key={plan} value={plan}>{plan}</option>)}</select></label>
      </div>
      {users.loading ? <Loading /> : (
        <div className="max-w-full overflow-x-auto rounded-lg border border-border">
          <table className="suite-table min-w-[900px]">
            <thead>
              <tr><th>User</th><th>Role</th><th>Plan</th><th>Subscription</th><th>Quota use</th><th>Action</th></tr>
            </thead>
            <tbody>
              {rows.map((item: any) => (
                <tr key={item.id}>
                  <td><button type="button" onClick={() => setSelectedId(item.id)} className="text-left font-semibold text-accent hover:underline">{item.displayName || item.username || item.email || 'Unnamed user'}</button>{item.id === adminUserId && <span className="ml-2 text-xs font-medium text-accent">You</span>}<div className="mt-1 max-w-[260px] truncate text-xs text-muted-foreground">{item.email || item.id}</div></td>
                  <td><Select value={item.role || 'user'} options={['user', 'support', 'admin']} disabled={updatingId === item.id || item.id === adminUserId} onChange={(role) => updateUser(item.id, { role })} /></td>
                  <td><Select value={item.plan || 'free'} options={['free', 'paid', 'agency', 'admin']} disabled={updatingId === item.id} onChange={(plan) => updateUser(item.id, { plan, subscription_status: plan === 'free' ? 'inactive' : 'active' })} /></td>
                  <td><Select value={item.subscriptionStatus || 'inactive'} options={['inactive', 'trialing', 'active', 'past_due', 'cancelled']} disabled={updatingId === item.id} onChange={(subscription_status) => updateUser(item.id, { subscription_status })} /></td>
                  <td><div className="font-medium">{item.auditQuotaUsedDaily || 0} daily</div><div className="text-xs text-muted-foreground">{item.auditQuotaUsedMonthly || 0} monthly</div></td>
                  <td><button disabled={updatingId === item.id} onClick={() => updateUser(item.id, { resetQuotas: true })} className="quiet-button min-h-9 px-3 py-1.5 text-xs">{updatingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Reset quota</button></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6}><Empty text="No users match these filters." /></td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {selected && <DetailDrawer title="Account details" onClose={() => setSelectedId(null)}><DetailFields fields={[
        ['Name', selected.displayName], ['Email', selected.email], ['Account ID', selected.id],
        ['Role', selected.role], ['Plan', selected.plan], ['Subscription', selected.subscriptionStatus],
        ['Daily audits used', selected.auditQuotaUsedDaily], ['Monthly audits used', selected.auditQuotaUsedMonthly], ['Created', selected.createdAt],
      ]} /></DetailDrawer>}
    </Panel>
  );
}
