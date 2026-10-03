import { Router } from 'express';

import { createAdminReadRouter } from './admin/read-routes';

import { adminRequestId, createAdminOperationsRouter, operationRpc } from './admin/operations-routes';

import { validatePlatformControls } from '../lib/operations/admin-config';

import { planPageCeiling } from '../lib/audit/scalable-policy';

import { requireSupabaseAdminClient } from '../lib/supabase/server';

import { isAuditMode, normalizeAuditModes, type AuditMode } from '../lib/audit/resource-types';

import { ensureUserProfileFromAuthUser, getAuthenticatedUserFromRequest } from '../lib/billing/entitlements';

import { ApiError } from '../lib/api/errors';

import { BRAND } from '../lib/brand';

import { captureAdminSentryTestEvent, flushNodeMonitoring } from '../lib/monitoring/sentry-node';


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

apiRouter.use('/admin', createAdminOperationsRouter(requireAdminRequester));

apiRouter.use('/admin', createAdminReadRouter(requireAdminRequester));

async function getRequester(req: any) {
  const authUser = await getAuthenticatedUserFromRequest(req);
  if (!authUser) return { userId: null, profile: null };
  req.requesterUserId = authUser.id;
  const profile = await ensureUserProfileFromAuthUser(authUser);
  return { userId: authUser.id, profile };
}

async function requireAdminRequester(req: any, res: any) {
  const requester = await getRequester(req);
  if (!requester.userId || !requester.profile) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return null;
  }
  if (requester.profile.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required.' });
    return null;
  }
  return requester;
}

apiRouter.post('/admin/diagnostics/sentry-test', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const initiated = captureAdminSentryTestEvent();
  if (initiated) await flushNodeMonitoring(1_500);
  const client = requireSupabaseAdminClient();
  await client.from('admin_actions').insert({
    admin_user_id: requester.userId,
    action: 'sentry_api_test',
    target_type: 'monitoring',
    target_id: 'crawlio-api',
    metadata: { initiated },
  });
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { initiated, service: 'crawlio-api' } });
}));

apiRouter.post('/admin/plans/:plan', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 4 || reason.length > 500) throw new ApiError('ADMIN_REASON_REQUIRED', 'Provide a reason between 4 and 500 characters.', 400);
  const numericKeys = new Set(['daily_audits', 'monthly_audits', 'max_pages_quick', 'max_pages_standard', 'max_pages_deep', 'audit_timeout_seconds', 'concurrency', 'max_events_per_audit', 'max_issues_per_audit', 'priority']);
  const booleanKeys = new Set(['exports_enabled', 'pdf_enabled', 'scheduled_audits_enabled']);
  const numericBounds: Record<string, [number, number]> = {
    daily_audits: [0, 100_000],
    monthly_audits: [0, 1_000_000],
    max_pages_quick: [0, planPageCeiling(String(req.params.plan))],
    max_pages_standard: [0, planPageCeiling(String(req.params.plan))],
    max_pages_deep: [0, planPageCeiling(String(req.params.plan))],
    audit_timeout_seconds: [3, 30],
    concurrency: [1, 8],
    max_events_per_audit: [50, 10_000],
    max_issues_per_audit: [100, 20_000],
    priority: [0, 1_000],
  };
  const patch: Record<string, number | boolean | AuditMode[]> = {};
  for (const [key, value] of Object.entries(req.body?.patch || {})) {
    if (numericKeys.has(key) && Number.isFinite(Number(value))) {
      const numeric = Number(value);
      const [minimum, maximum] = numericBounds[key];
      if (!Number.isInteger(numeric) || numeric < minimum || numeric > maximum) {
        throw new ApiError('INVALID_PLAN_LIMIT', `${key.replace(/_/g, ' ')} must be a whole number between ${minimum} and ${maximum}.`, 400);
      }
      patch[key] = numeric;
    }
    if (booleanKeys.has(key) && typeof value === 'boolean') patch[key] = value;
    if (key === 'allowed_modes') {
      if (!Array.isArray(value) || value.some((mode) => !isAuditMode(mode))) {
        throw new ApiError('INVALID_AUDIT_MODES', 'Allowed audit modes must contain only Quick, Standard, or Deep.', 400);
      }
      const modes = normalizeAuditModes(value, []);
      if (!modes.length) throw new ApiError('AUDIT_MODE_REQUIRED', 'Enable at least one audit mode for this plan.', 400);
      patch.allowed_modes = modes;
    }
  }
  if (!Object.keys(patch).length) throw new ApiError('EMPTY_ADMIN_UPDATE', 'No supported plan fields were provided.', 400);
  const client = requireSupabaseAdminClient();
  const { data: before, error: readError } = await client.from('plan_limits').select('*').eq('plan', req.params.plan).maybeSingle();
  if (readError) throw readError;
  if (!before) throw new ApiError('PLAN_NOT_FOUND', 'Plan not found.', 404);
  const merged = { ...before, ...patch };
  const allowedModes = normalizeAuditModes(merged.allowed_modes, []);
  for (const mode of allowedModes) {
    const field = mode === 'quick' ? 'max_pages_quick' : mode === 'standard' ? 'max_pages_standard' : 'max_pages_deep';
    if (Number(merged[field] || 0) < 1) {
      throw new ApiError('AUDIT_MODE_LIMIT_REQUIRED', `${mode[0].toUpperCase() + mode.slice(1)} must have a page limit before it can be enabled.`, 400);
    }
    if (Number(merged[field]) > planPageCeiling(String(req.params.plan))) {
      throw new ApiError('AUDIT_MODE_LIMIT_UNSUPPORTED', `${mode[0].toUpperCase() + mode.slice(1)} supports at most ${planPageCeiling(String(req.params.plan))} pages for this plan.`, 400);
    }
  }
  await operationRpc('admin_update_configuration', { p_actor: requester.userId, p_kind: 'plan', p_key: req.params.plan, p_patch: patch, p_reason: reason, p_request: adminRequestId(req) });
  res.json({ success: true, data: { plan: req.params.plan, after: patch } });
}));

