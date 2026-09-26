import { normalizeUserUrl } from '../seo/url-utils';
import { requireSupabaseAdminClient } from '../supabase/server';
import type { AuditMode } from '../audit/resource-types';
import type { ProjectAuditFrequency, ProjectAuditSummary, ProjectOverviewItem, ProjectOverviewResponse } from './types';

type Row = Record<string, any>;

function finiteScore(value: unknown) {
  const score = Number(value);
  return value == null || !Number.isFinite(score) ? null : Math.max(0, Math.min(100, Math.round(score)));
}

function auditSummary(row: Row, report?: Row): ProjectAuditSummary {
  return {
    id: String(row.id),
    status: row.status,
    score: finiteScore(report?.scores?.overall),
    pagesCrawled: Number(row.pages_crawled || 0),
    issuesFound: Number(row.issues_found || 0),
    criticalCount: Number(row.critical_count || 0),
    highCount: Number(row.high_count || 0),
    completedAt: row.completed_at || null,
    createdAt: row.created_at,
  };
}

function issueKey(issue: any) {
  return String(issue?.findingKey || issue?.finding_key || `${issue?.category || ''}|${issue?.title || ''}|${issue?.affectedUrl || issue?.affected_url || ''}`).trim().toLowerCase();
}

function actionFor(latest: ProjectAuditSummary | null, scoreDelta: number | null, newCritical: number) {
  if (!latest) return 'Run the first website audit.';
  if (latest.status === 'queued' || latest.status === 'running') return 'Open the live audit and follow its progress.';
  if (latest.status === 'failed' || latest.status === 'abandoned') return 'Review the audit failure and rerun when the website is reachable.';
  if (newCritical > 0) return `Review ${newCritical} new critical ${newCritical === 1 ? 'finding' : 'findings'} first.`;
  if (scoreDelta != null && scoreDelta < -4) return `Investigate the ${Math.abs(scoreDelta)}-point score drop.`;
  if (latest.criticalCount > 0) return `Resolve ${latest.criticalCount} critical ${latest.criticalCount === 1 ? 'finding' : 'findings'}.`;
  if (latest.highCount > 0) return `Work through ${latest.highCount} high-priority ${latest.highCount === 1 ? 'finding' : 'findings'}.`;
  return 'Schedule the next audit or review lower-priority improvements.';
}

