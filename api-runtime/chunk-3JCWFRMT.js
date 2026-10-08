// Vercel API bundle. Rebuild with npm run build:vercel-api; PDFKit stays lazy-loaded.
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);
var TERMINAL_AUDIT_STATUSES=new Set(["completed","completed_with_warnings","failed","cancelled","abandoned"]);var USABLE_REPORT_AUDIT_STATUSES=new Set(["completed","completed_with_warnings"]);function isTerminalAuditStatus(status){return Boolean(status&&TERMINAL_AUDIT_STATUSES.has(status))}function isCompletedAuditStatus(status){return Boolean(status&&USABLE_REPORT_AUDIT_STATUSES.has(status))}export{isTerminalAuditStatus,isCompletedAuditStatus};
