import { Router } from 'express';

import { createHash, randomBytes } from 'node:crypto';

import { normalizeUserUrl } from '../lib/seo/url-utils';

import { isCompletedAuditStatus } from '../lib/audit/audit-time';

import { planAuditLiveDelta } from '../lib/audit/live-delta';

import { projectAuditAdmission, projectAuditStatus } from '../lib/audit/audit-admission';

import { auditRepository } from '../lib/supabase/audit-repository';

import { scalableReadiness } from '../lib/supabase/scalable-audit-repository';

import { isSupabaseAdminEnabled, requireSupabaseAdminClient } from '../lib/supabase/server';

import { AUDIT_MODE_PAGE_CEILINGS, createAuditRuntimeCapabilities, isAuditMode, type AuditMode } from '../lib/audit/resource-types';

import { EntitlementError, canStartAudit, consumeAuditQuota, ensureUserProfileFromAuthUser, getAuthenticatedUserFromRequest, getPlanLimits } from '../lib/billing/entitlements';

import type { ResourceAuditDocument } from '../lib/audit/resource-types';

import { createRateLimiter } from '../lib/api/http-hardening';

import { ApiError } from '../lib/api/errors';

import { admitAuditSubmission, assertAuditDeploymentCompatible, durableRateLimit, releaseAuditAdmission, requestNetworkHash, verifyBotToken } from '../lib/api/production-controls';

import { publicVersionPayload } from '../lib/platform/version';

import { findingWorkflowKey, isFindingPriorityOverride, isFindingWorkflowStatus } from '../lib/audit/finding-workflow';

import { createPublicPlanProjection } from '../lib/plans/public-plan-presentation';
import { auditScopeFingerprint, normalizeAuditScope } from '../lib/audit/audit-scope';


export const apiRouter = Router();


const DUPLICATE_AUDIT_WINDOW_MS = 10 * 60 * 1000;

function asyncJsonRoute(handler: any) {
  return async (req: any, res: any, next: any) => {
    try {
      await handler(req, res, next);
    } catch (error: unknown) {
      next(error);
    }
  };
}

function firstHeaderValue(value: unknown) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function hashGuestValue(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function requestOrigin(req: any) {
  const configured = [
    process.env.APP_URL || '',
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '',
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
  ];
  for (const value of configured) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:') return url.origin;
    } catch {}
  }
  if (process.env.NODE_ENV === 'production') return '';
  const proto = firstHeaderValue(req.headers?.['x-forwarded-proto']) || 'http';
  const host = firstHeaderValue(req.headers?.['x-forwarded-host']) || firstHeaderValue(req.headers?.host);
  try {
    const url = new URL(`${proto}://${host}`);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname) ? url.origin : '';
  } catch {
    return '';
  }
}

