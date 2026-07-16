import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findingWorkflowKey, isFindingWorkflowStatus } from '../src/lib/audit/finding-workflow';

const stored = findingWorkflowKey({ findingKey: 'Title.Presence|HTTPS://Example.com/', category: 'seo', title: 'Changed text', affectedUrl: 'https://example.com/' });
assert.equal(stored, 'title.presence|https://example.com/');
const fallback = findingWorkflowKey({ category: 'SEO', title: 'Missing title', affectedUrl: 'HTTPS://Example.com/Page' });
assert.equal(fallback, 'seo|missing title|https://example.com/page');
for (const status of ['not_started', 'in_progress', 'fixed', 'ignored', 'reopened', 'accepted_risk']) assert.equal(isFindingWorkflowStatus(status), true);
assert.equal(isFindingWorkflowStatus('deleted'), false);

const api = readFileSync('src/api/index.ts', 'utf8');
assert.match(api, /expectedVersion/);
assert.match(api, /WORKFLOW_CONFLICT/);
assert.match(api, /requireWorkflowAudit/);
assert.match(api, /getLatestIssues\(access\.audit\.id, 1000\)/);
const client = readFileSync('src/components/audit/useFindingWorkflow.ts', 'utf8');
assert.match(client, /clearChecklist\(auditId\)/);
assert.match(client, /clearFindingNotes\(auditId\)/);
assert.match(client, /if \(!issueKeys\.length\) return;/, 'Legacy workflow must wait for accessible findings before deletion');
assert.match(client, /filter: `audit_id=eq\.\$\{auditId\}`/);
assert.match(client, /setRecords\(\(value\) => \{[\s\S]*if \(current\) next\[key\] = current; else delete next\[key\]/);
console.log('Finding workflow persistence smoke test passed.');
