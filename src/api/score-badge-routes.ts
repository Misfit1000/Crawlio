import { createHash, randomBytes } from 'node:crypto';
import type { Request, RequestHandler, Response, Router } from 'express';
import { ApiError } from '../lib/api/errors';
import { createRateLimiter } from '../lib/api/http-hardening';
import { consumeDurableRateLimit, privacyHash } from '../lib/api/production-controls';
import { requireSupabaseAdminClient } from '../lib/supabase/server';
import { renderScoreBadge, type ScoreBadgeAudit } from '../lib/report/score-badge';

export interface ScoreBadgeShare {
  id: string;
  audit_id: string;
  project_id: string | null;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface ScoreBadgeShareStore {
  findByHash(hash: string): Promise<ScoreBadgeShare | null>;
  findById(id: string): Promise<ScoreBadgeShare | null>;
  issue(input: Omit<ScoreBadgeShare, 'id' | 'revoked_at'> & { token_hash: string }): Promise<{ id: string }>;
  revoke(input: { id: string; auditId: string; userId: string; revokedAt: string }): Promise<boolean>;
  listActive?(input: { auditId: string; userId: string; now: string }): Promise<Array<Pick<ScoreBadgeShare, 'id' | 'expires_at' | 'revoked_at'>>>;
}

export interface ScoreBadgeDependencies {
  // Compatible with getRequester and auditRepository.getAudit/getAuditJob. Admin access is not owner consent.
  getRequester(req: Request): Promise<{ userId: string | null }>;
  readAudit(auditId: string): Promise<ScoreBadgeAudit | null>;
  readScores?(auditId: string): Promise<Record<string, unknown> | null>;
  shares?: ScoreBadgeShareStore;
  now?: () => number;
}

const SHARE_COLUMNS = 'id,audit_id,project_id,user_id,expires_at,revoked_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PUBLIC_TOKEN = /^[A-Za-z0-9_-]{40,80}$/;
const BADGE_TOKEN = /^sb1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43}$/;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const supabaseScoreBadgeShares: ScoreBadgeShareStore = {
  async findByHash(hash) {
    const { data, error } = await requireSupabaseAdminClient().from('report_shares')
      .select(SHARE_COLUMNS).eq('token_hash', hash).maybeSingle();
    if (error) throw error;
    return data;
  },
  async findById(id) {
    const { data, error } = await requireSupabaseAdminClient().from('report_shares')
      .select(SHARE_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async issue(input) {
    const { data, error } = await requireSupabaseAdminClient().from('report_shares')
      .insert(input).select('id').single();
    if (error || !data) throw error || new Error('Share creation failed');
    return data;
  },
  async revoke({ id, auditId, userId, revokedAt }) {
    const { data, error } = await requireSupabaseAdminClient().from('report_shares')
      .update({ revoked_at: revokedAt }).eq('id', id).eq('audit_id', auditId).eq('user_id', userId)
      .select('id').maybeSingle();
    if (error) throw error;
    return !!data;
  },
  async listActive({ auditId, userId, now }) {
    const { data, error } = await requireSupabaseAdminClient().from('report_shares')
      .select('id,expires_at,revoked_at').eq('audit_id', auditId).eq('user_id', userId)
      .is('revoked_at', null).gt('expires_at', now)
      .order('expires_at', { ascending: false }).order('id', { ascending: true }).limit(50);
    if (error) throw error;
    return data || [];
  },
};

export async function readScoreBadgeScores(auditId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await requireSupabaseAdminClient().from('audit_reports')
    .select('overall:scores->overall,scoringVersion:scores->scoringVersion,coverage:scores->coverage')
    .eq('audit_id', auditId).maybeSingle();
  if (error) throw error;
  return data;
}

function activeShare(share: ScoreBadgeShare | null, audit: ScoreBadgeAudit, now: number): share is ScoreBadgeShare {
  return !!share && UUID.test(share.id) && share.audit_id === audit.id && !!audit.userId
    && share.user_id === audit.userId && share.project_id === audit.projectId && share.revoked_at === null
    && Number.isFinite(Date.parse(share.expires_at)) && Date.parse(share.expires_at) > now;
}

const badgeHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    'Cache-Control': 'private, no-store',
    'CDN-Cache-Control': 'no-store',
    'Vercel-CDN-Cache-Control': 'no-store',
    'Surrogate-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; sandbox",
  });
  next();
};

