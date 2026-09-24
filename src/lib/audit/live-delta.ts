import { isCompletedAuditStatus } from './audit-time';
import type { ResourceAuditDocument } from './resource-types';

export interface AuditLiveDeltaCursor {
  updatedAt?: string;
  status?: string;
  pagesCrawled?: number;
  issuesFound?: number;
  hasReport?: boolean;
}

export function planAuditLiveDelta(audit: ResourceAuditDocument, cursor: AuditLiveDeltaCursor) {
  const pagesChanged = audit.pagesCrawled > Math.max(0, Math.floor(Number(cursor.pagesCrawled || 0)));
  const issuesChanged = audit.issuesFound > Math.max(0, Math.floor(Number(cursor.issuesFound || 0)));
  const auditChanged = audit.updatedAt !== String(cursor.updatedAt || '') || audit.status !== String(cursor.status || '');
  return {
    auditChanged,
    pagesChanged,
    issuesChanged,
    eventsNeeded: auditChanged,
    reportNeeded: isCompletedAuditStatus(audit.status) && !cursor.hasReport,
  };
}
