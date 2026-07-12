import { createHash } from 'node:crypto';
import { Router } from 'express';
import { normalizeDomainInput, normalizeUserUrl } from '../lib/seo/url-utils';
import { generateKeywords } from '../lib/keywords/generator';
import { clusterKeywords } from '../lib/keywords/clustering';
import { buildContentBrief } from '../lib/keywords/content-brief';
import { auditStore } from '../lib/audit/audit-store';
import { auditRepository } from '../lib/supabase/audit-repository';
import { getSupabaseProjectHostname } from '../lib/supabase/server';
import { getAuditModeConfig, type AuditMode } from '../lib/audit/resource-types';
import {
  EntitlementError,
  canStartAudit,
  consumeAuditQuota,
  ensureUserProfileFromAuthUser,
  getAuthenticatedUserFromRequest,
  getPlanLimits,
} from '../lib/billing/entitlements';
import type { ResourceAuditDocument } from '../lib/audit/resource-types';
import { getAuditProfileForDocument } from '../lib/audit/audit-profiles';
import { createRateLimiter } from '../lib/api/http-hardening';
import { blogRepository } from '../lib/blog/repository';
import { generateBlogWithGemini } from '../lib/blog/gemini';
import { normalizeBlogSlug } from '../lib/blog/slug';
import { BlogValidationError, prepareBlogPost } from '../lib/blog/validation';
import { canonicalSiteOrigin, renderBlogSitemap } from '../lib/blog/sitemap';

const DUPLICATE_AUDIT_WINDOW_MS = 10 * 60 * 1000;

function asyncJsonRoute(handler: any) {
  return async (req: any, res: any, next: any) => {
    try {
      await handler(req, res, next);
    } catch (error: any) {
      console.error(error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : "Internal server error",
        });
      }
    }
  };
}

export const apiRouter = Router();

apiRouter.use('/admin/blog/generate', createRateLimiter({ namespace: 'blog-gemini', windowMs: 60_000, maxRequests: 5 }));

function firstHeaderValue(value: unknown) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function hashGuestValue(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function getCookieValue(req: any, name: string) {
  if (req.cookies?.[name]) return String(req.cookies[name]);
  const cookieHeader = firstHeaderValue(req.headers?.cookie);
  const match = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

function guestIdentityForRequest(req: any) {
  const explicitGuestId = firstHeaderValue(req.headers?.['x-seointel-guest-id']) || getCookieValue(req, 'seointel_guest_id');
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

async function uniqueBlogSlug(value: string, exceptId?: string) {
  const base = normalizeBlogSlug(value);
  let candidate = base;
  for (let suffix = 2; await blogRepository.slugExists(candidate, exceptId); suffix += 1) {
    candidate = `${base.slice(0, Math.max(1, 116 - String(suffix).length)).replace(/-+$/g, '')}-${suffix}`;
    if (suffix > 9999) throw new Error('Could not create a unique slug.');
  }
  return candidate;
}

async function logBlogAction(adminUserId: string, action: string, postId: string, metadata: Record<string, unknown> = {}) {
  const client = (await import('../lib/supabase/server')).getSupabaseAdminClient();
  if (!client) return;
  await client.from('admin_actions').insert({ admin_user_id: adminUserId, action, target_type: 'blog_post', target_id: postId, metadata });
}

async function canAccessAudit(req: any, audit: ResourceAuditDocument) {
  const requester = await getRequester(req);
  if (requester.profile?.role === 'admin') return true;
  if (audit.userId) return requester.userId === audit.userId;
  if (audit.guestKeyHash) return guestIdentityForRequest(req).guestKeyHash === audit.guestKeyHash;
  return false;
}

function sendEntitlementError(res: any, error: unknown) {
  if (error instanceof EntitlementError) {
    return res.status(error.status).json({
      success: false,
      error: error.message,
      upgradeRequired: error.upgradeRequired,
    });
  }
  throw error;
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
    queuePriority: audit.queuePriority,
    ...extras,
  };
}

apiRouter.get('/me/profile', asyncJsonRoute(async (req, res) => {
  const authUser = await getAuthenticatedUserFromRequest(req);
  if (!authUser) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  const profile = await ensureUserProfileFromAuthUser(authUser);
  const limits = await getPlanLimits(profile.plan);
  res.json({ success: true, data: { profile, limits } });
}));

apiRouter.get('/blog/posts', asyncJsonRoute(async (req, res) => {
  const result = await blogRepository.listPublished({ query: String(req.query.q || ''), limit: Number(req.query.limit || 12), offset: Number(req.query.offset || 0) });
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.json({ success: true, data: result });
}));

apiRouter.get('/blog/sitemap.xml', asyncJsonRoute(async (req, res) => {
  const xml = await renderBlogSitemap(canonicalSiteOrigin(req));
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(xml);
}));

apiRouter.get('/blog/posts/:slug', asyncJsonRoute(async (req, res) => {
  const post = await blogRepository.getPublishedBySlug(normalizeBlogSlug(req.params.slug));
  if (!post) return res.status(404).json({ success: false, error: 'Article not found.' });
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.json({ success: true, data: { post } });
}));

apiRouter.get('/admin/blog/posts', asyncJsonRoute(async (req, res) => {
  if (!(await requireAdminRequester(req, res))) return;
  const posts = await blogRepository.listAdmin(Number(req.query.limit || 100));
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ success: true, data: { posts } });
}));

