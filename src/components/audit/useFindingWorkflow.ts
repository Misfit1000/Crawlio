import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ResourceAuditIssue } from '../../lib/audit/resource-types';
import {
  clearChecklist,
  clearFindingNotes,
  issueSignature,
  readChecklist,
  readFindingNotes,
  writeChecklist,
  writeFindingNotes,
} from '../../lib/audit/client-insights';
import {
  isFindingWorkflowStatus,
  type FindingPriorityOverride,
  type FindingWorkflowRecord,
  type FindingWorkflowStatus,
} from '../../lib/audit/finding-workflow';
import { API_ROUTES } from '../../lib/api/routes';
import { getAuthHeaders } from '../../lib/api/auth-headers';
import { safeJsonFetch } from '../../lib/http/safe-json';
import { getSupabaseBrowserClient } from '../../lib/supabase/client';

type WorkflowPatch = {
  status?: FindingWorkflowStatus;
  notes?: string;
  dueAt?: string | null;
  priorityOverride?: FindingPriorityOverride | null;
  assignedToSelf?: boolean;
};

const MIGRATION_PREFIX = 'crawlio_finding_workflow_migrated_v1:';

function localRecord(auditId: string, key: string, status: FindingWorkflowStatus, notes = ''): FindingWorkflowRecord {
  const timestamp = new Date().toISOString();
  return {
    id: `device:${auditId}:${key}`,
    auditId,
    findingId: null,
    findingKey: key,
    status,
    priorityOverride: null,
    notes,
    dueAt: null,
    assignedTo: null,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    updatedBy: 'device',
    version: 0,
  };
}

function recordsByKey(records: FindingWorkflowRecord[]) {
  return Object.fromEntries(records.map((record) => [record.findingKey, record]));
}

async function saveRemoteRecord(auditId: string, key: string, current: FindingWorkflowRecord | undefined, patch: WorkflowPatch) {
  const response = await safeJsonFetch<any>(API_ROUTES.auditFindingWorkflowItem(auditId, key), {
    method: 'PUT',
    headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'same-origin',
    body: JSON.stringify({
      status: patch.status ?? current?.status ?? 'not_started',
      notes: patch.notes ?? current?.notes ?? '',
      dueAt: patch.dueAt === undefined ? current?.dueAt ?? null : patch.dueAt,
      priorityOverride: patch.priorityOverride === undefined ? current?.priorityOverride ?? null : patch.priorityOverride,
      assignedToSelf: patch.assignedToSelf === undefined ? Boolean(current?.assignedTo) : patch.assignedToSelf,
      expectedVersion: current && current.version > 0 ? current.version : undefined,
    }),
  });
  if (response.success === false) throw new Error(response.error);
  const payload = response.data as any;
  return (payload.data?.record || payload.record) as FindingWorkflowRecord;
}

