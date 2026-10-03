import { Router } from 'express';

import { createHash } from 'node:crypto';

import { authorizeScheduler } from '../lib/api/scheduler-auth';

import { normalizeUserUrl } from '../lib/seo/url-utils';

import { auditRepository } from '../lib/supabase/audit-repository';

import { requireSupabaseAdminClient } from '../lib/supabase/server';

import { getAuditModeConfig, type AuditMode } from '../lib/audit/resource-types';

import { canStartAudit, consumeAuditQuota, ensureUserProfileFromAuthUser, getAuthenticatedUserFromRequest, getPlanLimits } from '../lib/billing/entitlements';

import type { ResourceAuditDocument } from '../lib/audit/resource-types';

import { ApiError } from '../lib/api/errors';

import { admitAuditSubmission, assertAuditDeploymentCompatible, releaseAuditAdmission } from '../lib/api/production-controls';

import { listProjectOverview, updateProjectSettings, upsertProject } from '../lib/projects/service';

import { registerImportRoutes } from './import-routes';


export const apiRouter = Router();


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

function schedulerRequestAllowed(req: any, scope: 'cron' | 'dispatch' = 'cron') {
  const supplied = firstHeaderValue(req.headers?.authorization).replace(/^Bearer\s+/i, '') || firstHeaderValue(req.headers?.['x-blog-scheduler-secret']);
  return authorizeScheduler(supplied, scope);
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

registerImportRoutes(apiRouter, getRequester);

function nextProjectAuditAt(frequency: string, from = Date.now()) {
  const days = frequency === 'weekly' ? 7 : 30;
  return new Date(from + days * 86_400_000).toISOString();
}

async function enqueueScheduledProjectAudit(project: any) {
  const normalized = normalizeUserUrl(String(project.normalized_url || ''));
  if (!normalized.isValid || normalized.hostname !== String(project.hostname || '').toLowerCase()) {
    throw new ApiError('PROJECT_TARGET_INVALID', 'The scheduled project target is invalid.', 400);
  }
  const decision = await canStartAudit(String(project.user_id), getAuditModeConfig(project.audit_mode || 'quick').mode as AuditMode, {
    deepAuditEnabled: isDeepAuditEnabled(),
  });
  const admission = await admitAuditSubmission({
    userId: String(project.user_id),
    guestKeyHash: null,
    ipHash: hashGuestValue(`project-scheduler:${project.id}`),
    normalizedDomain: normalized.hostname,
    normalizedUrl: normalized.normalizedUrl,
    auditMode: decision.effectiveMode,
    plan: decision.plan,
    dailyLimit: decision.limits.dailyAudits,
    domainDailyLimit: Number(process.env.DOMAIN_DAILY_AUDIT_LIMIT || 2),
    activeLimit: Math.max(1, decision.limits.concurrency),
    globalActiveLimit: Number(process.env.GLOBAL_ACTIVE_AUDIT_LIMIT || 50),
    botVerified: true,
  });
  if (admission.reusedExistingAudit || (!admission.allowed && admission.auditId)) {
    return { auditId: admission.auditId, reused: true };
  }
  if (!admission.allowed) throw admissionError(admission);

  let audit: ResourceAuditDocument;
  try {
    audit = await auditRepository.createAuditJob({
      id: admission.auditId,
      submittedInput: normalized.normalizedUrl,
      normalizedUrl: normalized.normalizedUrl,
      hostname: normalized.hostname,
      mode: decision.effectiveMode,
      requestedMode: decision.requestedMode,
      effectiveMode: decision.effectiveMode,
      plan: decision.plan,
      processingTier: decision.processingTier,
      pageLimit: decision.pageLimit,
      queuePriority: decision.queuePriority,
      estimatedWaitSeconds: admission.queueDepth ? Math.max(0, admission.queueDepth - 1) * 45 : null,
      userId: decision.userId,
      guestKeyHash: null,
      projectId: project.id,
    });
  } catch (error) {
    await releaseAuditAdmission(admission.auditId, 'SCHEDULED_AUDIT_CREATE_FAILED');
    throw error;
  }
  try {
    await consumeAuditQuota(decision.userId, audit.id, decision.effectiveMode, {
      plan: decision.plan,
      pagesLimit: decision.pageLimit,
      guestKey: `scheduled:${project.id}`,
    });
    await auditRepository.updateAudit(audit.id, { quotaCounted: true });
  } catch (error) {
    await auditRepository.addInternalDiagnostic({
      auditId: audit.id,
      affectedUrl: audit.normalizedUrl,
      failureCode: 'SCHEDULED_QUOTA_COUNTER_SYNC_FAILED',
      phase: 'admission',
      attemptCount: 1,
      internalDetails: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  }
  return { auditId: audit.id, reused: false };
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

apiRouter.get('/projects/overview', asyncJsonRoute(async (req, res) => {
  const requester = await getRequester(req);
  if (!requester.userId) throw new ApiError('AUTHENTICATION_REQUIRED', 'Authentication required.', 401);
  const limits = await getPlanLimits(requester.profile?.plan || 'free');
  const overview = await listProjectOverview(requester.userId);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { ...overview, scheduledAuditsEnabled: limits.scheduledAuditsEnabled } });
}));

apiRouter.post('/projects', asyncJsonRoute(async (req, res) => {
  const requester = await getRequester(req);
  if (!requester.userId) throw new ApiError('AUTHENTICATION_REQUIRED', 'Authentication required.', 401);
  try {
    const project = await upsertProject(requester.userId, { name: req.body?.name, url: req.body?.url });
    res.status(201).json({ success: true, data: { project } });
  } catch (error) {
    if (error instanceof Error && /valid public website/i.test(error.message)) throw new ApiError('PROJECT_URL_INVALID', error.message, 400);
    throw error;
  }
}));

apiRouter.patch('/projects/:id', asyncJsonRoute(async (req, res) => {
  const requester = await getRequester(req);
  if (!requester.userId || !requester.profile) throw new ApiError('AUTHENTICATION_REQUIRED', 'Authentication required.', 401);
  const requestedFrequency = String(req.body?.auditFrequency || '');
  if (requestedFrequency && requestedFrequency !== 'manual') {
    const limits = await getPlanLimits(requester.profile.plan);
    if (!limits.scheduledAuditsEnabled) {
      throw new ApiError('SCHEDULED_AUDITS_NOT_INCLUDED', 'Scheduled audits are available on Agency and administrator plans.', 403);
    }
  }
  try {
    const project = await updateProjectSettings(requester.userId, req.params.id, req.body || {});
    res.json({ success: true, data: { project } });
  } catch (error) {
    if (error instanceof Error && error.message === 'Project not found.') throw new ApiError('PROJECT_NOT_FOUND', error.message, 404);
    throw error;
  }
}));

apiRouter.get('/projects/notifications', asyncJsonRoute(async (req, res) => {
  const requester = await getRequester(req);
  if (!requester.userId) throw new ApiError('AUTHENTICATION_REQUIRED', 'Authentication required.', 401);
  const client = requireSupabaseAdminClient();
  await client.from('project_notifications').delete().eq('user_id', requester.userId).lt('expires_at', new Date().toISOString());
  const result = await client.from('project_notifications').select('id,project_id,kind,title,message,audit_id,read_at,created_at').eq('user_id', requester.userId).order('created_at', { ascending: false }).limit(50);
  if (result.error) throw result.error;
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { notifications: result.data || [] } });
}));