function getCookieValue(req: any, name: string) {
  if (req.cookies?.[name]) return String(req.cookies[name]);
  const cookieHeader = firstHeaderValue(req.headers?.cookie);
  const match = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

function guestIdentityForRequest(req: any) {
  const explicitGuestId = firstHeaderValue(req.headers?.['x-crawlio-guest-id'])
    || firstHeaderValue(req.headers?.['x-seointel-guest-id'])
    || getCookieValue(req, 'crawlio_guest_id')
    || getCookieValue(req, 'seointel_guest_id');
  if (explicitGuestId) {
    const guestKeyHash = hashGuestValue(`guest-session:${explicitGuestId.slice(0, 128)}`);
    return { guestKey: `guest:${guestKeyHash}`, guestKeyHash };
  }

  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const userAgent = firstHeaderValue(req.headers?.['user-agent']).slice(0, 256);
  const fallback = `${forwarded || req.ip || req.socket?.remoteAddress || 'unknown'}|${userAgent}`;
  const guestKeyHash = hashGuestValue(`guest-network:${fallback}`);
  return { guestKey: `guest:${guestKeyHash}`, guestKeyHash };
}

function isDeepAuditEnabled() {
  return process.env.DEEP_AUDIT_ENABLED === 'true';
}

async function getRequester(req: any) {
  const authUser = await getAuthenticatedUserFromRequest(req);
  if (!authUser) return { userId: null, profile: null };
  req.requesterUserId = authUser.id;
  const profile = await ensureUserProfileFromAuthUser(authUser);
  return { userId: authUser.id, profile };
}

async function canAccessAudit(req: any, audit: ResourceAuditDocument) {
  const requester = await getRequester(req);
  if (requester.profile?.role === 'admin') return true;
  if (audit.userId) return requester.userId === audit.userId;
  if (audit.guestKeyHash) return guestIdentityForRequest(req).guestKeyHash === audit.guestKeyHash;
  return false;
}

function workflowRow(row: any) {
  return {
    id: row.id,
    auditId: row.audit_id,
    findingId: row.finding_id ?? null,
    findingKey: row.finding_key,
    status: row.status,
    priorityOverride: row.priority_override ?? null,
    notes: row.notes || '',
    dueAt: row.due_at ?? null,
    assignedTo: row.assigned_to ?? null,
    resolvedAt: row.resolved_at ?? null,
    resolvedBy: row.resolved_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    version: Number(row.version || 1),
  };
}

async function requireWorkflowAudit(req: any, res: any) {
  const requester = await getRequester(req);
  if (!requester.userId) {
    res.status(401).json({ success: false, error: 'Sign in to persist finding workflow.' });
    return null;
  }
  const audit = await auditRepository.getAuditJob(String(req.params.id || ''));
  const ownsAudit = audit?.userId === requester.userId;
  if (!audit || (!ownsAudit && requester.profile?.role !== 'admin')) {
    res.status(404).json({ success: false, error: 'Audit not found.' });
    return null;
  }
  if (!audit.userId) {
    res.status(403).json({ success: false, error: 'Guest finding workflow is stored on this device. Sign in before starting an audit to sync it.' });
    return null;
  }
  return { audit, requester };
}

function sendEntitlementError(res: any, error: unknown) {
  if (error instanceof EntitlementError) {
    throw new ApiError(error.upgradeRequired ? 'PLAN_LIMIT_REACHED' : 'AUDIT_LIMIT_REACHED', error.message, error.status);
  }
  throw error;
}

function admissionError(decision: { code: string; retryAfterSeconds?: number }) {
  const retryAfterSeconds = Math.max(1, Number(decision.retryAfterSeconds || 60));
  const mapping: Record<string, [string, string, number]> = {
    DAILY_QUOTA_REACHED: ['DAILY_QUOTA_REACHED', 'You have reached today\'s audit limit.', 429],
    DOMAIN_DAILY_LIMIT: ['DOMAIN_DAILY_LIMIT', 'This website has reached its audit limit for today.', 429],
    QUEUE_FULL: ['AUDIT_QUEUE_FULL', 'The audit queue is currently full. Please try again later.', 429],
    MAINTENANCE: ['AUDIT_MAINTENANCE', 'The audit service is temporarily unavailable for maintenance.', 503],
    FREE_SUBMISSIONS_PAUSED: ['FREE_AUDITS_PAUSED', 'New Free audits are temporarily paused.', 503],
    BOT_VERIFICATION_REQUIRED: ['BOT_VERIFICATION_REQUIRED', 'Please complete the verification check before starting another audit.', 403],
    GUEST_AUDITS_DISABLED: ['GUEST_AUDITS_DISABLED', 'Guest audits are temporarily unavailable. Sign in and try again.', 403],
    AUDIT_MODE_DISABLED: ['AUDIT_MODE_DISABLED', 'This audit type is temporarily unavailable.', 503],
    ACTIVE_AUDIT_EXISTS: ['ACTIVE_AUDIT_EXISTS', 'You already have an audit in progress.', 429],
  };
  const [code, message, status] = mapping[decision.code] || ['AUDIT_ADMISSION_DENIED', 'The audit could not be admitted right now.', 429];
  return new ApiError(code, message, status, { retryAfterSeconds });
}

function auditStartResponseData(audit: ResourceAuditDocument, extras: Record<string, unknown> = {}) {
  return {
    auditId: audit.id,
    status: audit.status,
    submittedInput: audit.submittedInput,
    normalizedUrl: audit.normalizedUrl,
    hostname: audit.hostname,
    requestedMode: audit.requestedMode,
    effectiveMode: audit.effectiveMode,
    plan: audit.plan,
    pageLimit: audit.pageLimit,
    planPageLimit: audit.planPageLimit || audit.pageLimit,
    scope: audit.scope || null,
    scopeFingerprint: auditScopeFingerprint(audit.scope),
    queuePriority: audit.queuePriority,
    ...extras,
  };
}

apiRouter.get('/me/profile', asyncJsonRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!isSupabaseAdminEnabled()) throw new ApiError('PROFILE_SERVICE_UNAVAILABLE', 'Account profile services are temporarily unavailable.', 503);
  const authUser = await getAuthenticatedUserFromRequest(req);
  if (!authUser) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  const profile = await ensureUserProfileFromAuthUser(authUser);
  const limits = await getPlanLimits(profile.plan);
  const readiness = await scalableReadiness().catch(() => ({ ready: false, deepReady: false, scopeReady: false, scopeDeepReady: false }));
  const auditCapabilities = createAuditRuntimeCapabilities(isDeepAuditEnabled() || (readiness.ready && readiness.deepReady), readiness, profile.plan);
  res.json({ success: true, data: {
    profile,
    limits: {
      ...limits,
      maxPagesQuick: Math.min(limits.maxPagesQuick, auditCapabilities.pageCeilings.quick),
      maxPagesStandard: Math.min(limits.maxPagesStandard, auditCapabilities.pageCeilings.standard),
      maxPagesDeep: Math.min(limits.maxPagesDeep, auditCapabilities.pageCeilings.deep),
    },
    auditCapabilities,
  } });
}));