apiRouter.post('/admin/platform/settings', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 4 || reason.length > 500) throw new ApiError('ADMIN_REASON_REQUIRED', 'Provide a reason between 4 and 500 characters.', 400);
  const client = requireSupabaseAdminClient();
  const { data: before, error: readError } = await client.from('platform_settings').select('platform_name,support_email,require_email_verification,public_registration').eq('id', 'settings').maybeSingle();
  if (readError) throw readError;
  const patch = req.body?.patch || {};
  const row = {
    platform_name: String(patch.platformName || before?.platform_name || BRAND.name).slice(0, 100),
    support_email: String(patch.supportEmail || before?.support_email || '').slice(0, 254),
    require_email_verification: Boolean(patch.requireEmailVerification ?? before?.require_email_verification),
    public_registration: Boolean(patch.publicRegistration ?? before?.public_registration ?? true),
    value: validatePlatformControls(patch.value || {}),
  };
  await operationRpc('admin_update_configuration', { p_actor: requester.userId, p_kind: 'platform', p_key: 'settings', p_patch: row, p_reason: reason, p_request: adminRequestId(req) });
  res.json({ success: true, data: row });
}));

apiRouter.post('/admin/platform/control', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 4 || reason.length > 500) throw new ApiError('ADMIN_REASON_REQUIRED', 'Provide a reason between 4 and 500 characters.', 400);
  const allowedKeys = new Set(['maintenanceMode', 'pauseFreeSubmissions', 'captchaRequired', 'hardQueueLimit', 'softQueueWarning', 'disabledAuditModes']);
  const key = String(req.body?.key || '');
  if (!allowedKeys.has(key)) throw new ApiError('UNSUPPORTED_PLATFORM_CONTROL', 'This platform control is not supported.', 400);
  const value = req.body?.value;
  const nextValue = validatePlatformControls({ [key]: value });
  await operationRpc('admin_update_configuration', { p_actor: requester.userId, p_kind: 'platform', p_key: 'settings', p_patch: { value: nextValue }, p_reason: reason, p_request: adminRequestId(req) });
  res.json({ success: true, data: { key, value } });
}));
