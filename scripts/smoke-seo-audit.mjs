import { execSync } from 'child_process';
console.log("Running smoke test...");
try {
  execSync('npx tsx scripts/smoke-seo-audit-internal.ts', { stdio: 'inherit' });
} catch(e) {
  process.exit(1);
}
