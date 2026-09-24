export type PublicPlanId = 'free' | 'plus' | 'pro';
export type PublicPlanSourceId = 'free' | 'paid' | 'agency';
export type PublicAuditMode = 'quick' | 'standard' | 'deep';

export interface PublicPlanItem {
  id: PublicPlanId;
  sourcePlan: PublicPlanSourceId;
  dailyAudits: number;
  monthlyAudits: number;
  pagesPerAudit: number;
  allowedModes: PublicAuditMode[];
  exportsEnabled: boolean;
  pdfEnabled: boolean;
  scheduledAuditsEnabled: boolean;
}

export interface PublicPlanProjection {
  version: 1;
  updatedAt: string;
  plans: PublicPlanItem[];
}

export interface PublicPlanPresentation {
  id: PublicPlanId;
  name: string;
  mode: string;
  pagesPerAudit: number;
  allowance: string;
  bestFor: string;
  features: string[];
  footer: string;
  recommended?: boolean;
  capabilities?: Pick<PublicPlanItem, 'allowedModes' | 'exportsEnabled' | 'pdfEnabled' | 'scheduledAuditsEnabled'>;
}

export const PUBLIC_AUDIT_PLANS: readonly PublicPlanPresentation[] = [
  {
    id: 'free', name: 'Free', mode: 'Quick audit', pagesPerAudit: 5,
    allowance: '3 daily · 30 monthly', bestFor: 'Testing a small website or a few important pages',
    features: [
      'Core on-page and technical SEO checks',
      'Metadata, headings, indexing, and crawlability findings',
      'Passive browser-security observations',
      'Live progress and saved reports',
      'JSON and CSV exports',
      'One active audit at a time',
    ],
    footer: 'Best for small sites and first-time checks.',
  },
  {
    id: 'plus', name: 'Plus', mode: 'Full standard audit', pagesPerAudit: 50,
    allowance: '25 daily · 500 monthly', bestFor: 'Small businesses and growing content websites',
    features: [
      'Includes everything in Free',
      'Wider page coverage and full finding categories',
      'PDF, JSON, and CSV exports',
      'Audit history and comparison',
      'Faster processing priority',
    ],
    footer: 'Best for businesses managing one growing website.', recommended: true,
  },
  {
    id: 'pro', name: 'Pro', mode: 'Agency deep audit', pagesPerAudit: 75,
    allowance: '100 daily · 3,000 monthly', bestFor: 'Agencies, teams, and larger websites',
    features: [
      'Includes everything in Plus',
      'Quick, Standard, and Deep audit modes',
      'Deep sitemap and crawl-graph discovery',
      'PDF, JSON, and CSV reports',
      'Highest non-admin processing priority',
    ],
    footer: 'Best for agencies, multi-site teams, and larger websites.',
  },
] as const;

export const PUBLIC_PLAN_COMPARISON = [
  { label: 'Pages per audit', values: ['5', '50', '75'] },
  { label: 'Audit modes', values: ['Quick', 'Quick + Standard', 'Quick + Standard + Deep'] },
  { label: 'PDF export', values: ['No', 'Yes', 'Yes'] },
  { label: 'JSON and CSV exports', values: ['Yes', 'Yes', 'Yes'] },
  { label: 'History and comparison', values: ['Yes', 'Yes', 'Yes'] },
  { label: 'Deep sitemap discovery', values: ['No', 'No', 'Yes'] },
] as const;

const PUBLIC_SOURCE_TO_ID: Record<PublicPlanSourceId, PublicPlanId> = {
  free: 'free',
  paid: 'plus',
  agency: 'pro',
};

const PUBLIC_PLAN_FALLBACKS: Record<PublicPlanId, PublicPlanItem> = {
  free: { id: 'free', sourcePlan: 'free', dailyAudits: 3, monthlyAudits: 30, pagesPerAudit: 5, allowedModes: ['quick'], exportsEnabled: true, pdfEnabled: false, scheduledAuditsEnabled: false },
  plus: { id: 'plus', sourcePlan: 'paid', dailyAudits: 25, monthlyAudits: 500, pagesPerAudit: 50, allowedModes: ['quick', 'standard'], exportsEnabled: true, pdfEnabled: true, scheduledAuditsEnabled: false },
  pro: { id: 'pro', sourcePlan: 'agency', dailyAudits: 100, monthlyAudits: 3000, pagesPerAudit: 75, allowedModes: ['quick', 'standard', 'deep'], exportsEnabled: true, pdfEnabled: true, scheduledAuditsEnabled: true },
};

function boundedPositiveInteger(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.min(1_000_000, Math.floor(numeric)) : fallback;
}

function publicModes(value: unknown, fallback: PublicAuditMode[]) {
  if (!Array.isArray(value)) return fallback;
  const allowed = value.filter((mode): mode is PublicAuditMode => mode === 'quick' || mode === 'standard' || mode === 'deep');
  return allowed.length ? [...new Set(allowed)] : fallback;
}

