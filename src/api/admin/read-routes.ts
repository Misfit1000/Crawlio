import { Router, type Request, type Response } from 'express';
import { requireSupabaseAdminClient } from '../../lib/supabase/server';
import { durableRateLimit } from '../../lib/api/production-controls';

type AdminGuard = (req: Request, res: Response) => Promise<unknown>;
const userFields = 'id,email,display_name,role,plan,subscription_status,audit_quota_used_daily,audit_quota_used_monthly,created_at';
const auditFields = 'id,user_id,normalized_url,status,plan,requested_mode,effective_mode,queue_priority,processing_tier,current_phase,locked_by,lease_expires_at,error,created_at,updated_at';

export function createAdminReadRouter(requireAdmin: AdminGuard) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  for (const kind of ['users', 'audits'] as const) {
    router.get(`/${kind}`, async (req, res, next) => {
      try {
        if (!(await requireAdmin(req, res))) return;
        next();
      } catch (error) { next(error); }
    }, durableRateLimit({ namespace: 'admin-lists', limit: 120, windowSeconds: 60 }), async (req, res, next) => {
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
  return router;
}