apiRouter.post('/admin/blog/posts', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  try {
    const row = prepareBlogPost(req.body || {});
    row.slug = await uniqueBlogSlug(row.slug);
    const post = await blogRepository.create({ ...row, author_id: requester.userId, updated_by: requester.userId });
    await logBlogAction(requester.userId, 'create_blog_post', post.id, { status: post.status, slug: post.slug });
    res.status(201).json({ success: true, data: { post } });
  } catch (error) {
    if (error instanceof BlogValidationError) return res.status(error.status).json({ success: false, error: error.message });
    throw error;
  }
}));

apiRouter.put('/admin/blog/posts/:id', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const existing = await blogRepository.getAdminById(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'Article not found.' });
  try {
    const row = prepareBlogPost(req.body || {});
    row.slug = await uniqueBlogSlug(row.slug, existing.id);
    const post = await blogRepository.update(existing.id, { ...row, updated_by: requester.userId });
    await logBlogAction(requester.userId, 'update_blog_post', existing.id, { status: post?.status, slug: post?.slug });
    res.json({ success: true, data: { post } });
  } catch (error) {
    if (error instanceof BlogValidationError) return res.status(error.status).json({ success: false, error: error.message });
    throw error;
  }
}));

apiRouter.delete('/admin/blog/posts/:id', asyncJsonRoute(async (req, res) => {
  const requester = await requireAdminRequester(req, res);
  if (!requester) return;
  const post = await blogRepository.update(req.params.id, { status: 'archived', updated_by: requester.userId });
  if (!post) return res.status(404).json({ success: false, error: 'Article not found.' });
  await logBlogAction(requester.userId, 'archive_blog_post', post.id, { slug: post.slug });
  res.json({ success: true, data: { post } });
}));

