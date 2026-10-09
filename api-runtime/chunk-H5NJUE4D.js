// Vercel API bundle. Rebuild with npm run build:vercel-api; PDFKit stays lazy-loaded.
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);
import{createHash,timingSafeEqual}from"node:crypto";function schedulerSecretMatches(supplied,expected){if(!expected||expected.length<24||supplied.length<24)return false;return timingSafeEqual(createHash("sha256").update(expected).digest(),createHash("sha256").update(supplied).digest())}function authorizeScheduler(supplied,scope,env=process.env){return schedulerSecretMatches(supplied,scope==="cron"?env.CRON_SECRET:env.BLOG_DISPATCH_SECRET)}export{authorizeScheduler};