export function useFindingWorkflow(auditId: string, issues: ResourceAuditIssue[]) {
  const [records, setRecords] = useState<Record<string, FindingWorkflowRecord>>({});
  const [storage, setStorage] = useState<'loading' | 'supabase' | 'device'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const issueKeys = useMemo(() => issues.map(issueSignature).sort(), [issues]);
  const issueKeyToken = issueKeys.join('\n');

  const load = useCallback(async () => {
    const localStatuses = readChecklist(auditId);
    const localNotes = readFindingNotes(auditId);
    const localKeys = new Set([...Object.keys(localStatuses), ...Object.keys(localNotes)]);
    const deviceRecords = Object.fromEntries(Array.from(localKeys).map((key) => [key, localRecord(
      auditId,
      key,
      isFindingWorkflowStatus(localStatuses[key]) ? localStatuses[key] : 'not_started',
      String(localNotes[key] || '').slice(0, 2000),
    )]));
    setRecords(deviceRecords);

    const response = await safeJsonFetch<any>(API_ROUTES.auditFindingWorkflow(auditId), {
      headers: await getAuthHeaders(),
      credentials: 'same-origin',
    });
    if (response.success === false) {
      if ([401, 403].includes(response.status || 0)) {
        setStorage('device');
        setError(null);
        return;
      }
      setStorage('device');
      setError(response.error);
      return;
    }

    const payload = response.data as any;
    const remoteRecords = (payload.data?.records || payload.records || []) as FindingWorkflowRecord[];
    let next = recordsByKey(remoteRecords);
    setRecords(next);
    setStorage('supabase');
    setError(null);

    const accessibleIssueKeys = new Set(issueKeys);
    const migrationKey = `${MIGRATION_PREFIX}${auditId}`;
    const alreadyMigrated = window.localStorage.getItem(migrationKey) === 'true';
    if (alreadyMigrated || !localKeys.size) {
      if (!alreadyMigrated) window.localStorage.setItem(migrationKey, 'true');
      return;
    }
    // The initial workflow request can finish before the audit snapshot. Keep
    // legacy data until accessible findings are present and can be matched.
    if (!issueKeys.length) return;

    try {
      for (const key of Array.from(localKeys).slice(0, 200)) {
        if (!accessibleIssueKeys.has(key) || next[key]) continue;
        const local = deviceRecords[key];
        const saved = await saveRemoteRecord(auditId, key, undefined, { status: local.status, notes: local.notes });
        next = { ...next, [key]: saved };
      }
      setRecords(next);
      clearChecklist(auditId);
      clearFindingNotes(auditId);
      window.localStorage.setItem(migrationKey, 'true');
    } catch (migrationError) {
      setError(migrationError instanceof Error ? `Device workflow could not be migrated: ${migrationError.message}` : 'Device workflow could not be migrated.');
    }
  }, [auditId, issueKeyToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (storage !== 'supabase') return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const channel = client.channel(`finding-workflow:${auditId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_finding_workflow', filter: `audit_id=eq.${auditId}` }, () => void load())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [auditId, load, storage]);

  const update = useCallback(async (key: string, patch: WorkflowPatch) => {
    const current = recordsRef.current[key];
    const optimistic = {
      ...(current || localRecord(auditId, key, 'not_started')),
      ...patch,
      assignedTo: patch.assignedToSelf === undefined ? current?.assignedTo ?? null : patch.assignedToSelf ? 'pending-self' : null,
      notes: String(patch.notes ?? current?.notes ?? '').slice(0, 2000),
      updatedAt: new Date().toISOString(),
    } as FindingWorkflowRecord;
    setRecords((value) => ({ ...value, [key]: optimistic }));

    if (storage !== 'supabase') {
      const nextStatuses = Object.fromEntries(Object.entries({ ...recordsRef.current, [key]: optimistic }).map(([recordKey, record]) => [recordKey, record.status]));
      const nextNotes = Object.fromEntries(Object.entries({ ...recordsRef.current, [key]: optimistic }).filter(([, record]) => record.notes).map(([recordKey, record]) => [recordKey, record.notes]));
      writeChecklist(auditId, nextStatuses);
      writeFindingNotes(auditId, nextNotes);
      return optimistic;
    }

    setSavingKeys((value) => new Set(value).add(key));
    try {
      const saved = await saveRemoteRecord(auditId, key, current, patch);
      setRecords((value) => ({ ...value, [key]: saved }));
      setError(null);
      return saved;
    } catch (saveError) {
      setRecords((value) => {
        const next = { ...value };
        if (current) next[key] = current; else delete next[key];
        return next;
      });
      setError(saveError instanceof Error ? saveError.message : 'Finding workflow could not be saved.');
      throw saveError;
    } finally {
      setSavingKeys((value) => { const next = new Set(value); next.delete(key); return next; });
    }
  }, [auditId, storage]);

  const statuses = useMemo(() => Object.fromEntries(Object.entries(records).map(([key, record]) => [key, record.status])), [records]);
  return { records, statuses, storage, error, savingKeys, update, reload: load };
}
