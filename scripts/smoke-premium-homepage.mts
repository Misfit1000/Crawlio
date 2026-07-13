import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('src/components/LandingPage.tsx', 'utf8');

assert.match(source, /See what is holding your website back\./);
assert.match(source, /id="start-audit"/);
assert.match(source, /View example report/);
assert.match(source, /Example report/);
assert.match(source, /Demonstration data/);
assert.match(source, /Audit coverage/);
assert.match(source, /What to fix first|Specific recommendations/);
assert.match(source, /The report becomes a working backlog/);
assert.match(source, /The report is clear about what it knows/);
assert.match(source, /name: 'Free'/);
assert.match(source, /name: 'Plus'/);
assert.match(source, /name: 'Pro'/);
assert.doesNotMatch(source, /name: 'Admin'/);
assert.doesNotMatch(source, /trusted by|customer logos?|testimonials?|traffic growth|ranking increase/i);
assert.match(source, /content-auto/);
console.log('Premium homepage structure smoke test passed.');
