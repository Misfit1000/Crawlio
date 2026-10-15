export interface TimingDistribution { samples: number; p50Ms: number | null; p95Ms: number | null }
export interface CapacitySnapshot {
  observedAt: string;
  previews: { dailyBudgetMs: number; consumedMs: number; reservedMs: number; remainingMs: number; resetAt: string;
    queued: number; running: number; storageBytes: number; storageLimitBytes: number; retentionDays: number; reuseHours: number };
  openPageRank: { applicationMonthlyLimit: number; providerFreeMonthlyLimit: number; applicationMinuteLimit: number;
    monthlyReserved: number; minuteReserved: number; resetAt: string; activeRefreshes: number };
  timings: { windowDays: number; auditSampleCount: number; maxSamples: number;
    admission: TimingDistribution; serverPreparation: TimingDistribution; queue: TimingDistribution; firstPage: TimingDistribution; completion: TimingDistribution };
  maintenance: { lastRunAt: string; counts: Record<string, number> } | null;
  configured: { previews: boolean; openPageRank: boolean; secondaryWake: boolean };
}
