import { createHash } from 'node:crypto';
import { requireSupabaseAdminClient } from '../supabase/server';
import { isImportSourceKind, type ImportSourceKind, type ProjectDataImportRows, type ProjectDataImportSummary } from './types';

const MAX_ROWS = 5_000;
const MAX_COLUMNS = 60;
const MAX_VALUE_LENGTH = 2_000;

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maxLength);
}

function normalizeRow(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: Record<string, string | number | boolean | null> = Object.create(null);
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>).slice(0, MAX_COLUMNS)) {
    const key = cleanText(rawKey, 120);
    if (!key || Object.prototype.hasOwnProperty.call(result, key)) continue;
    if (rawValue == null || typeof rawValue === 'number' || typeof rawValue === 'boolean') result[key] = rawValue as number | boolean | null;
    else result[key] = cleanText(rawValue, MAX_VALUE_LENGTH);
  }
  // Leave room for JSONB's whitespace formatting in the database constraint.
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 15000) throw new Error('An import row is too large. Remove unnecessary columns and try again.');
  return result;
}

function mapSummary(row: any): ProjectDataImportSummary {
  return {
    id: String(row.id),
    projectId: row.project_id || null,
    sourceKind: row.source_kind,
    fileName: row.file_name,
    headers: Array.isArray(row.headers) ? row.headers : [],
    rowCount: Number(row.row_count || 0),
    importedAt: row.imported_at,
    expiresAt: row.expires_at,
  };
}

async function assertProjectOwnership(userId: string, projectId: string | null) {
  if (!projectId) return;
  const client = requireSupabaseAdminClient();
  const result = await client.from('projects').select('id').eq('id', projectId).eq('user_id', userId).maybeSingle();
  if (result.error || !result.data) throw new Error('The selected project is unavailable.');
}

export async function listProjectDataImports(userId: string) {
  const client = requireSupabaseAdminClient();
  const result = await client.from('project_data_imports')
    .select('id,project_id,source_kind,file_name,headers,row_count,imported_at,expires_at')
    .eq('user_id', userId)
    .order('imported_at', { ascending: false })
    .limit(100);
  if (result.error) throw result.error;
  return (result.data || []).map(mapSummary);
}

export async function readProjectDataImport(userId: string, importId: string): Promise<ProjectDataImportRows> {
  const client = requireSupabaseAdminClient();
  const batch = await client.from('project_data_imports')
    .select('id,project_id,source_kind,file_name,headers,row_count,imported_at,expires_at')
    .eq('id', importId).eq('user_id', userId).maybeSingle();
  if (batch.error || !batch.data) throw new Error('Import not found.');
  const values: ProjectDataImportRows['rows'] = [];
  for (let offset = 0; offset < Math.min(MAX_ROWS, batch.data.row_count); offset += 500) {
    const rows = await client.from('project_data_rows').select('values_json,row_number').eq('import_id', importId).eq('user_id', userId).order('row_number').range(offset, offset + 499);
    if (rows.error) throw rows.error;
    values.push(...(rows.data || []).map((row: any) => row.values_json || {}));
  }
  if (values.length !== batch.data.row_count) throw new Error('This import is still being saved or is incomplete. Try loading it again.');
  return { import: mapSummary(batch.data), rows: values };
}

export async function saveProjectDataImport(userId: string, input: { projectId?: unknown; sourceKind: unknown; fileName: unknown; rows: unknown }) {
  if (!isImportSourceKind(input.sourceKind)) throw new Error('Unsupported import type.');
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > MAX_ROWS) throw new Error(`Import between 1 and ${MAX_ROWS.toLocaleString()} rows.`);
  const projectId = cleanText(input.projectId, 64) || null;
  await assertProjectOwnership(userId, projectId);
  const rows = input.rows.map(normalizeRow);
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, MAX_COLUMNS);
  if (!headers.length) throw new Error('The import does not contain usable column headers.');
  const fileName = cleanText(input.fileName, 240) || `${input.sourceKind}.csv`;
  const fingerprint = createHash('sha256').update(JSON.stringify({ sourceKind: input.sourceKind, projectId, headers, rows })).digest('hex');
  const client = requireSupabaseAdminClient();
  const existing = await client.from('project_data_imports').select('id,project_id,source_kind,file_name,headers,row_count,imported_at,expires_at').eq('user_id', userId).eq('source_kind', input.sourceKind).eq('fingerprint', fingerprint).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return mapSummary(existing.data);

  const inserted = await client.from('project_data_imports').insert({
    user_id: userId,
    project_id: projectId,
    source_kind: input.sourceKind,
    file_name: fileName,
    fingerprint,
    headers,
    row_count: rows.length,
  }).select('id,project_id,source_kind,file_name,headers,row_count,imported_at,expires_at').single();
  if (inserted.error) throw inserted.error;
  const importId = String(inserted.data.id);
  for (let offset = 0; offset < rows.length; offset += 500) {
    const chunk = rows.slice(offset, offset + 500).map((values, index) => ({
      import_id: importId,
      user_id: userId,
      project_id: projectId,
      source_kind: input.sourceKind as ImportSourceKind,
      row_number: offset + index + 1,
      values_json: values,
    }));
    const rowResult = await client.from('project_data_rows').insert(chunk);
    if (rowResult.error) {
      await client.from('project_data_imports').delete().eq('id', importId).eq('user_id', userId);
      throw rowResult.error;
    }
  }
  return mapSummary(inserted.data);
}

export async function deleteProjectDataImport(userId: string, importId: string) {
  const client = requireSupabaseAdminClient();
  const result = await client.from('project_data_imports').delete().eq('id', importId).eq('user_id', userId).select('id').maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Import not found.');
}
