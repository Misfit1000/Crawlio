import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { requireSupabaseAdminClient } from '../supabase/server';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SITES_URL = 'https://www.googleapis.com/webmasters/v3/sites';
const SEARCH_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function config() {
  return {
    clientId: String(process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID || ''),
    clientSecret: String(process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET || ''),
    encryptionSecret: String(process.env.SEARCH_TOKEN_ENCRYPTION_KEY || ''),
  };
}

export function searchConsoleConfigured() {
  const value = config();
  return value.clientId.length > 10 && value.clientSecret.length > 10 && value.encryptionSecret.length >= 32;
}

function requireConfig() {
  const value = config();
  if (!searchConsoleConfigured()) throw new Error('Google Search Console is not configured on the server.');
  return value;
}

function encryptionKey() {
  return createHash('sha256').update(requireConfig().encryptionSecret).digest();
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decrypt(value: string) {
  const [iv, tag, encrypted] = String(value || '').split('.');
  if (!iv || !tag || !encrypted) throw new Error('Stored Search Console credentials are invalid.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

async function fixedJsonFetch(url: string, init: RequestInit, maxBytes = 5_000_000) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000), redirect: 'error' });
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('Google returned an oversized response.');
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error('Google returned an invalid response.'); }
  if (!response.ok) throw new Error(String(data?.error_description || data?.error?.message || 'Google Search Console request failed.').slice(0, 240));
  return data;
}

