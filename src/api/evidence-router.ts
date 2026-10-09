import { Router } from 'express';

import { createHash } from 'node:crypto';

import { auditRepository } from '../lib/supabase/audit-repository';

import { ensureUserProfileFromAuthUser, getAuthenticatedUserFromRequest } from '../lib/billing/entitlements';

import type { ResourceAuditDocument } from '../lib/audit/resource-types';

import { registerScalableEvidenceRoutes } from './scalable-evidence-routes';

import { registerAuditToolRoutes } from './audit-tool-routes';

import { registerScoreBadgeRoutes } from './score-badge-routes';


export const apiRouter = Router();


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

registerScalableEvidenceRoutes(apiRouter, {
  requireAccess: async (req, auditId) => {
    const audit = await auditRepository.getAudit(auditId);
    return audit && await canAccessAudit(req, audit) ? audit : null;
  },
});

registerAuditToolRoutes(apiRouter, {
  requireAccess: async (req, auditId) => {
    const audit = await auditRepository.getAudit(auditId);
    return audit && await canAccessAudit(req, audit) ? audit : null;
  },
});

registerScoreBadgeRoutes(apiRouter, { getRequester, readAudit: auditId => auditRepository.getAudit(auditId) });

async function canAccessAudit(req: any, audit: ResourceAuditDocument) {
  const requester = await getRequester(req);
  if (requester.profile?.role === 'admin') return true;
  if (audit.userId) return requester.userId === audit.userId;
  if (audit.guestKeyHash) return guestIdentityForRequest(req).guestKeyHash === audit.guestKeyHash;
  return false;
}