apiRouter.post('/me/delete', durableRateLimit({ namespace: 'account-delete', limit: 3, windowSeconds: 3600 }), asyncJsonRoute(async (req, res) => {
  const authUser = await getAuthenticatedUserFromRequest(req);
  if (!authUser) throw new ApiError('AUTHENTICATION_REQUIRED', 'Authentication is required.', 401);
  req.requesterUserId = authUser.id;
  if (req.body?.confirmation !== 'DELETE') throw new ApiError('ACCOUNT_DELETE_CONFIRMATION_REQUIRED', 'Enter DELETE to confirm account deletion.', 400);
  const requester = await getRequester(req);
  if (requester.profile?.role === 'admin') throw new ApiError('ADMIN_TRANSFER_REQUIRED', 'Transfer or remove administrator access before deleting this account.', 409);
  const lastSignIn = new Date(authUser.last_sign_in_at || 0).getTime();
  if (!Number.isFinite(lastSignIn) || Date.now() - lastSignIn > 30 * 60 * 1000) {
    throw new ApiError('RECENT_LOGIN_REQUIRED', 'Sign in again before deleting your account.', 403);
  }
  const client = requireSupabaseAdminClient();
  await client.from('user_profiles').update({ deletion_requested_at: new Date().toISOString() }).eq('id', authUser.id);
  const { data, error } = await client.rpc('delete_user_owned_data', { p_user_id: authUser.id });
  if (error) throw error;
  const { error: authDeleteError } = await client.auth.admin.deleteUser(authUser.id);
  if (authDeleteError) throw authDeleteError;
  res.setHeader('Clear-Site-Data', '"cache", "cookies", "storage"');
  res.json({ success: true, data });
}));

apiRouter.get('/version', asyncJsonRoute(async (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json({ success: true, data: publicVersionPayload() });
}));

apiRouter.get('/plans/public', asyncJsonRoute(async (req, res) => {
  const client = requireSupabaseAdminClient();
  const { data, error } = await client
    .from('plan_limits')
    .select('plan,daily_audits,monthly_audits,max_pages_quick,max_pages_standard,max_pages_deep,allowed_modes,exports_enabled,pdf_enabled,scheduled_audits_enabled,updated_at')
    .in('plan', ['free', 'paid', 'agency']);
  if (error) throw error;
  const latestUpdate = (data || [])
    .map((row: any) => String(row.updated_at || ''))
    .filter(Boolean)
    .sort()
    .at(-1) || new Date().toISOString();
  const readiness = await scalableReadiness().catch(() => ({ ready: false, deepReady: false, scopeReady: false, scopeDeepReady: false }));
  const capabilities = createAuditRuntimeCapabilities(isDeepAuditEnabled() || (readiness.ready && readiness.deepReady), readiness);
  const projection = createPublicPlanProjection(
    data || [],
    latestUpdate,
    capabilities.availableModes,
    capabilities.pageCeilings,
  );
  const serialized = JSON.stringify(projection);
  const etag = `\"${createHash('sha256').update(serialized).digest('base64url')}\"`;
  res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=30, must-revalidate');
  res.setHeader('ETag', etag);
  if (firstHeaderValue(req.headers?.['if-none-match']) === etag) return res.status(304).end();
  res.json({ success: true, data: projection });
}));

