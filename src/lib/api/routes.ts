export const API_ROUTES = {
  auditStart: "/api/tools/audit/start",
  auditStatus: (id: string) => `/api/tools/audit/status/${id}`,
  auditResult: (id: string) => `/api/tools/audit/result/${id}`,
  auditEvents: (id: string) => `/api/tools/audit/events/${id}`,
  auditCancel: (id: string) => `/api/tools/audit/cancel/${id}`,
  auditExport: (id: string, format: string) => `/api/tools/audit/export/${id}/${format}`,
  auditRerun: (id: string) => `/api/tools/audit/rerun/${id}`,
  securityStart: "/api/tools/audit/start", // Based on the code, security audit calls /api/tools/audit/start with type="security"
  keywordResearch: "/api/tools/keyword/research",
  websiteAnalyze: "/api/tools/website/analyze",
  clusters: "/api/tools/clusters",
  contentBrief: "/api/tools/content-brief",
  competitorGap: "/api/tools/competitor-gap"
};
