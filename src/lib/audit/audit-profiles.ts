import type { AuditMode, ProcessingTier, ResourceAuditDocument, UserPlan } from './resource-types';

export interface AuditProfile {
  id: 'free_quick' | 'paid_standard' | 'agency_deep' | 'admin_deep';
  label: string;
  plan: UserPlan;
  processingTier: ProcessingTier;
  mode: AuditMode;
  pageLimit: number;
  concurrency: number;
  timeoutMs: number;
  maxEvents: number;
  maxIssues: number;
  externalLinkChecks: boolean;
  deepSitemapExpansion: boolean;
  exposedFileChecks: boolean;
  pdfEnabled: boolean;
  whiteLabelEnabled: boolean;
  embedEnabled: boolean;
  apiEnabled: boolean;
}

export const AUDIT_PROFILES: Record<AuditProfile['id'], AuditProfile> = {
  free_quick: {
    id: 'free_quick',
    label: 'Free Lightweight Audit',
    plan: 'free',
    processingTier: 'free',
    mode: 'quick',
    pageLimit: 5,
    concurrency: 1,
    timeoutMs: 5000,
    maxEvents: 100,
    maxIssues: 150,
    externalLinkChecks: false,
    deepSitemapExpansion: false,
    exposedFileChecks: false,
    pdfEnabled: false,
    whiteLabelEnabled: false,
    embedEnabled: false,
    apiEnabled: false,
  },
  paid_standard: {
    id: 'paid_standard',
    label: 'Paid Full Audit',
    plan: 'paid',
    processingTier: 'paid',
    mode: 'standard',
    pageLimit: 50,
    concurrency: 2,
    timeoutMs: 8000,
    maxEvents: 300,
    maxIssues: 1000,
    externalLinkChecks: false,
    deepSitemapExpansion: false,
    exposedFileChecks: true,
    pdfEnabled: true,
    whiteLabelEnabled: true,
    embedEnabled: false,
    apiEnabled: false,
  },
  agency_deep: {
    id: 'agency_deep',
    label: 'Agency Deep Audit',
    plan: 'agency',
    processingTier: 'agency',
    mode: 'deep',
    pageLimit: 75,
    concurrency: 4,
    timeoutMs: 12000,
    maxEvents: 800,
    maxIssues: 4000,
    externalLinkChecks: false,
    deepSitemapExpansion: true,
    exposedFileChecks: true,
    pdfEnabled: true,
    whiteLabelEnabled: true,
    embedEnabled: true,
    apiEnabled: true,
  },
  admin_deep: {
    id: 'admin_deep',
    label: 'Admin Deep Audit',
    plan: 'admin',
    processingTier: 'admin',
    mode: 'deep',
    pageLimit: 100,
    concurrency: 4,
    timeoutMs: 12000,
    maxEvents: 1500,
    maxIssues: 7000,
    externalLinkChecks: false,
    deepSitemapExpansion: true,
    exposedFileChecks: true,
    pdfEnabled: true,
    whiteLabelEnabled: true,
    embedEnabled: true,
    apiEnabled: true,
  },
};

export function auditProfileIdFor(plan: UserPlan, mode: AuditMode): AuditProfile['id'] {
  if (plan === 'admin') return mode === 'deep' ? 'admin_deep' : 'paid_standard';
  if (plan === 'agency') return mode === 'deep' ? 'agency_deep' : 'paid_standard';
  if (plan === 'paid') return 'paid_standard';
  return 'free_quick';
}

export function getAuditProfile(plan: UserPlan, mode: AuditMode) {
  return AUDIT_PROFILES[auditProfileIdFor(plan, mode)];
}

export function getAuditProfileForDocument(audit: Pick<ResourceAuditDocument, 'plan' | 'effectiveMode' | 'mode'>) {
  return getAuditProfile(audit.plan || 'free', audit.effectiveMode || audit.mode || 'quick');
}

export function isSeoIssueAllowedForProfile(profile: AuditProfile, issue: { category?: string; id?: string }) {
  if (profile.processingTier !== 'free') return true;
  const category = String(issue.category || '').toLowerCase();
  const id = String(issue.id || '').toLowerCase();
  return (
    category.includes('on-page') ||
    category.includes('content') ||
    category.includes('images') ||
    category.includes('indexability') ||
    category.includes('robots') ||
    category.includes('sitemap') ||
    category.includes('security') ||
    category.includes('accessibility') ||
    id.includes('title') ||
    id.includes('meta') ||
    id.includes('h1') ||
    id.includes('canonical') ||
    id.includes('noindex') ||
    id.includes('alt')
  );
}