async function startQueuedAudit(req: any, res: any, defaultMode: AuditMode = 'quick') {
  const { url, mode = defaultMode, projectId = null } = req.body || {};
  let scope;
  try { scope = normalizeAuditScope(req.body?.scope, req.body?.type); }
  catch (error) { throw new ApiError('INVALID_AUDIT_SCOPE', error instanceof Error ? error.message : 'Choose supported audit checks.', 400); }
  const fingerprint = auditScopeFingerprint(scope);
  const normalized = normalizeUserUrl(String(url || ''), {
    allowPrivateForTesting: process.env.SEOINTEL_ALLOW_PRIVATE_TEST_TARGETS === 'true',
  });
  if (!normalized.isValid) {
    throw new ApiError('INVALID_AUDIT_TARGET', normalized.error || 'Enter a valid public website or domain.', 400);
  }

  if (!isAuditMode(mode)) {
    throw new ApiError('INVALID_AUDIT_MODE', 'Choose Quick, Standard, or Deep audit mode.', 400);
  }
  const requestedMode = mode;
  const reuseOrConflict = (existing: ResourceAuditDocument) => {
    if (existing.normalizedUrl !== normalized.normalizedUrl || existing.effectiveMode !== requestedMode || auditScopeFingerprint(existing.scope) !== fingerprint) {
      throw new ApiError('ACTIVE_AUDIT_CONFLICT', 'Another audit is active with different checks, coverage, depth or website. Open it or wait for it to finish before starting this request.', 409, { activeAuditId: existing.id });
    }
    return res.json({ success: true, data: auditStartResponseData(existing, { reusedExistingAudit: true }) });
  };
  const { userId } = await getRequester(req);
  let validatedProjectId: string | null = null;
  if (projectId != null) {
    if (!userId) throw new ApiError('PROJECT_AUTHENTICATION_REQUIRED', 'Sign in to attach an audit to a project.', 401);
    const projectResult = await requireSupabaseAdminClient().from('projects').select('id,hostname').eq('id', String(projectId)).eq('user_id', userId).maybeSingle();
    if (projectResult.error) throw projectResult.error;
    if (!projectResult.data) throw new ApiError('PROJECT_NOT_FOUND', 'Project not found.', 404);
    if (String(projectResult.data.hostname || '').toLowerCase() !== normalized.hostname.toLowerCase()) {
      throw new ApiError('PROJECT_DOMAIN_MISMATCH', 'The audit website must match the selected project.', 400);
    }
    validatedProjectId = projectResult.data.id;
  }
  const guestIdentity = guestIdentityForRequest(req);
  const ownerLookup = userId
    ? { userId, guestKeyHash: null }
    : { userId: null, guestKeyHash: guestIdentity.guestKeyHash };
  const createdAfterIso = new Date(Date.now() - DUPLICATE_AUDIT_WINDOW_MS).toISOString();

  const readiness = await scalableReadiness().catch(() => ({ ready: false, deepReady: false, scopeReady: false, scopeDeepReady: false }));
  let decision;
  try {
    decision = await canStartAudit(userId, requestedMode, {
      guestKey: guestIdentity.guestKey,
      // Check runtime availability below so unavailable larger audits receive a 503, not an upgrade error.
      deepAuditEnabled: true,
    });
  } catch (error) {
    if (error instanceof EntitlementError && /already have an audit in progress/i.test(error.message)) {
      const activeAudit = await auditRepository.findActiveAuditForOwner(ownerLookup);
      if (activeAudit) {
        return reuseOrConflict(activeAudit);
      }
    }
    return sendEntitlementError(res, error);
  }

  const processingVersion = readiness.ready && (decision.effectiveMode !== 'deep' || readiness.deepReady) ? 2 : 1;
  if (scope && (!readiness.scopeReady || (decision.effectiveMode === 'deep' && !readiness.scopeDeepReady))) {
    throw new ApiError('FOCUSED_AUDIT_UNAVAILABLE', 'Selected-check audits require migration 034 and a live compatible worker. Your request was not changed into a full audit.', 503, { retryAfterSeconds: 60 });
  }
  const effectivePageLimit = scope?.coverage === 'page' ? 1 : decision.pageLimit;
  const legacyPageCeiling = AUDIT_MODE_PAGE_CEILINGS[decision.effectiveMode];
  if (processingVersion === 1 && decision.pageLimit > legacyPageCeiling) {
    throw new ApiError('SCALABLE_AUDIT_UNAVAILABLE', `The requested ${decision.pageLimit} pages exceed the legacy ${legacyPageCeiling}-page limit. The scalable audit migration or a live compatible v2 worker is unavailable, or scalable audits are disabled.`, 503, {
      retryAfterSeconds: 120,
    });
  }
  if (processingVersion === 1 && decision.effectiveMode === 'deep' && !isDeepAuditEnabled()) {
    throw new ApiError('DEEP_AUDIT_UNAVAILABLE', 'Deep audits require a live compatible worker or the dedicated legacy engine.', 503, { retryAfterSeconds: 120 });
  }

  let admission: Awaited<ReturnType<typeof admitAuditSubmission>> | null = null;
  if (isSupabaseAdminEnabled()) {
    await assertAuditDeploymentCompatible();
    admission = await admitAuditSubmission({
      userId,
      guestKeyHash: userId ? null : guestIdentity.guestKeyHash,
      ipHash: requestNetworkHash(req),
      normalizedDomain: normalized.hostname,
      normalizedUrl: normalized.normalizedUrl,
      auditMode: decision.effectiveMode,
      plan: decision.plan,
      dailyLimit: userId ? decision.limits.dailyAudits : Number(process.env.GUEST_DAILY_AUDIT_LIMIT || 2),
      domainDailyLimit: Number(process.env.DOMAIN_DAILY_AUDIT_LIMIT || 2),
      activeLimit: decision.plan === 'free' ? 1 : Math.max(1, decision.limits.concurrency),
      globalActiveLimit: Number(process.env.GLOBAL_ACTIVE_AUDIT_LIMIT || 50),
      botVerified: await verifyBotToken(String(req.body?.botToken || '')),
      ...(readiness.scopeReady ? { scopeFingerprint: fingerprint } : {}),
    });

    if (admission.reusedExistingAudit) {
      let existing: ResourceAuditDocument | null = null;
      for (let attempt = 0; attempt < 20 && !existing; attempt += 1) {
        existing = await auditRepository.getAudit(admission.auditId);
        if (!existing) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (existing) return reuseOrConflict(existing);
      return res.status(202).json({ success: true, data: {
        auditId: admission.auditId,
        status: 'queued',
        submittedInput: String(url || '').trim(),
        normalizedUrl: normalized.normalizedUrl,
        hostname: normalized.hostname,
        requestedMode: decision.requestedMode,
        effectiveMode: decision.effectiveMode,
        plan: decision.plan,
        pageLimit: effectivePageLimit,
        planPageLimit: decision.pageLimit,
        scope: scope || null,
        scopeFingerprint: fingerprint,
        queuePriority: decision.queuePriority,
        reusedExistingAudit: true,
      }});
    }
    if (!admission.allowed) {
      if (admission.code === 'ACTIVE_AUDIT_EXISTS' && admission.auditId) {
        const existing = await auditRepository.getAudit(admission.auditId);
        if (existing) {
          return reuseOrConflict(existing);
        }
        throw new ApiError('ACTIVE_AUDIT_CONFLICT', 'Another audit submission is being accepted. Wait a moment and try again.', 409);
      }
      throw admissionError(admission);
    }
  } else if (process.env.NODE_ENV === 'production') {
    throw new ApiError('AUDIT_ADMISSION_UNAVAILABLE', 'The audit service is being updated. Please try again shortly.', 503, { retryAfterSeconds: 120 });
  } else {
    const duplicateAudit = await auditRepository.findActiveDuplicateAudit({ ...ownerLookup, normalizedUrl: normalized.normalizedUrl, createdAfterIso, mode: requestedMode, scopeFingerprint: fingerprint });
    if (duplicateAudit) return reuseOrConflict(duplicateAudit);
    const activeAudit = await auditRepository.findActiveAuditForOwner(ownerLookup);
    if (activeAudit) return reuseOrConflict(activeAudit);
  }

  let audit: ResourceAuditDocument;
  try {
    audit = await auditRepository.createAuditJob({
      id: admission?.auditId,
      processingVersion,
      scope,
      planPageLimit: decision.pageLimit,
      submittedInput: String(url || '').trim(),
      normalizedUrl: normalized.normalizedUrl,
      hostname: normalized.hostname,
      mode: decision.effectiveMode,
      requestedMode: decision.requestedMode,
      effectiveMode: decision.effectiveMode,
      plan: decision.plan,
      processingTier: decision.processingTier,
      pageLimit: effectivePageLimit,
      queuePriority: decision.queuePriority,
      estimatedWaitSeconds: admission?.queueDepth ? Math.max(0, admission.queueDepth - 1) * 45 : null,
      userId: decision.userId,
      guestKeyHash: decision.userId ? null : guestIdentity.guestKeyHash,
      projectId: validatedProjectId,
    });
  } catch (error) {
    if (admission?.auditId) await releaseAuditAdmission(admission.auditId, 'AUDIT_CREATE_FAILED');
    throw error;
  }

  try {
    await consumeAuditQuota(decision.userId, audit.id, decision.effectiveMode, {
      plan: decision.plan,
      pagesLimit: decision.pageLimit,
      guestKey: guestIdentity.guestKey,
    });
    await auditRepository.updateAudit(audit.id, { quotaCounted: true });
  } catch (error) {
    await auditRepository.addInternalDiagnostic({
      auditId: audit.id,
      affectedUrl: audit.normalizedUrl,
      failureCode: 'QUOTA_COUNTER_SYNC_FAILED',
      phase: 'admission',
      attemptCount: 1,
      internalDetails: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  }

  res.json({
    success: true,
    data: {
      ...auditStartResponseData(audit),
      initialAudit: projectAuditAdmission(audit),
      quotaRemaining: decision.quotaRemaining,
      reusedExistingAudit: false,
      queueDepth: admission?.queueDepth ?? null,
      softQueueWarning: admission?.softQueueWarning ?? false,
    },
  });
}

apiRouter.post('/audit/start', asyncJsonRoute((req, res) => startQueuedAudit(req, res, 'quick')));

apiRouter.get('/audit/events/:id', asyncJsonRoute(async (req, res) => {
  const auditId = req.params.id;
  const audit = await auditRepository.getAudit(auditId);
  if (!audit || !(await canAccessAudit(req, audit))) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  const requestedLimit = Number(req.query.limit || 50);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 50;
  const events = await auditRepository.getEvents(auditId, limit);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { auditId, events } });
}));

apiRouter.get('/audit/status/:id', asyncJsonRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const compact = String(req.query.compact || '') === '1';
  const audit = compact ? await auditRepository.getAuditStatusDocument(req.params.id) : await auditRepository.getAudit(req.params.id);
  if (!audit || !(await canAccessAudit(req, audit))) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  if (String(req.query.delta || '') === '1') {
    const delta = planAuditLiveDelta(audit, {
      pagesCrawled: Number(req.query.knownPagesCrawled || 0),
      issuesFound: Number(req.query.knownIssuesFound || 0),
      status: String(req.query.knownStatus || ''),
      updatedAt: String(req.query.knownUpdatedAt || ''),
      hasReport: String(req.query.hasReport || '') === '1',
    });
    const [latestEvents, latestPages, latestIssues, finalReport] = await Promise.all([
      delta.eventsNeeded ? auditRepository.getLatestEvents(audit.id, 50) : Promise.resolve(undefined),
      delta.pagesChanged ? auditRepository.getLatestPages(audit.id, 100) : Promise.resolve(undefined),
      delta.issuesChanged ? auditRepository.getLatestIssues(audit.id, 100) : Promise.resolve(undefined),
      delta.reportNeeded ? auditRepository.getFinalReport(audit.id) : Promise.resolve(undefined),
    ]);
    return res.json({ success: true, data: {
      partial: true,
      audit: compact ? projectAuditStatus(audit) : audit,
      ...(latestEvents ? { latestEvents } : {}),
      ...(latestPages ? { latestPages } : {}),
      ...(latestIssues ? { latestIssues } : {}),
      ...(finalReport !== undefined ? { finalReport } : {}),
    } });
  }
  const liveData = await auditRepository.getLiveData(req.params.id, audit);
  res.json({ success: true, data: compact ? { ...liveData, audit: projectAuditStatus(audit) } : liveData });
}));

