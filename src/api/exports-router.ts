import { Router } from 'express';

import { createHash } from 'node:crypto';

import { isCompletedAuditStatus } from '../lib/audit/audit-time';

import { auditRepository } from '../lib/supabase/audit-repository';

import { requireSupabaseAdminClient } from '../lib/supabase/server';

import { ensureUserProfileFromAuthUser, getAuthenticatedUserFromRequest, getPlanLimits } from '../lib/billing/entitlements';

import type { ResourceAuditDocument } from '../lib/audit/resource-types';

import { ApiError } from '../lib/api/errors';

import { durableRateLimit } from '../lib/api/production-controls';

import { buildPublicAuditExport, csvRow } from '../lib/report/export';
import { pageCsvFields, scopeFindings } from '../lib/report/scope-presentation';
import { scopeIncludesGroup } from '../lib/audit/audit-scope';

import { BRAND } from '../lib/brand';


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

apiRouter.get('/me/export', asyncJsonRoute(async (req, res) => {
  const requester = await getRequester(req);
  if (!requester.userId) throw new ApiError('AUTHENTICATION_REQUIRED', 'Authentication is required.', 401);
  const client = requireSupabaseAdminClient();
  const [profile, audits, projects, keywords, competitors] = await Promise.all([
    client.from('user_profiles').select('id,email,full_name,display_name,plan,role,created_at,terms_accepted_at,privacy_accepted_at,legal_version').eq('id', requester.userId).maybeSingle(),
    client.from('audits').select('id,submitted_input,normalized_url,final_url,hostname,status,requested_mode,effective_mode,page_limit,warning_count,failure_counts,created_at,completed_at,archived_at').eq('user_id', requester.userId).order('created_at', { ascending: false }).limit(500),
    client.from('projects').select('id,name,description,created_at').eq('user_id', requester.userId).limit(500),
    client.from('keywords').select('id,term,project_id,group,intent,created_at').eq('user_id', requester.userId).limit(1000),
    client.from('competitors').select('id,domain_url,niche,created_at').eq('user_id', requester.userId).limit(500),
  ]);
  const firstError = [profile.error, audits.error, projects.error, keywords.error, competitors.error].find(Boolean);
  if (firstError) throw firstError;
  res.setHeader('Content-Disposition', 'attachment; filename="crawlio-account-export.json"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    exportedAt: new Date().toISOString(),
    profile: profile.data,
    audits: audits.data || [],
    projects: projects.data || [],
    keywords: keywords.data || [],
    competitors: competitors.data || [],
    storageNotice: `${BRAND.name} stores audit summaries and findings, not complete raw HTML.`,
  });
}));

apiRouter.get('/audit/export-status/:id/:format', durableRateLimit({ namespace: 'export-status', limit: 120, windowSeconds: 300 }), asyncJsonRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const audit = await auditRepository.getAudit(req.params.id);
  if (!audit || !(await canAccessAudit(req, audit))) throw new ApiError('AUDIT_NOT_FOUND', 'Audit not found.', 404);
  if (!(await getPlanLimits(audit.plan)).exportsEnabled) throw new ApiError('EXPORT_NOT_ALLOWED', 'Data exports are not enabled for this plan.', 403);
  if (!['json', 'pages.csv', 'issues.csv', 'sitemap.xml'].includes(req.params.format)) throw new ApiError('INVALID_FORMAT', 'Unsupported export format.', 400);
  const { data, error } = await requireSupabaseAdminClient().from('audit_export_jobs').select('state,expires_at')
    .eq('audit_id', audit.id).eq('format', req.params.format).maybeSingle();
  if (error) throw error;
  if (!data || Date.parse(data.expires_at) <= Date.now()) throw new ApiError('EXPORT_EXPIRED', 'Request a new export.', 410);
  if (data.state === 'failed') throw new ApiError('EXPORT_FAILED', 'Export generation failed.', 503);
  res.setHeader('Retry-After', '2');
  res.status(data.state === 'ready' ? 200 : 202).json({ success: true, data: { state: data.state } });
}));

apiRouter.get('/audit/export/:id/:format', asyncJsonRoute(async (req, res) => {
  const { id, format } = req.params;
  const supportedFormats = new Set(['pdf', 'json', 'issues.csv', 'pages.csv', 'sitemap.xml']);
  if (!supportedFormats.has(format)) return res.status(400).json({ success: false, error: 'Unsupported export format' });
  const audit = await auditRepository.getAudit(id);
  if (!audit || !(await canAccessAudit(req, audit))) return res.status(404).json({ success: false, error: 'Audit not found' });
  const limits = await getPlanLimits(audit.plan);
  res.setHeader('Cache-Control', 'private, no-store');
  if (format === 'sitemap.xml' && !scopeIncludesGroup(audit.scope, 'crawlability')) {
    return res.status(409).json({ success: false, error: 'Crawlability checks were not included in this audit. Start an audit with crawlability checks to export a sitemap.' });
  }

  if (format === 'pdf') {
    if (!isCompletedAuditStatus(audit.status)) {
      return res.status(409).json({ success: false, error: 'PDF export is available after the audit completes.' });
    }
    if (!limits.pdfEnabled) {
      return res.status(403).json({ success: false, error: 'PDF reports require eligible Standard, Deep, or Admin audit access.', upgradeRequired: true });
    }
  } else if (!limits.exportsEnabled) {
    return res.status(403).json({ success: false, error: 'Data exports are not enabled for this plan.', upgradeRequired: true });
  }

  if (audit.processingVersion === 2 && format !== 'pdf') {
    const { handleScalableExportDownload, isScalableExportFormat } = await import('../lib/report/scalable-exports');
    if (isScalableExportFormat(format)) return handleScalableExportDownload(res, audit, format);
  }
  const liveData = await auditRepository.getLiveData(id, audit);

  if (format === 'sitemap.xml') {
    if (!isCompletedAuditStatus(audit.status)) return res.status(409).json({ success: false, error: 'Sitemap export is available after the audit completes.' });
    const { generateSitemap } = await import('../lib/tools/audit-tools');
    const result = generateSitemap(liveData.latestPages.slice(0, 100), new URL(audit.normalizedUrl).origin);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="crawlio-loaded-subset-sitemap.xml"');
    return res.send(result.xml);
  }

  if (format === 'pdf') {
    const { renderAuditPdf } = await import('../lib/report/pdf');
    const pdf = await renderAuditPdf(liveData);
    const safeHost = audit.hostname.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'website';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="crawlio-${safeHost}-audit.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    return res.status(200).send(pdf);
  }

  if (format === 'json') {
    return res.json({ success: true, data: buildPublicAuditExport(liveData) });
  }

  if (format === 'issues.csv') {
    const header = 'severity,category,title,affectedUrl,evidence,recommendation\n';
    const rows = scopeFindings(audit.scope, liveData.latestIssues).map((issue) => csvRow([issue.severity, issue.category, issue.title, issue.affectedUrl, issue.evidence, issue.recommendation])).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(header + rows);
  }

  if (format === 'pages.csv') {
    const fields = pageCsvFields(audit.scope);
    const header = `${fields.join(',')}\n`;
    const rows = liveData.latestPages.map((page) => csvRow(fields.map(field => page[field as keyof typeof page]))).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(header + rows);
  }

  return res.status(400).json({ success: false, error: 'Unsupported export format' });
}));
