// Vercel API bundle. Rebuild with npm run build:vercel-api; PDFKit stays lazy-loaded.
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);
var USABLE_REPORT_AUDIT_STATUSES=new Set(["completed","completed_with_warnings"]);function isCompletedAuditStatus(status){return Boolean(status&&USABLE_REPORT_AUDIT_STATUSES.has(status))}export{isCompletedAuditStatus};