apiRouter.post('/audit/cancel/:id', asyncJsonRoute(async (req, res) => {
  const audit = await auditRepository.getAudit(req.params.id);
  if (!audit || !(await canAccessAudit(req, audit))) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  if (!['queued', 'running'].includes(audit.status)) throw new ApiError('AUDIT_NOT_CANCELLABLE', 'Only an active audit can be cancelled.', 409);
  if (!(await auditRepository.cancelAudit(req.params.id))) throw new ApiError('AUDIT_NOT_CANCELLABLE', 'The audit is no longer active.', 409);
  res.json({ success: true, data: { auditId: req.params.id, status: 'cancelled' } });
}));

apiRouter.get('/audit/result/:id', asyncJsonRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const audit = await auditRepository.getAudit(req.params.id);
  if (!audit || !(await canAccessAudit(req, audit))) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  const liveData = await auditRepository.getLiveData(req.params.id, audit);
  res.json({ success: true, data: liveData });
}));

apiRouter.post('/audit/:id/share', durableRateLimit({ namespace: 'report-share', limit: 20, windowSeconds: 3600 }), asyncJsonRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const audit = await auditRepository.getAudit(req.params.id);
  if (!audit || !(await canAccessAudit(req, audit))) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  if (!audit.userId) throw new ApiError('REPORT_SHARE_SIGN_IN_REQUIRED', 'Sign in before creating a shareable report.', 401);
  if (!isCompletedAuditStatus(audit.status)) throw new ApiError('REPORT_SHARE_NOT_READY', 'The report can be shared after the audit completes.', 409);
  const origin = requestOrigin(req);
  if (!origin) throw new ApiError('APPLICATION_ORIGIN_UNAVAILABLE', 'The application URL is not configured.', 503);
  const days = Math.max(1, Math.min(30, Math.floor(Number(req.body?.expiresInDays || 7))));
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  const client = requireSupabaseAdminClient();
  await client.from('report_shares').delete().eq('user_id', audit.userId).lt('expires_at', new Date().toISOString());
  const result = await client.from('report_shares').insert({ audit_id: audit.id, project_id: audit.projectId, user_id: audit.userId, token_hash: createHash('sha256').update(token).digest('hex'), expires_at: expiresAt }).select('id').single();
  if (result.error) throw result.error;
  res.json({ success: true, data: { shareId: result.data.id, shareUrl: `${origin}/share/${token}`, expiresAt } });
}));

