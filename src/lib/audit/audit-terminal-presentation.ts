import { hasUsableAuditReport } from './audit-time';
import type { AuditStatus } from './resource-types';

export type AuditTerminalPresentation = 'none' | 'preparing' | 'failed' | 'cancelled' | 'abandoned';

export function deriveAuditTerminalPresentation(
  status: AuditStatus,
  reportPending = false,
): AuditTerminalPresentation {
  if (hasUsableAuditReport(status)) return reportPending ? 'preparing' : 'none';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'abandoned') return 'abandoned';
  return 'none';
}
