import { randomUUID } from 'node:crypto';
import { getSupabaseAdminClient } from '../supabase/server';

type Row = Record<string, any>;
const memoryDrafts = new Map<string, Row>();
const memoryNotifications = new Map<string, Row>();
let lastRetentionCleanupAt = 0;

function nowIso() { return new Date().toISOString(); }
function draftKey(adminUserId: string, clientDraftId: string) { return `${adminUserId}:${clientDraftId}`; }

async function cleanupExpiredRows(client: NonNullable<ReturnType<typeof getSupabaseAdminClient>>) {
  if (Date.now() - lastRetentionCleanupAt < 60 * 60 * 1000) return;
  lastRetentionCleanupAt = Date.now();
  await Promise.all([
    client.from('blog_editor_drafts').delete().lt('expires_at', nowIso()),
    client.from('blog_admin_notifications').delete().lt('expires_at', nowIso()),
  ]).catch(() => undefined);
}

function toDraft(row: Row) {
  return {
    id: String(row.id), clientDraftId: String(row.client_draft_id), articleId: row.article_id || null,
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {}, version: Number(row.version || 1),
    basePostUpdatedAt: row.base_post_updated_at || null, expiresAt: String(row.expires_at), updatedAt: String(row.updated_at),
  };
}

function toNotification(row: Row) {
  return {
    id: String(row.id), type: String(row.notification_type), title: String(row.title), message: String(row.message || ''),
    articleId: row.article_id || null, jobId: row.job_id || null, linkPath: String(row.link_path || '/admin'),
    readAt: row.read_at || null, createdAt: String(row.created_at),
  };
}

export class BlogDraftConflictError extends Error {
  constructor() { super('This draft was updated in another tab. Reload the latest saved draft before continuing.'); this.name = 'BlogDraftConflictError'; }
}

export const blogEditorRepository = {
  async getDraft(adminUserId: string, clientDraftId: string, articleId?: string | null) {
    const client = getSupabaseAdminClient();
    if (!client) {
      const rows = [...memoryDrafts.values()];
      const row = rows.find((item) => item.admin_user_id === adminUserId && (articleId ? item.article_id === articleId : item.client_draft_id === clientDraftId));
      return row ? toDraft(row) : null;
    }
    await cleanupExpiredRows(client);
    let request = client.from('blog_editor_drafts').select('*').eq('admin_user_id', adminUserId);
    request = articleId ? request.eq('article_id', articleId) : request.eq('client_draft_id', clientDraftId);
    const { data, error } = await request.maybeSingle();
    if (error) throw error;
    return data ? toDraft(data) : null;
  },

  async saveDraft(input: { adminUserId: string; clientDraftId: string; articleId?: string | null; payload: Record<string, unknown>; expectedVersion?: number | null; basePostUpdatedAt?: string | null }) {
    const existing = await blogEditorRepository.getDraft(input.adminUserId, input.clientDraftId, input.articleId);
    if (existing && input.expectedVersion != null && existing.version !== input.expectedVersion) throw new BlogDraftConflictError();
    const nextVersion = existing ? existing.version + 1 : 1;
    const row = { admin_user_id: input.adminUserId, client_draft_id: input.clientDraftId, article_id: input.articleId || null, payload: input.payload, version: nextVersion, base_post_updated_at: input.basePostUpdatedAt || null, expires_at: new Date(Date.now() + 30 * 86400000).toISOString() };
    const client = getSupabaseAdminClient();
    if (!client) {
      const stored = { ...(existing ? [...memoryDrafts.values()].find((item) => item.id === existing.id) : {}), ...row, id: existing?.id || randomUUID(), created_at: existing?.updatedAt || nowIso(), updated_at: nowIso() };
      memoryDrafts.set(draftKey(input.adminUserId, input.clientDraftId), stored);
      return toDraft(stored);
    }
    if (existing) {
      const { data, error } = await client.from('blog_editor_drafts').update(row).eq('id', existing.id).eq('version', existing.version).select('*').maybeSingle();
      if (error) throw error;
      if (!data) throw new BlogDraftConflictError();
      return toDraft(data);
    }
    const { data, error } = await client.from('blog_editor_drafts').insert(row).select('*').single();
    if (error?.code === '23505') throw new BlogDraftConflictError();
    if (error) throw error;
    return toDraft(data);
  },

  async deleteDraft(adminUserId: string, clientDraftId: string, articleId?: string | null) {
    const client = getSupabaseAdminClient();
    if (!client) {
      for (const [key, row] of memoryDrafts) if (row.admin_user_id === adminUserId && (articleId ? row.article_id === articleId : row.client_draft_id === clientDraftId)) memoryDrafts.delete(key);
      return;
    }
    let request = client.from('blog_editor_drafts').delete().eq('admin_user_id', adminUserId);
    request = articleId ? request.eq('article_id', articleId) : request.eq('client_draft_id', clientDraftId);
    const { error } = await request;
    if (error) throw error;
  },

  async createNotification(input: { adminUserId?: string | null; type: 'blog_published' | 'blog_needs_attention' | 'blog_failed'; title: string; message: string; articleId?: string | null; jobId?: string | null; linkPath?: string }) {
    if (!input.adminUserId) return null;
    const row = { admin_user_id: input.adminUserId, notification_type: input.type, title: input.title.slice(0, 160), message: input.message.slice(0, 500), article_id: input.articleId || null, job_id: input.jobId || null, link_path: (input.linkPath || '/admin').slice(0, 300), expires_at: new Date(Date.now() + 90 * 86400000).toISOString() };
    const client = getSupabaseAdminClient();
    if (!client) {
      const duplicate = [...memoryNotifications.values()].find((item) => item.admin_user_id === input.adminUserId && item.job_id === input.jobId && item.notification_type === input.type);
      if (duplicate) return toNotification(duplicate);
      const stored = { ...row, id: randomUUID(), read_at: null, created_at: nowIso() };
      memoryNotifications.set(stored.id, stored);
      return toNotification(stored);
    }
    const { data, error } = await client.from('blog_admin_notifications').upsert(row, { onConflict: 'admin_user_id,job_id,notification_type', ignoreDuplicates: true }).select('*').maybeSingle();
    if (error) throw error;
    return data ? toNotification(data) : null;
  },

  async listNotifications(adminUserId: string, limit = 30) {
    const client = getSupabaseAdminClient();
    if (!client) return [...memoryNotifications.values()].filter((row) => row.admin_user_id === adminUserId && new Date(row.expires_at).getTime() > Date.now()).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit).map(toNotification);
    await cleanupExpiredRows(client);
    const { data, error } = await client.from('blog_admin_notifications').select('*').eq('admin_user_id', adminUserId).gt('expires_at', nowIso()).order('created_at', { ascending: false }).limit(Math.max(1, Math.min(50, limit)));
    if (error) throw error;
    return (data || []).map(toNotification);
  },

  async markNotificationsRead(adminUserId: string, ids?: string[]) {
    const readAt = nowIso();
    const safeIds = [...new Set((ids || []).map(String))].slice(0, 50);
    const client = getSupabaseAdminClient();
    if (!client) {
      for (const row of memoryNotifications.values()) if (row.admin_user_id === adminUserId && (!safeIds.length || safeIds.includes(row.id))) row.read_at = readAt;
      return;
    }
    let request = client.from('blog_admin_notifications').update({ read_at: readAt }).eq('admin_user_id', adminUserId).is('read_at', null);
    if (safeIds.length) request = request.in('id', safeIds);
    const { error } = await request;
    if (error) throw error;
  },
};