apiRouter.get('/shared-reports/:token', createRateLimiter({ namespace: 'shared-reports', windowMs: 60 * 60 * 1000, maxRequests: 120 }), asyncJsonRoute(async (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) throw new ApiError('SHARED_REPORT_NOT_FOUND', 'Shared report not found.', 404);
  const client = requireSupabaseAdminClient();
  const shareResult = await client.from('report_shares').select('id,audit_id,expires_at,revoked_at,view_count').eq('token_hash', createHash('sha256').update(token).digest('hex')).is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (shareResult.error) throw shareResult.error;
  if (!shareResult.data) throw new ApiError('SHARED_REPORT_NOT_FOUND', 'This report link is invalid or expired.', 404);
  const [audit, report, pages, issues] = await Promise.all([
    auditRepository.getAudit(shareResult.data.audit_id),
    auditRepository.getFinalReport(shareResult.data.audit_id),
    auditRepository.getLatestPages(shareResult.data.audit_id, 100),
    auditRepository.getLatestIssues(shareResult.data.audit_id, 500),
  ]);
  if (!audit || !report || !isCompletedAuditStatus(audit.status)) throw new ApiError('SHARED_REPORT_NOT_FOUND', 'Shared report not found.', 404);
  await client.from('report_shares').update({ last_viewed_at: new Date().toISOString(), view_count: Number(shareResult.data.view_count || 0) + 1 }).eq('id', shareResult.data.id).eq('view_count', shareResult.data.view_count || 0);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: {
    audit: { id: audit.id, normalizedUrl: audit.normalizedUrl, hostname: audit.hostname, effectiveMode: audit.effectiveMode, status: audit.status, pagesCrawled: audit.pagesCrawled, issuesFound: audit.issuesFound, criticalCount: audit.criticalCount, highCount: audit.highCount, mediumCount: audit.mediumCount, lowCount: audit.lowCount, completedAt: audit.completedAt },
    report,
    pages,
    issues,
    expiresAt: shareResult.data.expires_at,
  } });
}));

