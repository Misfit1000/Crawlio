import { hasUsableAuditReport } from './audit-time';
import type { ResourceAuditLiveData } from './resource-types';

export const FINAL_REPORT_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 3_000] as const;

const emptyLiveData = (): ResourceAuditLiveData => ({
  audit: null,
  latestEvents: [],
  latestPages: [],
  latestIssues: [],
  finalReport: null,
});

export function createEmptyAuditLiveData() {
  return emptyLiveData();
}

export function mergeAuditLiveData(
  current: ResourceAuditLiveData,
  incoming: ResourceAuditLiveData,
): ResourceAuditLiveData {
  if (current.audit && incoming.audit && current.audit.id !== incoming.audit.id) {
    return incoming;
  }

  return {
    audit: incoming.audit ?? current.audit,
    latestEvents: incoming.latestEvents.length ? incoming.latestEvents : current.latestEvents,
    latestPages: incoming.latestPages.length ? incoming.latestPages : current.latestPages,
    latestIssues: incoming.latestIssues.length ? incoming.latestIssues : current.latestIssues,
    finalReport: incoming.finalReport ?? current.finalReport ?? null,
  };
}

export function isFinalReportPending(data: ResourceAuditLiveData) {
  return hasUsableAuditReport(data.audit?.status) && !data.finalReport;
}

export interface FinalReportRetryResult {
  data: ResourceAuditLiveData;
  attempts: number;
  exhausted: boolean;
}

interface FinalReportRetryOptions {
  delays?: readonly number[];
  isActive?: () => boolean;
  onSnapshot?: (data: ResourceAuditLiveData) => void;
  wait?: (delayMs: number) => Promise<void>;
}

const waitFor = (delayMs: number) => new Promise<void>((resolve) => {
  globalThis.setTimeout(resolve, delayMs);
});

export async function waitForPersistedFinalReport(
  initialData: ResourceAuditLiveData,
  loadSnapshot: () => Promise<ResourceAuditLiveData>,
  options: FinalReportRetryOptions = {},
): Promise<FinalReportRetryResult> {
  const delays = options.delays ?? FINAL_REPORT_RETRY_DELAYS_MS;
  const isActive = options.isActive ?? (() => true);
  const wait = options.wait ?? waitFor;
  let data = initialData;
  let attempts = 0;

  for (const delayMs of delays) {
    if (!isActive() || !isFinalReportPending(data)) break;
    await wait(delayMs);
    if (!isActive()) break;

    attempts += 1;
    try {
      data = mergeAuditLiveData(data, await loadSnapshot());
      options.onSnapshot?.(data);
    } catch {
      // Persistence can briefly lag the terminal audit update. Retry within the bounded schedule.
    }
  }

  return {
    data,
    attempts,
    exhausted: isFinalReportPending(data),
  };
}
