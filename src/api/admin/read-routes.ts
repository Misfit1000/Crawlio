import { Router, type Request, type Response } from 'express';
import { requireSupabaseAdminClient } from '../../lib/supabase/server';
import { durableRateLimit } from '../../lib/api/production-controls';

type AdminGuard = (req: Request, res: Response) => Promise<unknown>;
const userFields = 'id,email,display_name,role,plan,subscription_status,audit_quota_used_daily,audit_quota_used_monthly,created_at';
const auditFields = 'id,user_id,normalized_url,status,plan,requested_mode,effective_mode,queue_priority,processing_tier,current_phase,locked_by,lease_expires_at,error,created_at,updated_at';
const planFields = 'plan,label,daily_audits,monthly_audits,max_pages_quick,max_pages_standard,max_pages_deep,allowed_modes,audit_timeout_seconds,concurrency,max_events_per_audit,max_issues_per_audit,priority,exports_enabled,pdf_enabled,white_label_enabled,embed_enabled,api_enabled,scheduled_audits_enabled,updated_at';
const settingKeys = ['queueFairnessPaidBurst', 'guestAuditEnabled', 'maintenanceMode', 'pauseFreeSubmissions', 'captchaRequired', 'softQueueWarning', 'hardQueueLimit', 'disabledAuditModes'];

function adminReadGuard(requireAdmin: AdminGuard) {
  return async (req: Request, res: Response, next: (error?: unknown) => void) => {
    try {
      if (await requireAdmin(req, res)) next();
    } catch (error) { next(error); }
  };
}

export function createAdminReadRouter(requireAdmin: AdminGuard) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  const guard = adminReadGuard(requireAdmin);
  const limit = durableRateLimit({ namespace: 'admin-lists', limit: 120, windowSeconds: 60 });
  for (const kind of ['users', 'audits'] as const) {
    router.get(`/${kind}`, guard, limit, async (req, res, next) => {
      try {
        const limit = Math.floor(Math.min(100, Math.max(1, Number(req.query.limit) || 50)));
        const offset = Math.min(10000, Math.max(0, Math.floor(Number(req.query.offset) || 0)));
        const search = String(req.query.search || '').trim().slice(0, 120).replace(/[%_\\]/g, '\\$&');
        const client = requireSupabaseAdminClient();
        let query = client.from(kind === 'users' ? 'user_profiles' : 'audits').select(kind === 'users' ? userFields : auditFields).order('created_at', { ascending: false }).order('id', { ascending: false });
        if (search) query = query.ilike(kind === 'users' ? 'email' : 'normalized_url', `%${search}%`);
        if (kind === 'users') {
          if (['free', 'paid', 'agency', 'admin'].includes(String(req.query.plan))) query = query.eq('plan', req.query.plan);
          if (['user', 'support', 'admin'].includes(String(req.query.role))) query = query.eq('role', req.query.role);
        } else if (req.query.status === 'active') {
          query = query.in('status', ['queued', 'running']);
        } else if (['queued', 'running', 'completed', 'completed_with_warnings', 'failed', 'cancelled', 'abandoned'].includes(String(req.query.status))) query = query.eq('status', req.query.status);
        const { data, error } = await query.range(offset, offset + limit);
        if (error) throw error;
        res.json({ success: true, data: { rows: (data || []).slice(0, limit), hasMore: (data || []).length > limit, offset, limit } });
      } catch (error) { next(error); }
    });
  }
  router.get('/workers', guard, limit, async (_req, res, next) => {
    try {
      const { data, error } = await requireSupabaseAdminClient().from('platform_settings')
        .select('id,key,value,updated_at').like('id', 'audit_worker:%').order('updated_at', { ascending: false }).limit(20);
      if (error) throw error;
      res.json({ success: true, data: (data || []).map((row) => {
        const value = row.value && typeof row.value === 'object' ? row.value : {};
        return { id: row.id, key: row.key, updated_at: row.updated_at, value: {
          workerId: value.workerId, runtime: value.runtime, currentAuditId: value.currentAuditId,
          supportedModes: Array.isArray(value.supportedModes) ? value.supportedModes.slice(0, 5) : [],
          lastSeenAt: value.lastSeenAt,
        } };
      }) });
    } catch (error) { next(error); }
  });
  router.get('/actions', guard, limit, async (req, res, next) => {
    try {
      const count = Math.min(50, Math.max(1, Math.floor(Number(req.query.limit) || 10)));
      const { data, error } = await requireSupabaseAdminClient().from('admin_actions')
        .select('id,action,target_type,target_id,created_at').order('created_at', { ascending: false }).limit(count);
      if (error) throw error;
      res.json({ success: true, data: data || [] });
    } catch (error) { next(error); }
  });
  router.get('/plans', guard, limit, async (_req, res, next) => {
    try {
      const { data, error } = await requireSupabaseAdminClient().from('plan_limits').select(planFields).order('priority', { ascending: true }).limit(4);
      if (error) throw error;
      res.json({ success: true, data: data || [] });
    } catch (error) { next(error); }
  });
  router.get('/platform/settings', guard, limit, async (_req, res, next) => {
    try {
      const { data, error } = await requireSupabaseAdminClient().from('platform_settings')
        .select('platform_name,support_email,require_email_verification,public_registration,value,updated_at').eq('id', 'settings').maybeSingle();
      if (error) throw error;
      if (!data) return res.json({ success: true, data: null });
      const value = data.value && typeof data.value === 'object' ? data.value : {};
      res.json({ success: true, data: {
        platform_name: data.platform_name, support_email: data.support_email,
        require_email_verification: data.require_email_verification, public_registration: data.public_registration,
        updated_at: data.updated_at,
        value: Object.fromEntries(settingKeys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])),
      } });
    } catch (error) { next(error); }
  });
  return router;
}
