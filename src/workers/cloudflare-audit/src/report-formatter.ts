import type { ResourceAuditReport } from '../../../lib/audit/resource-types';

export function formatReportToMarkdown(report: ResourceAuditReport, targetUrl: string): string {
  const scores = report.scores as Record<string, any>;
  const overall = scores.overall ?? 0;
  const grade = scores.grade ?? 'N/A';

  const categoryEmoji: Record<string, string> = {
    critical: '🚨',
    high: '⚠️',
    medium: 'ℹ️',
    low: '🔍',
    info: '💡',
  };

  let md = `# 📊 SEO Audit Executive Report: ${targetUrl}\n\n`;
  md += `**Generated:** ${report.generatedAt} | **Engine Version:** ${scores.auditEngineVersion || '2026.09'} | **Executor:** ${scores.executor || 'Cloudflare Worker'}\n\n`;

  // Scoreboard
  md += `## 🏆 Overall Health Score\n\n`;
  md += `### Score: **${overall} / 100** (Grade: **${grade}**)\n\n`;

  md += `| Category | Score | Status |\n`;
  md += `| :--- | :---: | :--- |\n`;
  md += `| 📄 On-Page SEO | **${scores.seo ?? 'N/A'}** | ${scoreBadge(scores.seo)} |\n`;
  md += `| ⚙️ Technical SEO | **${scores.technical ?? 'N/A'}** | ${scoreBadge(scores.technical)} |\n`;
  md += `| 🕷️ Crawlability | **${scores.crawlability ?? 'N/A'}** | ${scoreBadge(scores.crawlability)} |\n`;
  md += `| 🔗 Internal Links | **${scores.internalLinks ?? 'N/A'}** | ${scoreBadge(scores.internalLinks)} |\n`;
  md += `| ⚡ Performance | **${scores.performance ?? 'N/A'}** | ${scoreBadge(scores.performance)} |\n`;
  md += `| 🛡️ Security | **${scores.security ?? 'N/A'}** | ${scoreBadge(scores.security)} |\n`;
  md += `| ♿ Accessibility | **${scores.accessibility ?? 'N/A'}** | ${scoreBadge(scores.accessibility)} |\n\n`;

  // Crawl Coverage
  const cov = scores.coverage || {};
  md += `## 📈 Crawl Coverage\n\n`;
  md += `- **Pages Discovered:** ${cov.pagesDiscovered ?? report.pages.length}\n`;
  md += `- **Pages Analysed:** ${cov.pagesAnalysed ?? report.pages.length}\n`;
  md += `- **Coverage Target:** ${cov.coveragePercent ?? 100}%\n`;
  md += `- **Stop Reason:** \`${cov.stopReason || 'crawl_queue_exhausted'}\`\n\n`;

  // Top Issues
  md += `## 🚨 Key Issues & Action Plan\n\n`;
  if (report.topIssues.length === 0) {
    md += `✅ **No critical or high-severity issues found!** The site adheres well to modern SEO and technical guidelines.\n\n`;
  } else {
    md += `Below are the highest priority items requiring remediation:\n\n`;
    for (let i = 0; i < Math.min(15, report.topIssues.length); i++) {
      const issue = report.topIssues[i];
      const icon = categoryEmoji[issue.severity] || '⚠️';
      md += `### ${i + 1}. ${icon} [${issue.severity.toUpperCase()}] ${issue.title}\n\n`;
      md += `- **Category:** ${issue.category}\n`;
      md += `- **Affected URL:** \`${issue.affectedUrl}\`\n`;
      md += `- **Issue:** ${issue.description}\n`;
      if (issue.evidence) {
        md += `- **Evidence:** \`${issue.evidence}\`\n`;
      }
      md += `- **💡 Recommendation:** ${issue.recommendation}\n\n`;
    }
  }

  // Crawled Pages Sample
  md += `## 📑 Crawled Pages Overview (${report.pages.length})\n\n`;
  md += `| Status | Response | Title | Issues | URL |\n`;
  md += `| :---: | :---: | :--- | :---: | :--- |\n`;
  for (const p of report.pages.slice(0, 20)) {
    const statusIcon = p.statusCode >= 200 && p.statusCode < 300 ? '✅' : '❌';
    md += `| ${statusIcon} ${p.statusCode} | ${p.responseTimeMs}ms | ${(p.title || 'Untitled').slice(0, 35)} | ${p.issueCount} | \`${p.url}\` |\n`;
  }

  if (report.pages.length > 20) {
    md += `\n*... and ${report.pages.length - 20} more pages.* \n`;
  }

  md += `\n---\n*Report generated automatically by Crawlio Worker Bot.*`;
  return md;
}

function scoreBadge(score: number | undefined): string {
  if (score === undefined || score === null) return '⚪ Unknown';
  if (score >= 90) return '🟢 Excellent';
  if (score >= 75) return '🟡 Good';
  if (score >= 50) return '🟠 Needs Improvement';
  return '🔴 Poor';
}