export async function listProjectOverview(userId: string): Promise<ProjectOverviewResponse> {
  const client = requireSupabaseAdminClient();
  const [projectResult, auditResult, notificationResult] = await Promise.all([
    client.from('projects').select('id,name,description,normalized_url,hostname,audit_frequency,audit_mode,next_audit_at,last_audit_at,last_audit_id,change_alerts_enabled,created_at,updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(100),
    client.rpc('project_audit_summaries', { p_user_id: userId }),
    client.from('project_notifications').select('*', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null),
  ]);
  if (projectResult.error) throw projectResult.error;
  if (notificationResult.error) throw notificationResult.error;

  let audits = (auditResult.data || []) as Row[];
  const reportByAudit = new Map<string, Row>();
  if (!auditResult.error) {
    for (const audit of audits) reportByAudit.set(String(audit.id), { scores: audit.scores, top_issues: audit.top_issues });
  } else {
    // Keep the API available during the additive database-first migration window.
    const legacyAudits = await client.from('audits').select('id,project_id,normalized_url,hostname,status,pages_crawled,issues_found,critical_count,high_count,completed_at,created_at').eq('user_id', userId).is('archived_at', null).order('created_at', { ascending: false }).limit(200);
    if (legacyAudits.error) throw legacyAudits.error;
    audits = legacyAudits.data || [];
    if (audits.length) {
      const reports = await client.from('audit_reports').select('audit_id,scores,top_issues').in('audit_id', audits.map((audit) => audit.id));
      if (reports.error) throw reports.error;
      for (const report of reports.data || []) reportByAudit.set(String(report.audit_id), report);
    }
  }

  const configuredByHost = new Map((projectResult.data || []).filter((project) => project.hostname).map((project) => [String(project.hostname).toLowerCase(), project]));
  const hosts = new Set<string>([...configuredByHost.keys(), ...audits.map((audit) => String(audit.hostname || '').toLowerCase()).filter(Boolean)]);
  const projects: ProjectOverviewItem[] = [];

  for (const hostname of hosts) {
    const configured = configuredByHost.get(hostname);
    const siteAudits = audits.filter((audit) => String(audit.hostname || '').toLowerCase() === hostname);
    const completed = siteAudits.filter((audit) => ['completed', 'completed_with_warnings'].includes(String(audit.status)));
    const latestRow = siteAudits[0] || null;
    const latestCompletedRow = completed[0] || null;
    const previousCompletedRow = completed[1] || null;
    const latestForScore = latestCompletedRow || latestRow;
    const latest = latestForScore ? auditSummary(latestForScore, reportByAudit.get(String(latestForScore.id))) : null;
    const previous = previousCompletedRow ? auditSummary(previousCompletedRow, reportByAudit.get(String(previousCompletedRow.id))) : null;
    const scoreDelta = latest?.score != null && previous?.score != null ? latest.score - previous.score : null;
    const latestIssues = (reportByAudit.get(String(latestCompletedRow?.id || ''))?.top_issues || []) as any[];
    const previousIssues = (reportByAudit.get(String(previousCompletedRow?.id || ''))?.top_issues || []) as any[];
    const currentKeys = new Set(latestIssues.map(issueKey));
    const previousKeys = new Set(previousIssues.map(issueKey));
    const newCriticalCount = latestIssues.filter((issue) => issue?.severity === 'critical' && !previousKeys.has(issueKey(issue))).length;
    const resolvedFindingCount = previousIssues.filter((issue) => !currentKeys.has(issueKey(issue))).length;

    projects.push({
      id: configured?.id || null,
      name: configured?.name || hostname,
      normalizedUrl: configured?.normalized_url || latestRow?.normalized_url || `https://${hostname}`,
      hostname,
      auditFrequency: (configured?.audit_frequency || 'manual') as ProjectAuditFrequency,
      auditMode: (configured?.audit_mode || 'quick') as AuditMode,
      nextAuditAt: configured?.next_audit_at || null,
      changeAlertsEnabled: configured?.change_alerts_enabled !== false,
      latestAudit: latest,
      previousAudit: previous,
      scoreDelta,
      newCriticalCount,
      resolvedFindingCount,
      openFindingCount: latestIssues.length || latest?.issuesFound || 0,
      recommendedAction: actionFor(latest, scoreDelta, newCriticalCount),
    });
  }

  projects.sort((left, right) => String(right.latestAudit?.createdAt || '').localeCompare(String(left.latestAudit?.createdAt || '')));
  return { projects, unreadNotifications: notificationResult.count || 0, scheduledAuditsEnabled: false, generatedAt: new Date().toISOString() };
}

export async function upsertProject(userId: string, input: { name?: unknown; url: unknown }) {
  const normalized = normalizeUserUrl(String(input.url || ''));
  if (!normalized.isValid) throw new Error(normalized.error || 'Enter a valid public website URL.');
  const client = requireSupabaseAdminClient();
  const name = String(input.name || normalized.hostname).trim().slice(0, 120) || normalized.hostname;
  const result = await client.from('projects').upsert({
    user_id: userId,
    name,
    normalized_url: normalized.normalizedUrl,
    hostname: normalized.hostname,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,hostname' }).select('id,name,normalized_url,hostname,audit_frequency,audit_mode,next_audit_at,change_alerts_enabled').single();
  if (result.error) throw result.error;
  await client.from('audits').update({ project_id: result.data.id }).eq('user_id', userId).eq('hostname', normalized.hostname).is('project_id', null);
  return result.data;
}

export async function updateProjectSettings(userId: string, projectId: string, input: { name?: unknown; auditFrequency?: unknown; auditMode?: unknown; changeAlertsEnabled?: unknown }) {
  const frequencies = new Set<ProjectAuditFrequency>(['manual', 'weekly', 'monthly']);
  const modes = new Set<AuditMode>(['quick', 'standard', 'deep']);
  const frequency = frequencies.has(input.auditFrequency as ProjectAuditFrequency) ? input.auditFrequency as ProjectAuditFrequency : undefined;
  const mode = modes.has(input.auditMode as AuditMode) ? input.auditMode as AuditMode : undefined;
  const patch: Row = { updated_at: new Date().toISOString() };
  if (input.name != null) patch.name = String(input.name).trim().slice(0, 120);
  if (frequency) {
    patch.audit_frequency = frequency;
    patch.next_audit_at = frequency === 'manual' ? null : new Date(Date.now() + (frequency === 'weekly' ? 7 : 30) * 86_400_000).toISOString();
  }
  if (mode) patch.audit_mode = mode;
  if (typeof input.changeAlertsEnabled === 'boolean') patch.change_alerts_enabled = input.changeAlertsEnabled;
  const client = requireSupabaseAdminClient();
  const result = await client.from('projects').update(patch).eq('id', projectId).eq('user_id', userId).select('id,name,normalized_url,hostname,audit_frequency,audit_mode,next_audit_at,change_alerts_enabled').maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Project not found.');
  return result.data;
}
