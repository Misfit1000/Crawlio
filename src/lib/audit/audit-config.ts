import { planPageCeiling } from './scalable-policy';

export type AuditMode = 'quick' | 'standard' | 'deep';

export const AUDIT_MODES: readonly AuditMode[] = ['quick', 'standard', 'deep'];

export const AUDIT_MODE_PAGE_CEILINGS: Readonly<Record<AuditMode, number>> = {
  quick: 50,
  standard: 50,
  deep: 100,
};

export interface AuditRuntimeCapabilities {
  availableModes: AuditMode[];
  pageCeilings: Record<AuditMode, number>;
  unavailableReasons: Partial<Record<AuditMode, string>>;
}

export interface AuditModeConfig {
  mode: AuditMode;
  label: string;
  pageLimit: number;
  concurrency: number;
  timeoutMs: number;
  description: string;
}

const AUDIT_MODE_CONFIG: Record<AuditMode, AuditModeConfig> = {
  quick: {
    mode: 'quick',
    label: 'Quick audit',
    pageLimit: 5,
    concurrency: 2,
    timeoutMs: 6000,
    description: 'A focused crawl for fast feedback on the most important pages.',
  },
  standard: {
    mode: 'standard',
    label: 'Standard audit',
    pageLimit: 50,
    concurrency: 3,
    timeoutMs: 8000,
    description: 'Broader discovery with complete standard SEO and technical checks.',
  },
  deep: {
    mode: 'deep',
    label: 'Deep audit',
    pageLimit: 75,
    concurrency: 4,
    timeoutMs: 12000,
    description: 'Manual opt-in audit for expanded sitemap, crawl graph, page-level, and issue clustering coverage.',
  },
};

export const AUDIT_LIMITS = {
  maxEvents: 300,
  maxIssues: 1000,
  lockLeaseMs: 5 * 60 * 1000,
  staleLockRecoveryMs: 5 * 60 * 1000,
  defaultExpiresInDays: 30,
  workerPollIntervalMs: 4000,
  livePollIntervalMs: 2000,
  noWorkerWarningMs: 20000,
  maxRecoveryAttempts: 2,
};

export function getAuditModeConfig(mode: unknown): AuditModeConfig {
  if (mode === 'standard' || mode === 'deep') {
    return AUDIT_MODE_CONFIG[mode];
  }
  return AUDIT_MODE_CONFIG.quick;
}

export function getAuditModeLabel(mode: unknown) {
  return getAuditModeConfig(mode).label;
}

export function isAuditMode(value: unknown): value is AuditMode {
  return value === 'quick' || value === 'standard' || value === 'deep';
}

export function normalizeAuditModes(value: unknown, fallback: readonly AuditMode[] = ['quick']): AuditMode[] {
  if (!Array.isArray(value)) return [...fallback];
  const modes = AUDIT_MODES.filter((mode) => value.includes(mode));
  return modes.length ? modes : [...fallback];
}

// Omitting the plan deliberately retains the legacy engine's safety bounds.
export function enforceAuditPageLimit(mode: AuditMode, value: unknown, fallback: number, plan?: string) {
  const numeric = Number(value);
  const requested = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
  return Math.max(1, Math.min(plan === undefined ? AUDIT_MODE_PAGE_CEILINGS[mode] : planPageCeiling(plan), requested));
}

export function createAuditRuntimeCapabilities(deepAuditEnabled: boolean, readiness = { ready: false, deepReady: false }, plan = 'free'): AuditRuntimeCapabilities {
  return {
    availableModes: deepAuditEnabled ? [...AUDIT_MODES] : ['quick', 'standard'],
    pageCeilings: {
      quick: readiness.ready ? planPageCeiling(plan) : AUDIT_MODE_PAGE_CEILINGS.quick,
      standard: readiness.ready ? planPageCeiling(plan) : AUDIT_MODE_PAGE_CEILINGS.standard,
      deep: readiness.ready && readiness.deepReady ? planPageCeiling(plan) : AUDIT_MODE_PAGE_CEILINGS.deep,
    },
    unavailableReasons: deepAuditEnabled
      ? {}
      : { deep: 'Deep audits are temporarily unavailable because the dedicated audit engine is not enabled.' },
  };
}
