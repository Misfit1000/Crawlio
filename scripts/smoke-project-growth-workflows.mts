import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findingImpact } from '../src/lib/audit/report-insights';

const migration = readFileSync('supabase/migrations/021_project_growth_workflows.sql', 'utf8');
const api = readFileSync('src/api/index.ts', 'utf8');
const routes = readFileSync('src/lib/api/routes.ts', 'utf8');
const searchConsole = readFileSync('src/lib/search-console/server.ts', 'utf8');
const projectService = readFileSync('src/lib/projects/service.ts', 'utf8');
const projectCompletion = readFileSync('src/lib/projects/completion.ts', 'utf8');
const projectUi = readFileSync('src/components/projects/ProjectCockpit.tsx', 'utf8');
const searchUi = readFileSync('src/components/SearchData.tsx', 'utf8');
const sharedUi = readFileSync('src/components/audit/SharedReportPage.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const worker = readFileSync('src/workers/audit-worker.ts', 'utf8');
const vercel = readFileSync('vercel.json', 'utf8');
const indexNow = readFileSync('src/lib/blog/indexnow.ts', 'utf8');
const router = readFileSync('src/app/router.tsx', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');

for (const table of [
  'project_notifications',
  'report_shares',
  'search_console_oauth_states',
  'search_console_accounts',
  'search_console_properties',
  'search_console_rows',
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'), `${table} is missing`);
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} RLS is missing`);
}
for (const table of ['report_shares', 'search_console_oauth_states', 'search_console_accounts', 'search_console_properties', 'search_console_rows']) {
  assert.match(migration, new RegExp(`revoke all on public\\.${table} from anon, authenticated`, 'i'), `${table} must be server-only`);
}
assert.match(migration, /unique index if not exists projects_owner_hostname_unique_idx\s+on public\.projects \(user_id, hostname\)/i);
assert.match(migration, /create or replace function public\.protect_project_managed_fields/);
assert.match(migration, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
assert.match(migration, /revoke update on public\.project_notifications from anon, authenticated/);
assert.match(migration, /token_hash text not null unique/);
assert.doesNotMatch(migration, /\n\s+token text/i, 'share tokens must not be stored in plaintext');

assert.match(api, /eq\('id', String\(projectId\)\)\.eq\('user_id', userId\)/, 'audit project ownership must be checked');
assert.match(api, /projectResult\.data\.hostname[\s\S]*normalized\.hostname/, 'audit project hostname must be checked');
assert.match(api, /limit\(10\)/, 'scheduled project admission must remain bounded');
assert.match(api, /schedulerRequestAllowed/);
assert.match(api, /randomBytes\(32\)\.toString\('base64url'\)/);
assert.match(api, /createHash\('sha256'\)\.update\(token\)/);
assert.match(api, /private, no-store/);
assert.match(routes, /sharedReport/);
assert.match(routes, /searchConsoleStatus/);

assert.match(searchConsole, /createCipheriv\('aes-256-gcm'/);
assert.match(searchConsole, /SEARCH_TOKEN_ENCRYPTION_KEY/);
assert.match(searchConsole, /AbortSignal\.timeout\(12_000\)/);
assert.match(searchConsole, /redirect: 'error'/);
assert.match(searchConsole, /rowLimit: 2000/);
assert.doesNotMatch(`${projectUi}\n${searchUi}\n${sharedUi}`, /SUPABASE_SERVICE_ROLE_KEY|GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET|SEARCH_TOKEN_ENCRYPTION_KEY/);

assert.match(projectService, /onConflict: 'user_id,hostname'/);
assert.match(projectCompletion, /result\.error\.code !== '23505'/);
assert.match(worker, /getPreviousProjectPages/);
assert.match(worker, /recordProjectAuditCompletion/);
assert.match(sharedUi, /Read-only report/);
assert.match(app, /noindex, nofollow/);
assert.match(vercel, /projects\/scheduler\/run/);
assert.match(vercel, /share\/:token/);

assert.match(indexNow, /https:\/\/api\.indexnow\.org\/indexnow/);
assert.match(indexNow, /AbortSignal\.timeout/);
assert.match(indexNow, /canonicalSiteOrigin/);
assert.match(router, /url\.origin !== window\.location\.origin/);
assert.match(router, /window\.history\.pushState/);
assert.doesNotMatch(packageJson, /"react-router"/, 'the client router should not depend on vulnerable server/RSC routing code');

assert.equal(findingImpact({ severity: 'critical', affectedPageCount: 20 } as any).label, 'High potential impact');
assert.equal(findingImpact({ severity: 'info', affectedPageCount: 1 } as any).label, 'Focused improvement');
assert.doesNotMatch(findingImpact({ severity: 'warning', affectedPageCount: 3 } as any).detail, /point|rank/i);

console.log('Project growth workflow smoke test passed: schema, ownership, scheduling, sharing, Search Console, impact guidance, and IndexNow boundaries verified.');