export function createPublicPlanProjection(rows: Array<Record<string, unknown>>, updatedAt = new Date().toISOString()): PublicPlanProjection {
  const safeRows = new Map<PublicPlanSourceId, Record<string, unknown>>();
  for (const row of rows) {
    const sourcePlan = String(row.plan || '') as PublicPlanSourceId;
    if (sourcePlan in PUBLIC_SOURCE_TO_ID) safeRows.set(sourcePlan, row);
  }
  const plans = (Object.keys(PUBLIC_SOURCE_TO_ID) as PublicPlanSourceId[]).map((sourcePlan) => {
    const id = PUBLIC_SOURCE_TO_ID[sourcePlan];
    const fallback = PUBLIC_PLAN_FALLBACKS[id];
    const row = safeRows.get(sourcePlan) || {};
    const allowedModes = publicModes(row.allowed_modes ?? row.allowedModes, fallback.allowedModes);
    const mode = allowedModes.includes('deep') ? 'deep' : allowedModes.includes('standard') ? 'standard' : 'quick';
    const pageField = mode === 'deep' ? 'max_pages_deep' : mode === 'standard' ? 'max_pages_standard' : 'max_pages_quick';
    const camelField = mode === 'deep' ? 'maxPagesDeep' : mode === 'standard' ? 'maxPagesStandard' : 'maxPagesQuick';
    return {
      id,
      sourcePlan,
      dailyAudits: boundedPositiveInteger(row.daily_audits ?? row.dailyAudits, fallback.dailyAudits),
      monthlyAudits: boundedPositiveInteger(row.monthly_audits ?? row.monthlyAudits, fallback.monthlyAudits),
      pagesPerAudit: boundedPositiveInteger(row[pageField] ?? row[camelField], fallback.pagesPerAudit),
      allowedModes,
      exportsEnabled: typeof (row.exports_enabled ?? row.exportsEnabled) === 'boolean' ? Boolean(row.exports_enabled ?? row.exportsEnabled) : fallback.exportsEnabled,
      pdfEnabled: typeof (row.pdf_enabled ?? row.pdfEnabled) === 'boolean' ? Boolean(row.pdf_enabled ?? row.pdfEnabled) : fallback.pdfEnabled,
      scheduledAuditsEnabled: typeof (row.scheduled_audits_enabled ?? row.scheduledAuditsEnabled) === 'boolean' ? Boolean(row.scheduled_audits_enabled ?? row.scheduledAuditsEnabled) : fallback.scheduledAuditsEnabled,
    };
  });
  return { version: 1, updatedAt, plans };
}

export function mergePublicPlanPresentation(projection?: PublicPlanProjection | null): PublicPlanPresentation[] {
  const live = new Map(projection?.plans.map((plan) => [plan.id, plan]) || []);
  return PUBLIC_AUDIT_PLANS.map((plan) => {
    const limits = live.get(plan.id) || PUBLIC_PLAN_FALLBACKS[plan.id];
    const features = plan.features.filter((feature) => {
      if (!limits.pdfEnabled && /\bPDF\b/i.test(feature)) return false;
      if (!limits.exportsEnabled && /\b(?:JSON|CSV|exports?)\b/i.test(feature)) return false;
      return true;
    });
    return {
      ...plan,
      features,
      pagesPerAudit: limits.pagesPerAudit,
      allowance: `${limits.dailyAudits.toLocaleString('en-US')} daily · ${limits.monthlyAudits.toLocaleString('en-US')} monthly`,
      capabilities: {
        allowedModes: limits.allowedModes,
        exportsEnabled: limits.exportsEnabled,
        pdfEnabled: limits.pdfEnabled,
        scheduledAuditsEnabled: limits.scheduledAuditsEnabled,
      },
    };
  });
}

export function createPublicPlanComparison(plans: PublicPlanPresentation[]) {
  return [
    { label: 'Pages per audit', values: plans.map((plan) => String(plan.pagesPerAudit)) },
    { label: 'Audit modes', values: plans.map((plan) => (plan.capabilities?.allowedModes || []).map((mode) => mode[0].toUpperCase() + mode.slice(1)).join(' + ')) },
    { label: 'PDF export', values: plans.map((plan) => plan.capabilities?.pdfEnabled ? 'Yes' : 'No') },
    { label: 'JSON and CSV exports', values: plans.map((plan) => plan.capabilities?.exportsEnabled ? 'Yes' : 'No') },
    { label: 'History and comparison', values: plans.map(() => 'Yes') },
    { label: 'Scheduled audits', values: plans.map((plan) => plan.capabilities?.scheduledAuditsEnabled ? 'Yes' : 'No') },
  ];
}