function routeRateLimit(action: string, maxRequests: number): RequestHandler {
  const limit = createRateLimiter({ namespace: `score-badge-${action}`, windowMs: 3_600_000, maxRequests, maxKeys: 10_000 });
  // Aggregate by client/operation, not by secret token or audit ID; rotating URLs cannot reset the limit.
  return (req, res, next) => limit(Object.create(req, { path: { value: action } }), res, next);
}

function fail(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ success: false, error: { code, message } });
}

/** Parent mounts this router and supplies authentication + an audit metadata read, without report/page/issue reads.
 * POST body: { confirm: true, shareToken: <existing public report token> }.
 * Returns a mount-relative badgeUrl and shareId for DELETE /audit/:id/shares/:shareId.
 * GET /audit/:id/shares lists active report/badge permissions on demand, without claiming a permission kind.
 * Badge tokens include only an opaque source share ID + 256 random bits, never the report bearer or audit ID.
 */
export function registerScoreBadgeRoutes(router: Router, dependencies: ScoreBadgeDependencies) {
  const shares = dependencies.shares || supabaseScoreBadgeShares;
  const readScores = dependencies.readScores || readScoreBadgeScores;
  const now = dependencies.now || Date.now;

  async function ownedAudit(req: Request, res: Response) {
    const requester = await dependencies.getRequester(req);
    if (!requester.userId) {
      fail(res, 401, 'BADGE_SIGN_IN_REQUIRED', 'Sign in to manage score badges.');
      return null;
    }
    const id = String(req.params.id);
    const audit = UUID.test(id) ? await dependencies.readAudit(id) : null;
    if (!audit || audit.id !== id || audit.userId !== requester.userId || audit.deletedAt) {
      fail(res, 404, 'AUDIT_NOT_FOUND', 'Audit not found.');
      return null;
    }
    return audit;
  }

  router.get('/audit/:id/shares', badgeHeaders, routeRateLimit('list', 120), async (req, res) => {
    try {
      const audit = await ownedAudit(req, res);
      if (!audit) return;
      if (!shares.listActive) throw new Error('Permission listing is unavailable');
      const permissions = await shares.listActive({ auditId: audit.id, userId: audit.userId!, now: new Date(now()).toISOString() });
      // Only permission IDs/dates are public to the owner. Existing hashes cannot identify report vs badge kinds.
      const active = permissions.filter(row => UUID.test(row.id) && row.revoked_at === null && Date.parse(row.expires_at) > now()).slice(0, 50);
      res.json({ success: true, data: { shares: active.map(row => ({ id: row.id, expiresAt: row.expires_at, revokedAt: row.revoked_at })), limit: 50 } });
    } catch {
      fail(res, 503, 'BADGE_UNAVAILABLE', 'Score badge service is temporarily unavailable.');
    }
  });

  router.post('/audit/:id/badge', badgeHeaders, routeRateLimit('issue', 20), async (req, res) => {
    try {
      const audit = await ownedAudit(req, res);
      if (!audit) return;
      const body = req.body;
      if (!body || Array.isArray(body) || body.confirm !== true || typeof body.shareToken !== 'string' || !PUBLIC_TOKEN.test(body.shareToken)) {
        fail(res, 400, 'BADGE_CONFIRMATION_REQUIRED', 'Confirm publication and provide an existing public report token.');
        return;
      }
      const source = await shares.findByHash(hashToken(body.shareToken));
      if (!activeShare(source, audit, now())) {
        fail(res, 409, 'BADGE_PUBLIC_SHARE_REQUIRED', 'An active public report share is required.');
        return;
      }
      if (!renderScoreBadge(audit, await readScores(audit.id))) {
        fail(res, 409, 'BADGE_NOT_READY', 'A completed audit with a final score and audit date is required.');
        return;
      }
      if (!activeShare(source, audit, now())) {
        fail(res, 409, 'BADGE_PUBLIC_SHARE_REQUIRED', 'An active public report share is required.');
        return;
      }
      await consumeDurableRateLimit({ namespace: 'score-badge-issue', identifierHash: privacyHash(audit.userId!), limit: 20, windowSeconds: 3600 });
      const issuedAt = now();
      if (!activeShare(source, audit, issuedAt)) {
        fail(res, 409, 'BADGE_PUBLIC_SHARE_REQUIRED', 'An active public report share is required.');
        return;
      }
      // The prefix/dots are outside the existing public-report token grammar, so a badge cannot disclose a report.
      const token = `sb1.${source.id}.${randomBytes(32).toString('base64url')}`;
      const expiresAt = new Date(Math.min(Date.parse(source.expires_at), issuedAt + 7 * 86_400_000)).toISOString();
      const issued = await shares.issue({ audit_id: audit.id, project_id: audit.projectId, user_id: audit.userId!, token_hash: hashToken(token), expires_at: expiresAt });
      res.status(201).json({ success: true, data: { shareId: issued.id, badgeUrl: `${req.baseUrl}/score-badges/${token}.svg`, expiresAt } });
    } catch (error) {
      // Never forward bearer tokens, database details, auth errors or private audit data to the error logger/response.
      if (error instanceof ApiError && error.code === 'RATE_LIMITED' && error.status === 429) {
        res.setHeader('Retry-After', '3600');
        fail(res, 429, 'BADGE_RATE_LIMITED', 'Too many requests. Please retry later.');
        return;
      }
      fail(res, 503, 'BADGE_UNAVAILABLE', 'Score badge service is temporarily unavailable.');
    }
  });

  router.get('/score-badges/:token.svg', badgeHeaders, routeRateLimit('view', 120), async (req, res) => {
    try {
      const token = String(req.params.token);
      const parsed = BADGE_TOKEN.exec(token);
      const unavailable = () => fail(res, 404, 'BADGE_NOT_FOUND', 'Score badge not found.');
      if (!parsed) { unavailable(); return; }
      const badge = await shares.findByHash(hashToken(token));
      if (!badge || badge.revoked_at !== null || !(Date.parse(badge.expires_at) > now())) { unavailable(); return; }
      const source = await shares.findById(parsed[1]);
      if (!source || source.id !== parsed[1] || source.id === badge.id) { unavailable(); return; }
      const audit = await dependencies.readAudit(badge.audit_id);
      if (!audit || !activeShare(badge, audit, now()) || !activeShare(source, audit, now())) { unavailable(); return; }
      const svg = renderScoreBadge(audit, await readScores(audit.id));
      // Recheck expiry after async reads. Nothing is cached, and badge views never increment share counters.
      if (!svg || !activeShare(badge, audit, now()) || !activeShare(source, audit, now())) { unavailable(); return; }
      res.removeHeader('ETag');
      res.removeHeader('Last-Modified');
      res.status(200).set('Content-Type', 'image/svg+xml; charset=utf-8');
      // end (not send) avoids Express freshness/304 handling even if a client supplies conditional headers.
      res.end(svg);
    } catch {
      fail(res, 503, 'BADGE_UNAVAILABLE', 'Score badge service is temporarily unavailable.');
    }
  });

  router.delete('/audit/:id/shares/:shareId', badgeHeaders, routeRateLimit('revoke', 20), async (req, res) => {
    try {
      const audit = await ownedAudit(req, res);
      if (!audit) return;
      const id = String(req.params.shareId);
      if (!UUID.test(id) || !await shares.revoke({ id, auditId: audit.id, userId: audit.userId!, revokedAt: new Date(now()).toISOString() })) {
        fail(res, 404, 'SHARE_NOT_FOUND', 'Share not found.');
        return;
      }
      res.status(204).end();
    } catch {
      fail(res, 503, 'BADGE_UNAVAILABLE', 'Score badge service is temporarily unavailable.');
    }
  });
}
