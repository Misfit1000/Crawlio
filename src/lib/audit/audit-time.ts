import type { AuditStatus, ResourceAuditDocument } from './resource-types';

type AuditTimingInput = Pick<
  ResourceAuditDocument,
  'status' | 'createdAt' | 'startedAt' | 'completedAt' | 'cancelledAt' | 'updatedAt'
>;

export const TERMINAL_AUDIT_STATUSES: ReadonlySet<AuditStatus> = new Set([
  'completed',
  'completed_with_warnings',
  'failed',
  'cancelled',
  'abandoned',
]);

export const USABLE_REPORT_AUDIT_STATUSES: ReadonlySet<AuditStatus> = new Set([
  'completed',
  'completed_with_warnings',
]);

export function isTerminalAuditStatus(status?: AuditStatus | null) {
  return Boolean(status && TERMINAL_AUDIT_STATUSES.has(status));
}

export function isCompletedAuditStatus(status?: AuditStatus | string | null) {
  return Boolean(status && USABLE_REPORT_AUDIT_STATUSES.has(status as AuditStatus));
}

export function hasUsableAuditReport(status?: AuditStatus | string | null) {
  return isCompletedAuditStatus(status);
}

function parseTime(value?: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function getAuditTerminalTime(audit?: Partial<AuditTimingInput> | null) {
  if (!audit || !isTerminalAuditStatus(audit.status as AuditStatus | undefined)) return null;
  return parseTime(audit.completedAt) ?? parseTime(audit.cancelledAt) ?? parseTime(audit.updatedAt);
}

export function getAuditStartTime(audit?: Partial<AuditTimingInput> | null) {
  return parseTime(audit?.startedAt) ?? parseTime(audit?.createdAt);
}

export function formatDurationMs(durationMs: number) {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatAuditElapsed(audit?: Partial<AuditTimingInput> | null, nowMs = Date.now()) {
  const startMs = getAuditStartTime(audit);
  if (!startMs) return '0s';
  const endMs = getAuditTerminalTime(audit) ?? nowMs;
  return formatDurationMs(endMs - startMs);
}