export async function createSearchConsoleAuthorization(userId: string, redirectUri: string) {
  const { clientId } = requireConfig();
  const state = randomBytes(32).toString('base64url');
  const client = requireSupabaseAdminClient();
  await client.from('search_console_oauth_states').delete().eq('user_id', userId).or(`expires_at.lt.${new Date().toISOString()},used_at.not.is.null`);
  const result = await client.from('search_console_oauth_states').insert({
    state_hash: createHash('sha256').update(state).digest('hex'),
    user_id: userId,
    redirect_path: '/app/search-data',
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (result.error) throw result.error;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: `${SEARCH_SCOPE} openid email`,
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export async function completeSearchConsoleAuthorization(input: { state: string; code: string; redirectUri: string }) {
  const { clientId, clientSecret } = requireConfig();
  const client = requireSupabaseAdminClient();
  const stateHash = createHash('sha256').update(input.state).digest('hex');
  const stateResult = await client.from('search_console_oauth_states').select('*').eq('state_hash', stateHash).is('used_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (stateResult.error) throw stateResult.error;
  if (!stateResult.data) throw new Error('The Search Console connection request expired or was already used.');
  const usedResult = await client.from('search_console_oauth_states').update({ used_at: new Date().toISOString() }).eq('state_hash', stateHash).is('used_at', null).select('state_hash').maybeSingle();
  if (usedResult.error || !usedResult.data) throw new Error('The Search Console connection request was already used.');

  const token = await fixedJsonFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: input.code, client_id: clientId, client_secret: clientSecret, redirect_uri: input.redirectUri, grant_type: 'authorization_code' }),
  });
  const userInfo = await fixedJsonFetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token.access_token}` } }, 100_000);
  const subject = String(userInfo.sub || userInfo.email || '').slice(0, 240);
  if (!subject) throw new Error('Google did not return an account identity.');
  const existing = await client.from('search_console_accounts').select('id,encrypted_refresh_token').eq('user_id', stateResult.data.user_id).eq('provider_subject', subject).maybeSingle();
  if (existing.error) throw existing.error;
  const accountRow = {
    user_id: stateResult.data.user_id,
    provider_subject: subject,
    account_email: String(userInfo.email || '').slice(0, 320) || null,
    encrypted_access_token: encrypt(String(token.access_token)),
    encrypted_refresh_token: token.refresh_token ? encrypt(String(token.refresh_token)) : existing.data?.encrypted_refresh_token || null,
    token_expires_at: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(),
    scopes: String(token.scope || SEARCH_SCOPE).split(/\s+/).filter(Boolean),
    updated_at: new Date().toISOString(),
    ...(existing.data?.id ? { id: existing.data.id } : {}),
  };
  const accountResult = await client.from('search_console_accounts').upsert(accountRow, { onConflict: 'user_id,provider_subject' }).select('id').single();
  if (accountResult.error) throw accountResult.error;

  const sites = await fixedJsonFetch(SITES_URL, { headers: { Authorization: `Bearer ${token.access_token}` } }, 1_000_000);
  const rows = (Array.isArray(sites.siteEntry) ? sites.siteEntry : []).slice(0, 50).map((site: any) => ({
    account_id: accountResult.data.id,
    user_id: stateResult.data.user_id,
    site_url: String(site.siteUrl || '').slice(0, 2048),
    permission_level: String(site.permissionLevel || '').slice(0, 80) || null,
    updated_at: new Date().toISOString(),
  })).filter((site: any) => site.site_url);
  if (rows.length) {
    const propertyResult = await client.from('search_console_properties').upsert(rows, { onConflict: 'user_id,site_url' });
    if (propertyResult.error) throw propertyResult.error;
  }
  return { redirectPath: stateResult.data.redirect_path || '/app/search-data', propertyCount: rows.length };
}

async function accessTokenForAccount(account: any) {
  const tokenExpiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (tokenExpiresAt > Date.now() + 60_000) return decrypt(account.encrypted_access_token);
  if (!account.encrypted_refresh_token) throw new Error('Reconnect Google Search Console to refresh access.');
  const { clientId, clientSecret } = requireConfig();
  const refreshed = await fixedJsonFetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: decrypt(account.encrypted_refresh_token), grant_type: 'refresh_token' }),
  });
  const accessToken = String(refreshed.access_token);
  const client = requireSupabaseAdminClient();
  const update = await client.from('search_console_accounts').update({ encrypted_access_token: encrypt(accessToken), token_expires_at: new Date(Date.now() + Number(refreshed.expires_in || 3600) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('id', account.id);
  if (update.error) throw update.error;
  return accessToken;
}

function isoDate(daysAgo: number) {
  const date = new Date(Date.now() - daysAgo * 86_400_000);
  return date.toISOString().slice(0, 10);
}

async function queryPeriod(siteUrl: string, accessToken: string, period: 'current' | 'previous') {
  const startDate = period === 'current' ? isoDate(28) : isoDate(56);
  const endDate = period === 'current' ? isoDate(1) : isoDate(29);
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const data = await fixedJsonFetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate, endDate, dimensions: ['date', 'query', 'page', 'device'], rowLimit: 2000, dataState: 'final' }),
  });
  return (Array.isArray(data.rows) ? data.rows : []).map((row: any) => ({
    period,
    data_date: String(row.keys?.[0] || endDate),
    query: String(row.keys?.[1] || '').slice(0, 1000),
    page: String(row.keys?.[2] || '').slice(0, 2048),
    device: String(row.keys?.[3] || '').slice(0, 32),
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    ctr: Number(row.ctr || 0),
    position: Number(row.position || 0),
  }));
}

export async function searchConsoleStatus(userId: string) {
  const client = requireSupabaseAdminClient();
  if (!searchConsoleConfigured()) return { configured: false, properties: [] };
  const result = await client.from('search_console_properties').select('id,site_url,permission_level,last_synced_at,last_sync_status,last_sync_error').eq('user_id', userId).order('site_url').limit(50);
  if (result.error) throw result.error;
  return { configured: true, properties: (result.data || []).map((row) => ({ id: row.id, siteUrl: row.site_url, permissionLevel: row.permission_level, lastSyncedAt: row.last_synced_at, lastSyncStatus: row.last_sync_status, lastSyncError: row.last_sync_error })) };
}

export async function syncSearchConsoleProperty(userId: string, propertyId: string) {
  const client = requireSupabaseAdminClient();
  const propertyResult = await client.from('search_console_properties').select('*,search_console_accounts(*)').eq('id', propertyId).eq('user_id', userId).maybeSingle();
  if (propertyResult.error) throw propertyResult.error;
  if (!propertyResult.data) throw new Error('Search Console property not found.');
  await client.from('search_console_properties').update({ last_sync_status: 'syncing', last_sync_error: null }).eq('id', propertyId);
  try {
    const accessToken = await accessTokenForAccount(propertyResult.data.search_console_accounts);
    const [current, previous] = await Promise.all([
      queryPeriod(propertyResult.data.site_url, accessToken, 'current'),
      queryPeriod(propertyResult.data.site_url, accessToken, 'previous'),
    ]);
    const syncBatchAt = new Date().toISOString();
    const allRows = [...current, ...previous].map((row) => ({ ...row, property_id: propertyId, user_id: userId, imported_at: syncBatchAt }));
    try {
      for (let offset = 0; offset < allRows.length; offset += 500) {
        const insert = await client.from('search_console_rows').insert(allRows.slice(offset, offset + 500));
        if (insert.error) throw insert.error;
      }
      const cleanup = await client.from('search_console_rows').delete().eq('property_id', propertyId).eq('user_id', userId).lt('imported_at', syncBatchAt);
      if (cleanup.error) throw cleanup.error;
    } catch (error) {
      await client.from('search_console_rows').delete().eq('property_id', propertyId).eq('user_id', userId).eq('imported_at', syncBatchAt);
      throw error;
    }
    const syncedAt = new Date().toISOString();
    await client.from('search_console_properties').update({ last_synced_at: syncedAt, last_sync_status: 'ready', last_sync_error: null, updated_at: syncedAt }).eq('id', propertyId);
    return { currentRows: current.length, previousRows: previous.length, syncedAt };
  } catch (error) {
    await client.from('search_console_properties').update({ last_sync_status: 'failed', last_sync_error: (error instanceof Error ? error.message : 'Search Console sync failed.').slice(0, 300), updated_at: new Date().toISOString() }).eq('id', propertyId);
    throw error;
  }
}

export async function getSearchConsoleRows(userId: string, propertyId: string) {
  const client = requireSupabaseAdminClient();
  const property = await client.from('search_console_properties').select('id,site_url,last_synced_at').eq('id', propertyId).eq('user_id', userId).maybeSingle();
  if (property.error) throw property.error;
  if (!property.data) throw new Error('Search Console property not found.');
  const rows = await client.from('search_console_rows').select('period,data_date,query,page,device,clicks,impressions,ctr,position').eq('property_id', propertyId).eq('user_id', userId).order('impressions', { ascending: false }).limit(4000);
  if (rows.error) throw rows.error;
  return { property: { id: property.data.id, siteUrl: property.data.site_url, lastSyncedAt: property.data.last_synced_at }, rows: rows.data || [] };
}

export async function disconnectSearchConsole(userId: string) {
  const client = requireSupabaseAdminClient();
  const result = await client.from('search_console_accounts').delete().eq('user_id', userId);
  if (result.error) throw result.error;
}