apiRouter.post('/projects/notifications/read', asyncJsonRoute(async (req, res) => {
  const requester = await getRequester(req);
  if (!requester.userId) throw new ApiError('AUTHENTICATION_REQUIRED', 'Authentication required.', 401);
  const client = requireSupabaseAdminClient();
  let query = client.from('project_notifications').update({ read_at: new Date().toISOString() }).eq('user_id', requester.userId).is('read_at', null);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter((id: string) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 50) : [];
  if (ids.length) query = query.in('id', ids);
  const result = await query.select('id');
  if (result.error) throw result.error;
  res.json({ success: true, data: { updated: result.data?.length || 0 } });
}));

apiRouter.get('/projects/scheduler/run', asyncJsonRoute(async (req, res) => {
  if (!schedulerRequestAllowed(req)) throw new ApiError('PROJECT_SCHEDULER_UNAUTHORIZED', 'Scheduler authentication failed.', 401);
  await assertAuditDeploymentCompatible();
  const client = requireSupabaseAdminClient();
  const dueResult = await client.from('projects')
    .select('id,user_id,name,normalized_url,hostname,audit_frequency,audit_mode,next_audit_at')
    .in('audit_frequency', ['weekly', 'monthly'])
    .not('next_audit_at', 'is', null)
    .lte('next_audit_at', new Date().toISOString())
    .order('next_audit_at', { ascending: true })
    .limit(10);
  if (dueResult.error) throw dueResult.error;
  const results: Array<{ projectId: string; status: string; auditId?: string; message?: string }> = [];
  for (const project of dueResult.data || []) {
    try {
      const profileResult = await client.from('user_profiles').select('plan').eq('id', project.user_id).maybeSingle();
      if (profileResult.error) throw profileResult.error;
      const limits = await getPlanLimits(profileResult.data?.plan || 'free');
      if (!limits.scheduledAuditsEnabled) {
        await client.from('projects').update({ audit_frequency: 'manual', next_audit_at: null, updated_at: new Date().toISOString() }).eq('id', project.id);
        await client.from('project_notifications').insert({ project_id: project.id, user_id: project.user_id, kind: 'schedule_paused', title: 'Scheduled audits paused', message: 'This plan no longer includes scheduled audits.' });
        results.push({ projectId: project.id, status: 'paused' });
        continue;
      }
      const queued = await enqueueScheduledProjectAudit(project);
      const now = new Date().toISOString();
      await client.from('projects').update({ last_audit_at: now, last_audit_id: queued.auditId, next_audit_at: nextProjectAuditAt(project.audit_frequency), updated_at: now }).eq('id', project.id);
      results.push({ projectId: project.id, status: queued.reused ? 'reused' : 'queued', auditId: queued.auditId });
    } catch (error) {
      const retryAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await client.from('projects').update({ next_audit_at: retryAt, updated_at: new Date().toISOString() }).eq('id', project.id);
      results.push({ projectId: project.id, status: 'deferred', message: error instanceof Error ? error.message.slice(0, 180) : 'Audit admission was deferred.' });
    }
  }
  res.json({ success: true, data: { checked: dueResult.data?.length || 0, results } });
}));
