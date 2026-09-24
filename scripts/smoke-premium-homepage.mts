import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PUBLIC_AUDIT_PLANS } from '../src/lib/plans/public-plan-presentation';

const source = await readFile('src/components/LandingPage.tsx', 'utf8');
const scene = await readFile('src/components/ui/AuditConceptScene.tsx', 'utf8');

assert.match(source, /Understand your website\./);
assert.match(source, /id="start-audit"/);
assert.match(source, /await onStartAudit\(url\)/);
assert.match(source, /View example report/);
assert.match(source, /Example report/);
assert.match(source, /Demonstration data/);
assert.match(source, /Audit coverage/);
assert.match(source, /What to fix first|Specific recommendations/);
assert.match(source, /The report becomes a working backlog/);
assert.match(source, /The report is clear about what it knows/);
assert.deepEqual(PUBLIC_AUDIT_PLANS.map(({ name, pagesPerAudit }) => [name, pagesPerAudit]), [['Free', 5], ['Plus', 50], ['Pro', 75]]);
assert.match(scene, /How an audit works/);
assert.match(scene, /Pause animation/);
assert.match(scene, /Illustrative workflow/);
assert.doesNotMatch(source, /trusted by|customer logos?|testimonials?|traffic growth|ranking increase/i);
assert.doesNotMatch(source, /content-auto/);
console.log('Premium homepage structure smoke test passed.');