apiRouter.get('/audit/:id/finding-workflow', asyncJsonRoute(async (req, res) => {
  const access = await requireWorkflowAudit(req, res);
  if (!access) return;
  const client = requireSupabaseAdminClient();
  const { data, error } = await client
    .from('audit_finding_workflow')
    .select('id,audit_id,finding_id,finding_key,status,priority_override,notes,due_at,assigned_to,resolved_at,resolved_by,created_at,updated_at,updated_by,version')
    .eq('audit_id', access.audit.id)
    .order('updated_at', { ascending: false })
    .limit(1000);
  if (error) throw error;
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { records: (data || []).map(workflowRow), persistent: true } });
}));

apiRouter.put('/audit/:id/finding-workflow/:findingKey', durableRateLimit({ namespace: 'finding-workflow', limit: 120, windowSeconds: 60 }), asyncJsonRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const access = await requireWorkflowAudit(req, res);
  if (!access) return;
  const key = String(req.params.findingKey || '').trim().toLowerCase();
  if (!key || key.length > 512) throw new ApiError('INVALID_FINDING_KEY', 'Finding key is invalid.', 400);
  const status = req.body?.status;
  if (!isFindingWorkflowStatus(status)) throw new ApiError('INVALID_WORKFLOW_STATUS', 'Workflow status is invalid.', 400);
  const notes = String(req.body?.notes || '').trim().slice(0, 2000);
  const priorityOverride = req.body?.priorityOverride == null || req.body.priorityOverride === '' ? null : req.body.priorityOverride;
  if (priorityOverride && !isFindingPriorityOverride(priorityOverride)) throw new ApiError('INVALID_PRIORITY_OVERRIDE', 'Priority override is invalid.', 400);
  let dueAt: string | null = null;
  if (req.body?.dueAt) {
    const parsedDueAt = new Date(req.body.dueAt);
    if (!Number.isFinite(parsedDueAt.getTime())) throw new ApiError('INVALID_DUE_DATE', 'Due date is invalid.', 400);
    dueAt = parsedDueAt.toISOString();
  }
  const assignedTo = req.body?.assignedToSelf === true ? access.audit.userId : null;

  const finding = access.audit.processingVersion === 2
    ? await auditRepository.getWorkflowFinding(access.audit.id, key)
    : (await auditRepository.getLatestIssues(access.audit.id, 1000)).find((issue) => findingWorkflowKey(issue) === key);
  if (!finding) throw new ApiError('FINDING_NOT_FOUND', 'Finding not found for this audit.', 404);

  const client = requireSupabaseAdminClient();
  const existingResult = await client
    .from('audit_finding_workflow')
    .select('id,version')
    .eq('audit_id', access.audit.id)
    .eq('finding_key', key)
    .maybeSingle();
  if (existingResult.error) throw existingResult.error;
  const terminal = ['fixed', 'ignored', 'accepted_risk'].includes(status);
  const now = new Date().toISOString();
  let saved: any;

  if (existingResult.data) {
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(existingResult.data.version)) {
      throw new ApiError('WORKFLOW_CONFLICT', 'This finding changed in another tab. Reload it before saving again.', 409);
    }
    const result = await client
      .from('audit_finding_workflow')
      .update({
        finding_id: finding.id,
        status,
        priority_override: priorityOverride,
        notes,
        due_at: dueAt,
        assigned_to: assignedTo,
        resolved_at: terminal ? now : null,
        resolved_by: terminal ? access.requester.userId : null,
        updated_by: access.requester.userId,
        version: expectedVersion + 1,
      })
      .eq('id', existingResult.data.id)
      .eq('version', expectedVersion)
      .select('*')
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new ApiError('WORKFLOW_CONFLICT', 'This finding changed in another tab. Reload it before saving again.', 409);
    saved = result.data;
  } else {
    const result = await client.from('audit_finding_workflow').insert({
      audit_id: access.audit.id,
      finding_id: finding.id,
      finding_key: key,
      user_id: access.audit.userId,
      status,
      priority_override: priorityOverride,
      notes,
      due_at: dueAt,
      assigned_to: assignedTo,
      resolved_at: terminal ? now : null,
      resolved_by: terminal ? access.requester.userId : null,
      created_by: access.requester.userId,
      updated_by: access.requester.userId,
    }).select('*').single();
    if (result.error) {
      if (result.error.code === '23505') throw new ApiError('WORKFLOW_CONFLICT', 'This finding changed in another tab. Reload it before saving again.', 409);
      throw result.error;
    }
    saved = result.data;
  }
  res.json({ success: true, data: { record: workflowRow(saved) } });
}));

