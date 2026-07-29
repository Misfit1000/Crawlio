import { getSupabaseAdminClient } from '../supabase/server';
import type { ResourceAuditDocument, ResourceAuditReport } from '../audit/resource-types';

function scoreOf(report: ResourceAuditReport | null | undefined) {
  const value = Number(report?.scores?.overall);
  return report?.scores?.overall == null || !Number.isFinite(value) ? null : Math.round(value);
}

async function insertNotification(client: any, row: Record<string, unknown>) {
  const result = await client.from('project_notifications').insert(row);
  if (result.error && result.error.code !== '23505') throw result.error;
}

export async function recordProjectAuditCompletion(audit: ResourceAuditDocument, report: ResourceAuditReport) {
  if (!audit.projectId || !audit.userId) return;
  const client = getSupabaseAdminClient();
  if (!client) return;
  const projectResult = await client.from('projects').select('id,user_id,name,change_alerts_enabled').eq('id', audit.projectId).eq('user_id', audit.userId).maybeSingle();
  if (projectResult.error || !projectResult.data) return;
  await client.from('projects').update({ last_audit_id: audit.id, last_audit_at: audit.completedAt || new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', audit.projectId);
  if (!projectResult.data.change_alerts_enabled) return;

  const previousResult = await client.from('audits').select('id').eq('project_id', audit.projectId).in('status', ['completed', 'completed_with_warnings']).neq('id', audit.id).order('completed_at', { ascending: false }).limit(1).maybeSingle();
  const previousReportResult = previousResult.data?.id
    ? await client.from('audit_reports').select('scores,top_issues').eq('audit_id', previousResult.data.id).maybeSingle()
    : { data: null, error: null };
  const currentScore = scoreOf(report);
  const previousScoreRaw = Number(previousReportResult.data?.scores?.overall);
  const previousScore = previousReportResult.data?.scores?.overall == null || !Number.isFinite(previousScoreRaw) ? null : Math.round(previousScoreRaw);
  const previousCritical = new Set((previousReportResult.data?.top_issues || []).filter((issue: any) => issue?.severity === 'critical').map((issue: any) => String(issue.findingKey || `${issue.category}|${issue.title}|${issue.affectedUrl}`).toLowerCase()));
  const newCritical = (report.topIssues || []).filter((issue) => issue.severity === 'critical' && !previousCritical.has(String(issue.findingKey || `${issue.category}|${issue.title}|${issue.affectedUrl}`).toLowerCase())).length;
  const base = { project_id: audit.projectId, user_id: audit.userId, audit_id: audit.id };
  await insertNotification(client, { ...base, kind: 'audit_completed', title: `${projectResult.data.name} audit completed`, message: `Checked ${audit.pagesCrawled} pages and recorded ${audit.issuesFound} findings.` });
  if (currentScore != null && previousScore != null && currentScore <= previousScore - 5) {
    await insertNotification(client, { ...base, kind: 'score_drop', title: `${projectResult.data.name} score decreased`, message: `The measured audit score changed from ${previousScore} to ${currentScore}. Review new and persistent findings.` });
  }
  if (newCritical > 0) {
    await insertNotification(client, { ...base, kind: 'new_critical', title: `New critical findings on ${projectResult.data.name}`, message: `${newCritical} critical ${newCritical === 1 ? 'finding was' : 'findings were'} not present in the previous completed audit.` });
  }
}

export async function recordProjectAuditFailure(audit: ResourceAuditDocument, message: string) {
  if (!audit.projectId || !audit.userId) return;
  const client = getSupabaseAdminClient();
  if (!client) return;
  const project = await client.from('projects').select('id,name,change_alerts_enabled').eq('id', audit.projectId).eq('user_id', audit.userId).maybeSingle();
  if (project.error || !project.data?.change_alerts_enabled) return;
  await insertNotification(client, { project_id: audit.projectId, user_id: audit.userId, audit_id: audit.id, kind: 'audit_failed', title: `${project.data.name} audit needs attention`, message: String(message || 'The audit could not complete.').slice(0, 600) });
}
