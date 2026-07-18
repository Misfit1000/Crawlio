import { useCallback, useEffect, useState } from 'react';
import { Ban, ChevronRight, Download, FileClock, RefreshCw, RotateCcw, Save, Search, ShieldCheck, UserRound, X } from 'lucide-react';
import {
  downloadAdminExport,
  getAdminControlUser,
  getAdminControlUsers,
  runAdminUserAction,
  type AdminDeletionRequestSummary,
  type AdminUserSummary,
} from '../../lib/admin/client';
import { Panel } from '../ui/page-system';
import AdminActionDialog from './AdminActionDialog';
import { AdminEmpty, AdminError, AdminLoading, AdminStatus, formatAdminDate } from './AdminControlPrimitives';

type PendingAction = {
  action: 'suspend' | 'restore' | 'reset_quota' | 'update_access' | 'process_deletion';
  title: string;
  description: string;
  label: string;
  tone?: 'primary' | 'danger';
  confirmationPhrase?: string;
  payload?: Record<string, unknown>;
  targetId?: string;
};

export default function AdminUsersView({ currentAdminId }: { currentAdminId: string }) {
  const [queryInput, setQueryInput] = useState('');
  const [filters, setFilters] = useState({ query: '', role: '', plan: '', status: '' });
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [deletionRequests, setDeletionRequests] = useState<AdminDeletionRequestSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const [note, setNote] = useState('');
  const [access, setAccess] = useState({ role: '', plan: '', subscription_status: '' });

  const load = useCallback(async (append = false, requestedCursor: string | null = null) => {
    setLoading(true);
    try {
      const page = await getAdminControlUsers({ ...filters, cursor: requestedCursor, limit: 25 });
      setUsers((current) => append ? [...current, ...page.items] : page.items);
      setTotal(page.total);
      setNextCursor(page.nextCursor);
      setCursor(requestedCursor);
      setDeletionRequests(page.deletionRequests);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Users could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadDetail = useCallback(async (userId: string) => {
    setSelectedId(userId);
    setDetailLoading(true);
    try {
      const next = await getAdminControlUser(userId);
      setDetail(next);
      setAccess({
        role: next.user.role,
        plan: next.user.plan,
        subscription_status: next.user.subscriptionStatus,
      });
      setActionError('');
    } catch (loadError) {
      setActionError(loadError instanceof Error ? loadError.message : 'User detail could not be loaded.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false, null);
  }, [load]);

  const refreshAll = async () => {
    await load(false, null);
    if (selectedId) await loadDetail(selectedId);
  };

  const submitAction = async ({ reason, confirmation }: { reason: string; confirmation: string }) => {
    const targetId = pendingAction?.targetId || selectedId;
    if (!targetId || !pendingAction) return;
    setActionPending(true);
    setActionError('');
    try {
      await runAdminUserAction(targetId, {
        action: pendingAction.action,
        reason,
        confirmation,
        ...pendingAction.payload,
      });
      const processedDeletion = pendingAction.action === 'process_deletion';
      setPendingAction(null);
      if (processedDeletion && selectedId === targetId) {
        setSelectedId(null);
        setDetail(null);
        await load(false, null);
      } else {
        await refreshAll();
      }
    } catch (actionFailure) {
      setActionError(actionFailure instanceof Error ? actionFailure.message : 'The user action failed.');
    } finally {
      setActionPending(false);
    }
  };

  const addNote = async () => {
    if (!selectedId || note.trim().length < 4) return;
    setActionPending(true);
    try {
      await runAdminUserAction(selectedId, { action: 'add_note', note: note.trim(), reason: 'Administrator note added' });
      setNote('');
      await loadDetail(selectedId);
    } catch (noteError) {
      setActionError(noteError instanceof Error ? noteError.message : 'The note could not be added.');
    } finally {
      setActionPending(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Users and access</h2>
          <p className="mt-1 text-sm text-muted-foreground">Search accounts, inspect usage, manage access, and process user-requested deletion.</p>
        </div>
        <button type="button" onClick={() => void downloadAdminExport('users')} className="quiet-button self-start lg:self-auto"><Download className="h-4 w-4" />Export CSV</button>
      </div>

      <Panel>
        <form className="grid gap-2 lg:grid-cols-[minmax(240px,1fr)_150px_150px_180px_auto]" onSubmit={(event) => {
          event.preventDefault();
          setFilters((current) => ({ ...current, query: queryInput.trim() }));
        }}>
          <label className="relative">
            <span className="sr-only">Search users</span>
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} className="suite-input pl-9" placeholder="Email, name, or username" />
          </label>
          <select aria-label="Role filter" value={filters.role} onChange={(event) => setFilters((current) => ({ ...current, role: event.target.value }))} className="suite-input">
            <option value="">All roles</option><option value="user">User</option><option value="support">Support</option><option value="admin">Admin</option>
          </select>
          <select aria-label="Plan filter" value={filters.plan} onChange={(event) => setFilters((current) => ({ ...current, plan: event.target.value }))} className="suite-input">
            <option value="">All plans</option><option value="free">Free</option><option value="paid">Paid</option><option value="agency">Agency</option><option value="admin">Admin</option>
          </select>
          <select aria-label="Account status filter" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className="suite-input">
            <option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="deletion_requested">Deletion requested</option>
          </select>
          <button type="submit" className="primary-button justify-center"><Search className="h-4 w-4" />Apply</button>
        </form>
      </Panel>

      {error && <AdminError message={error} />}
      <Panel className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-sm text-muted-foreground"><span className="font-semibold text-foreground">{total}</span> accounts match</div>
          <button type="button" onClick={() => void load(false, null)} className="icon-button h-9 w-9" aria-label="Refresh users"><RefreshCw className="h-4 w-4" /></button>
        </div>
        {loading && users.length === 0 ? <AdminLoading /> : users.length === 0 ? (
          <AdminEmpty title="No matching accounts" detail="Adjust the search or account filters." />
        ) : (
          <>
            <div className="max-w-full overflow-x-auto">
              <table className="suite-table min-w-[940px]">
                <thead><tr><th>User</th><th>Status</th><th>Access</th><th>Quota used</th><th>Created</th><th><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><UserRound className="h-4 w-4" /></span>
                          <div className="min-w-0">
                            <div className="max-w-[260px] truncate font-semibold">{user.displayName || user.email || 'Unnamed account'}{user.id === currentAdminId && <span className="ml-2 text-xs text-accent">You</span>}</div>
                            <div className="mt-0.5 max-w-[260px] truncate text-xs text-muted-foreground">{user.email || user.id}</div>
                          </div>
                        </div>
                      </td>
                      <td><AdminStatus value={user.disabled ? 'suspended' : user.deletionRequestedAt ? 'deletion requested' : 'active'} /></td>
                      <td><div className="capitalize">{user.plan}</div><div className="mt-0.5 text-xs capitalize text-muted-foreground">{user.role}</div></td>
                      <td><div className="tabular-nums">{user.quota.dailyUsed} daily</div><div className="mt-0.5 text-xs tabular-nums text-muted-foreground">{user.quota.monthlyUsed} monthly</div></td>
                      <td className="text-sm text-muted-foreground">{formatAdminDate(user.createdAt)}</td>
                      <td><button type="button" onClick={() => void loadDetail(user.id)} className="quiet-button min-h-9 px-2.5" aria-label={`Open ${user.email || 'user'} details`}><ChevronRight className="h-4 w-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {nextCursor && <div className="flex justify-center border-t border-border p-3"><button type="button" disabled={loading} onClick={() => void load(true, nextCursor)} className="quiet-button">Load more</button></div>}
          </>
        )}
      </Panel>

      {deletionRequests.length > 0 && (
        <Panel>
          <div className="flex items-start gap-3 border-b border-border p-4">
            <FileClock className="mt-0.5 h-5 w-5 text-amber-600 dark:text-amber-400" />
            <div>
              <h3 className="font-semibold">Account deletion requests</h3>
              <p className="mt-1 text-sm text-muted-foreground">Only requests created by the user are listed. Failed requests remain available for a guarded retry.</p>
            </div>
          </div>
          <div className="divide-y divide-border">
            {deletionRequests.map((request) => (
              <div key={request.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{request.requester_email || request.user_id}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <AdminStatus value={request.status} />
                    <span>Requested {formatAdminDate(request.requested_at)}</span>
                    {request.failure_code && <span>{request.failure_code}</span>}
                  </div>
                </div>
                {request.status !== 'processing' && (
                  <button type="button" onClick={() => setPendingAction({
                    action: 'process_deletion',
                    targetId: request.user_id,
                    title: request.status === 'failed' ? 'Retry account deletion' : 'Process account deletion',
                    description: 'Process this recorded self-service request and remove owned data plus the Supabase Auth account.',
                    label: request.status === 'failed' ? 'Retry deletion' : 'Delete account',
                    tone: 'danger',
                    confirmationPhrase: 'DELETE ACCOUNT',
                  })} className="danger-button self-start sm:self-auto">
                    {request.status === 'failed' ? 'Retry deletion' : 'Process deletion'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {selectedId && (
        <div className="fixed inset-0 z-[60] bg-slate-950/40" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setSelectedId(null);
        }}>
          <aside role="dialog" aria-modal="true" aria-label="User details" className="absolute inset-y-0 right-0 w-full max-w-2xl overflow-y-auto border-l border-border bg-background shadow-lg">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
              <div><div className="font-semibold">Account detail</div><div className="text-xs text-muted-foreground">Server-verified profile and activity</div></div>
              <button type="button" onClick={() => setSelectedId(null)} className="icon-button h-9 w-9" aria-label="Close user details"><X className="h-4 w-4" /></button>
            </div>
            {detailLoading || !detail ? <AdminLoading /> : (
              <div className="space-y-5 p-4 sm:p-6">
                {actionError && <AdminError message={actionError} />}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-xl font-semibold">{detail.user.displayName || detail.user.email || 'Unnamed account'}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{detail.user.email || detail.user.id}</p>
                  </div>
                  <AdminStatus value={detail.user.disabled ? 'suspended' : 'active'} />
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted-foreground">Projects</div><div className="mt-1 text-xl font-semibold">{detail.projectCount}</div></div>
                  <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted-foreground">Recent audits</div><div className="mt-1 text-xl font-semibold">{detail.recentAudits.length}</div></div>
                  <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted-foreground">Last sign-in</div><div className="mt-1 text-xs font-semibold">{formatAdminDate(detail.account.lastSignInAt)}</div></div>
                </div>

                <section>
                  <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-accent" /><h4 className="font-semibold">Access and plan</h4></div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <select aria-label="User role" value={access.role} onChange={(event) => setAccess((current) => ({ ...current, role: event.target.value }))} className="suite-input"><option value="user">User</option><option value="support">Support</option><option value="admin">Admin</option></select>
                    <select aria-label="User plan" value={access.plan} onChange={(event) => setAccess((current) => ({ ...current, plan: event.target.value }))} className="suite-input"><option value="free">Free</option><option value="paid">Paid</option><option value="agency">Agency</option><option value="admin">Admin</option></select>
                    <select aria-label="Subscription status" value={access.subscription_status} onChange={(event) => setAccess((current) => ({ ...current, subscription_status: event.target.value }))} className="suite-input"><option value="inactive">Inactive</option><option value="trialing">Trialing</option><option value="active">Active</option><option value="past_due">Past due</option><option value="cancelled">Cancelled</option></select>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setPendingAction({ action: 'update_access', title: 'Update account access', description: 'Apply the selected role, plan, and subscription state.', label: 'Update access', payload: { patch: access } })} className="primary-button"><Save className="h-4 w-4" />Update access</button>
                    <button type="button" onClick={() => setPendingAction({ action: 'reset_quota', title: 'Reset audit quota', description: "Reset this account's daily and monthly usage counters to zero.", label: 'Reset quota' })} className="quiet-button"><RotateCcw className="h-4 w-4" />Reset quota</button>
                    {detail.user.disabled ? (
                      <button type="button" onClick={() => setPendingAction({ action: 'restore', title: 'Restore account access', description: 'Remove the authentication ban and allow this account to use Crawlio again.', label: 'Restore account' })} className="quiet-button"><ShieldCheck className="h-4 w-4" />Restore</button>
                    ) : (
                      <button type="button" disabled={selectedId === currentAdminId} onClick={() => setPendingAction({ action: 'suspend', title: 'Suspend account', description: 'Block authentication and all user-owned data access until an administrator restores the account.', label: 'Suspend account', tone: 'danger', confirmationPhrase: 'SUSPEND' })} className="danger-button"><Ban className="h-4 w-4" />Suspend</button>
                    )}
                  </div>
                </section>

                {detail.user.deletionRequestedAt && (
                  <section className="rounded-lg border border-red-500/25 bg-red-500/5 p-4">
                    <div className="flex items-start gap-3">
                      <FileClock className="mt-0.5 h-5 w-5 text-red-600 dark:text-red-400" />
                      <div className="flex-1">
                        <h4 className="font-semibold">Deletion requested</h4>
                        <p className="mt-1 text-sm text-muted-foreground">Requested {formatAdminDate(detail.user.deletionRequestedAt)}. Only this recorded user request may be processed.</p>
                        <button type="button" onClick={() => setPendingAction({ action: 'process_deletion', title: 'Permanently delete account', description: 'Process the recorded user-requested deletion and remove owned data plus the Supabase Auth account.', label: 'Delete account', tone: 'danger', confirmationPhrase: 'DELETE ACCOUNT' })} className="danger-button mt-3">Process deletion</button>
                      </div>
                    </div>
                  </section>
                )}

                <section>
                  <h4 className="font-semibold">Administrator notes</h4>
                  <div className="mt-3 flex gap-2">
                    <textarea value={note} onChange={(event) => setNote(event.target.value)} className="suite-input min-h-20 flex-1 resize-y" placeholder="Add operational context" maxLength={4000} />
                    <button type="button" onClick={() => void addNote()} disabled={note.trim().length < 4 || actionPending} className="primary-button self-end">Add</button>
                  </div>
                  <div className="mt-3 divide-y divide-border rounded-lg border border-border">
                    {detail.notes.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No administrator notes.</p> : detail.notes.map((item: any) => (
                      <div key={item.id} className="p-3"><p className="text-sm leading-6">{item.note}</p><div className="mt-1 text-xs text-muted-foreground">{formatAdminDate(item.created_at)}</div></div>
                    ))}
                  </div>
                </section>

                <section>
                  <h4 className="font-semibold">Recent audits</h4>
                  <div className="mt-3 divide-y divide-border rounded-lg border border-border">
                    {detail.recentAudits.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No audits recorded.</p> : detail.recentAudits.map((audit: any) => (
                      <div key={audit.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center"><div className="min-w-0"><div className="truncate text-sm font-semibold">{audit.normalizedUrl}</div><div className="mt-1 text-xs text-muted-foreground">{audit.pagesCrawled} pages checked / {formatAdminDate(audit.createdAt)}</div></div><AdminStatus value={audit.status} /></div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </aside>
        </div>
      )}

      <AdminActionDialog
        open={Boolean(pendingAction)}
        title={pendingAction?.title || ''}
        description={pendingAction?.description || ''}
        actionLabel={pendingAction?.label || 'Apply'}
        confirmationPhrase={pendingAction?.confirmationPhrase}
        tone={pendingAction?.tone}
        pending={actionPending}
        error={actionError}
        impact={pendingAction?.action === 'suspend' ? ['Current sessions and new sign-ins are blocked.', 'Supabase RLS denies user-owned data access.', 'An administrator can restore access later.'] : pendingAction?.action === 'process_deletion' ? ['Owned audit and project data is removed.', 'The Supabase Auth account is deleted.', 'The deletion request remains as an operational record.'] : []}
        onCancel={() => {
          if (!actionPending) {
            setPendingAction(null);
            setActionError('');
          }
        }}
        onConfirm={submitAction}
      />
    </div>
  );
}