apiRouter.post('/audit/archive/:id', asyncJsonRoute(async (req, res) => {
  const audit = await auditRepository.getAudit(req.params.id);
  if (!audit || !(await canAccessAudit(req, audit))) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  if (!isCompletedAuditStatus(audit.status) && !['failed', 'cancelled', 'abandoned'].includes(audit.status)) {
    throw new ApiError('AUDIT_NOT_ARCHIVABLE', 'Finish or cancel the audit before archiving it.', 409);
  }
  const archivedAt = req.body?.archived === false ? null : new Date().toISOString();
  await auditRepository.updateAudit(audit.id, { archivedAt });
  res.json({ success: true, data: { auditId: audit.id, archivedAt } });
}));

apiRouter.delete('/audit/:id', durableRateLimit({ namespace: 'audit-delete', limit: 20, windowSeconds: 3600 }), asyncJsonRoute(async (req, res) => {
  const audit = await auditRepository.getAudit(req.params.id);
  if (!audit || !(await canAccessAudit(req, audit))) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  if (['queued', 'running'].includes(audit.status)) throw new ApiError('ACTIVE_AUDIT_DELETE_BLOCKED', 'Cancel the active audit before deleting it.', 409);
  const client = requireSupabaseAdminClient();
  const { error } = await client.from('audits').delete().eq('id', audit.id);
  if (error) throw error;
  res.json({ success: true, data: { auditId: audit.id, deleted: true } });
}));

apiRouter.get('/audits/history', asyncJsonRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const requester = await getRequester(req);
  if (!requester.userId) return res.status(401).json({ success: false, error: 'Authentication required.' });
  const allowedStatuses = new Set(['queued', 'running', 'completed', 'completed_with_warnings', 'failed', 'cancelled', 'abandoned']);
  const requestedStatus = String(req.query.status || '');
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : undefined;
  const hostname = String(req.query.hostname || '').trim().toLowerCase().slice(0, 253) || undefined;
  const data = await auditRepository.listAuditHistoryForUser({
    userId: requester.userId,
    status,
    hostname,
    includeArchived: req.query.archived === 'true',
    summaryOnly: req.query.view === 'summary',
    limit: Number(req.query.limit || 25),
    offset: Number(req.query.offset || 0),
  });
  res.json({ success: true, data });
}));

apiRouter.get('/audit/compare/:currentId/:baselineId', asyncJsonRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const [currentAudit, baselineAudit] = await Promise.all([
    auditRepository.getAudit(req.params.currentId),
    auditRepository.getAudit(req.params.baselineId),
  ]);
  if (!currentAudit || !baselineAudit) return res.status(404).json({ success: false, error: 'Audit not found' });
  if (!(await canAccessAudit(req, currentAudit)) || !(await canAccessAudit(req, baselineAudit))) {
    return res.status(404).json({ success: false, error: 'Audit not found' });
  }
  if (currentAudit.hostname !== baselineAudit.hostname) {
    return res.status(400).json({ success: false, error: 'Only audits for the same website can be compared.' });
  }
  const comparison = await auditRepository.compareAudits(currentAudit.id, baselineAudit.id);
  if (!comparison) return res.status(404).json({ success: false, error: 'Audit comparison is unavailable.' });
  res.json({ success: true, data: comparison });
}));

apiRouter.post('/audit/rerun/:id', asyncJsonRoute((_req, res) => res.status(409).json({ success: false, error: 'Rerun is disabled for worker-backed audits. Start a new audit instead.' })));

apiRouter.post('/website/analyze', asyncJsonRoute((req, res) => startQueuedAudit(req, res, 'standard')));
