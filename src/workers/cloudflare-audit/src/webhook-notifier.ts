import type { ResourceAuditReport } from '../../../lib/audit/resource-types';

export interface WebhookNotificationOptions {
  webhookUrl: string;
  auditId: string;
  targetUrl: string;
  report: ResourceAuditReport;
  status: 'completed' | 'failed' | 'completed_with_warnings';
}

export async function sendWebhookNotification(options: WebhookNotificationOptions): Promise<boolean> {
  const { webhookUrl, auditId, targetUrl, report, status } = options;
  const scores = (report.scores || {}) as Record<string, any>;
  const overall = scores.overall ?? 0;
  const grade = scores.grade ?? 'N/A';
  const issueCount = report.topIssues.length;

  const isSlackOrDiscord = webhookUrl.includes('hooks.slack.com') || webhookUrl.includes('discord.com/api/webhooks');

  let payload: any;

  if (isSlackOrDiscord) {
    const statusEmoji = status === 'completed' ? '✅' : status === 'completed_with_warnings' ? '⚠️' : '🚨';
    payload = {
      content: `${statusEmoji} **Crawlio Audit Finished: ${targetUrl}**`,
      text: `${statusEmoji} Crawlio Audit Finished: ${targetUrl} (Score: ${overall}/100, Grade: ${grade}, Issues: ${issueCount})`,
      embeds: [
        {
          title: `Audit Report: ${targetUrl}`,
          color: overall >= 80 ? 0x22c55e : overall >= 50 ? 0xf59e0b : 0xef4444,
          fields: [
            { name: 'Health Score', value: `${overall} / 100 (${grade})`, inline: true },
            { name: 'Pages Audited', value: `${report.pages.length}`, inline: true },
            { name: 'Issues Detected', value: `${issueCount}`, inline: true },
            { name: 'Audit ID', value: `\`${auditId}\``, inline: false },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    };
  } else {
    payload = {
      event: 'audit_completed',
      auditId,
      targetUrl,
      status,
      timestamp: new Date().toISOString(),
      score: {
        overall,
        grade,
        seo: scores.seo,
        technical: scores.technical,
        performance: scores.performance,
        security: scores.security,
      },
      summary: report.summary,
      totalIssues: issueCount,
      pagesAudited: report.pages.length,
    };
  }

  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