apiRouter.post('/admin/blog/generate', asyncJsonRoute(async (req, res) => {
  if (!(await requireAdminRequester(req, res))) return;
  try {
    const result = await generateBlogWithGemini({
      action: req.body?.action === 'topics' ? 'topics' : 'draft',
      topic: req.body?.topic,
      audience: req.body?.audience,
      keywords: req.body?.keywords,
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gemini draft generation failed.';
    const status = /not configured/i.test(message) ? 503 : 502;
    res.status(status).json({ success: false, error: message });
  }
}));

async function startQueuedAudit(req: any, res: any, defaultMode: AuditMode = 'quick') {
  const { url, mode = defaultMode, projectId = null } = req.body || {};
  const normalized = normalizeUserUrl(String(url || ''));
  if (!normalized.isValid) {
    return res.status(400).json({ success: false, error: normalized.error || 'Invalid URL' });
  }

  const requestedMode = getAuditModeConfig(mode).mode as AuditMode;
  const { userId } = await getRequester(req);
  const guestIdentity = guestIdentityForRequest(req);
  const ownerLookup = userId
    ? { userId, guestKeyHash: null }
    : { userId: null, guestKeyHash: guestIdentity.guestKeyHash };
  const createdAfterIso = new Date(Date.now() - DUPLICATE_AUDIT_WINDOW_MS).toISOString();

  const duplicateAudit = await auditRepository.findActiveDuplicateAudit({
    ...ownerLookup,
    normalizedUrl: normalized.normalizedUrl,
    createdAfterIso,
  });
  if (duplicateAudit) {
    return res.json({
      success: true,
      data: auditStartResponseData(duplicateAudit, { reusedExistingAudit: true }),
    });
  }

  if (!userId) {
    const activeGuestAudit = await auditRepository.findActiveAuditForOwner(ownerLookup);
    if (activeGuestAudit) {
      return res.json({
        success: true,
        message: 'You already have an audit in progress.',
        data: auditStartResponseData(activeGuestAudit, { reusedExistingAudit: true }),
      });
    }
  }

  let decision;
  try {
    decision = await canStartAudit(userId, requestedMode, {
      guestKey: guestIdentity.guestKey,
      deepAuditEnabled: isDeepAuditEnabled(),
    });
  } catch (error) {
    if (error instanceof EntitlementError && /already have an audit in progress/i.test(error.message)) {
      const activeAudit = await auditRepository.findActiveAuditForOwner(ownerLookup);
      if (activeAudit) {
        return res.json({
          success: true,
          message: 'You already have an audit in progress.',
          data: auditStartResponseData(activeAudit, { reusedExistingAudit: true }),
        });
      }
    }
    return sendEntitlementError(res, error);
  }

  const audit = await auditRepository.createAuditJob({
    submittedInput: String(url || '').trim(),
    normalizedUrl: normalized.normalizedUrl,
    hostname: normalized.hostname,
    mode: decision.effectiveMode,
    requestedMode: decision.requestedMode,
    effectiveMode: decision.effectiveMode,
    plan: decision.plan,
    processingTier: decision.processingTier,
    pageLimit: decision.pageLimit,
    queuePriority: decision.queuePriority,
    userId: decision.userId,
    guestKeyHash: decision.userId ? null : guestIdentity.guestKeyHash,
    projectId,
  });

  await consumeAuditQuota(decision.userId, audit.id, decision.effectiveMode, {
    plan: decision.plan,
    pagesLimit: decision.pageLimit,
    guestKey: guestIdentity.guestKey,
  });
  await auditRepository.updateAudit(audit.id, { quotaCounted: true });

  console.info(`Audit start using Supabase project: ${getSupabaseProjectHostname() || 'not configured'}`);
  res.json({
    success: true,
    data: {
      ...auditStartResponseData(audit),
      quotaRemaining: decision.quotaRemaining,
      reusedExistingAudit: false,
    },
  });
}


apiRouter.post('/audit/start', asyncJsonRoute(async (req, res) => {
  try {
    return startQueuedAudit(req, res, 'quick');
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
}));

apiRouter.get('/audit/events/:id', asyncJsonRoute((req, res) => {
  const auditId = req.params.id;
  const audit = typeof auditStore.getAudit === 'function' ? auditStore.getAudit(auditId) : auditStore.getJob(auditId);
  
  if (!audit) {
    return res.status(404).json({ success: false, error: 'Audit not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  const sendEvent = (eventType, data) => {
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send existing history
  const history = typeof auditStore.getAuditEvents === 'function' ? auditStore.getAuditEvents(auditId) : [];
  for (const ev of history) {
    sendEvent('audit-event', ev);
  }

  // Subscribe to new events
  const onEvent = (ev) => {
    sendEvent('audit-event', ev);
    if (ev.type === 'audit_completed') {
      sendEvent('audit-complete', { auditId, resultAvailable: true });
    } else if (ev.type === 'audit_failed') {
      sendEvent('audit-error', { auditId, error: ev.message });
    }
  };

  if (typeof auditStore.subscribeToAudit === 'function') {
    auditStore.subscribeToAudit(auditId, onEvent);
  }

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    if (typeof auditStore.unsubscribeFromAudit === 'function') {
      auditStore.unsubscribeFromAudit(auditId, onEvent);
    }
  });
}));


apiRouter.get('/audit/status/:id', asyncJsonRoute(async (req, res) => {
  try {
    const liveData = await auditRepository.getLiveData(req.params.id);
    if (!liveData.audit) return res.status(404).json({ success: false, error: 'Audit not found' });
    if (!(await canAccessAudit(req, liveData.audit))) return res.status(404).json({ success: false, error: 'Audit not found' });
    res.json({ success: true, data: liveData });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
}));

apiRouter.post('/audit/cancel/:id', asyncJsonRoute(async (req, res) => {
  const audit = await auditRepository.getAudit(req.params.id);
  if (!audit) return res.status(404).json({ success: false, error: 'Audit not found' });
  if (!(await canAccessAudit(req, audit))) return res.status(404).json({ success: false, error: 'Audit not found' });
  await auditRepository.cancelAudit(req.params.id);
  res.json({ success: true, data: { auditId: req.params.id, status: 'cancelled' } });
}));

apiRouter.get('/audit/result/:id', asyncJsonRoute(async (req, res) => {
  try {
    const liveData = await auditRepository.getLiveData(req.params.id);
    if (!liveData.audit) return res.status(404).json({ success: false, error: 'Audit not found' });
    if (!(await canAccessAudit(req, liveData.audit))) return res.status(404).json({ success: false, error: 'Audit not found' });
    res.json({ success: true, data: liveData });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
}));

apiRouter.get('/audit/export/:id/:format', asyncJsonRoute(async (req, res) => {
  const { id, format } = req.params;
  const liveData = await auditRepository.getLiveData(id);
  if (!liveData.audit) return res.status(404).json({ success: false, error: 'Audit not found' });
  if (!(await canAccessAudit(req, liveData.audit))) return res.status(404).json({ success: false, error: 'Audit not found' });

  if (format === 'pdf') {
    if (liveData.audit.status !== 'completed') {
      return res.status(409).json({ success: false, error: 'PDF export is available after the audit completes.' });
    }
    const profile = getAuditProfileForDocument(liveData.audit);
    if (!profile.pdfEnabled) {
      return res.status(403).json({ success: false, error: 'PDF reports require a Full, Agency, or Admin audit.', upgradeRequired: true });
    }
    const { renderAuditPdf } = await import('../lib/report/pdf');
    const pdf = await renderAuditPdf(liveData);
    const safeHost = liveData.audit.hostname.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'website';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="seointel-${safeHost}-audit.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(pdf);
  }

  if (format === 'json') {
    return res.json({ success: true, data: liveData.finalReport || liveData });
  }

  if (format === 'issues.csv') {
    const header = 'severity,category,title,affectedUrl,evidence,recommendation\n';
    const rows = liveData.latestIssues.map((issue) => [issue.severity, issue.category, issue.title, issue.affectedUrl, issue.evidence, issue.recommendation]
      .map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(header + rows);
  }

  if (format === 'pages.csv') {
    const header = 'statusCode,url,responseTimeMs,pageSizeBytes,title,wordCount,crawlDepth,issueCount\n';
    const rows = liveData.latestPages.map((page) => [page.statusCode, page.url, page.responseTimeMs, page.pageSizeBytes, page.title, page.wordCount, page.crawlDepth, page.issueCount]
      .map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(header + rows);
  }

  return res.status(400).json({ success: false, error: 'Unsupported export format' });
}));

apiRouter.post('/audit/rerun/:id', asyncJsonRoute((req, res) => {
  try {
    return res.status(409).json({ success: false, error: 'Rerun is disabled for worker-backed audits. Start a new audit instead.' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
}));

apiRouter.post('/keyword/research', asyncJsonRoute((req, res) => {
  try {
    const { seed } = req.body;
    if (!seed) return res.status(400).json({ success: false, error: 'Seed keyword is required' });
    
    const keywords = generateKeywords(seed);
    res.json({ success: true, data: { keywords } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
}));

apiRouter.post('/website/analyze', asyncJsonRoute(async (req, res) => {
  try {
    return startQueuedAudit(req, res, 'standard');
  } catch(e: any) {
    res.status(500).json({ success: false, error: e.message || 'Internal Server Error' });
  }
}));

apiRouter.post('/clusters', asyncJsonRoute((req, res) => {
  try {
    const { keywords } = req.body;
    if (!keywords || !Array.isArray(keywords)) return res.status(400).json({ success: false, error: 'Keywords array is required' });
    
    const clusters = clusterKeywords(keywords);
    res.json({ success: true, data: { clusters } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
}));

apiRouter.post('/content-brief', asyncJsonRoute((req, res) => {
  try {
    const { cluster } = req.body;
    if (!cluster) return res.status(400).json({ success: false, error: 'Cluster object is required' });
    
    const brief = buildContentBrief(cluster);
    res.json({ success: true, data: { brief } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
}));

apiRouter.post('/competitor-gap', asyncJsonRoute(async (req, res) => {
  return res.status(501).json({
    success: false,
    error: 'Competitor Gap is temporarily disabled while worker-backed analysis is being enabled.',
  });
}));
