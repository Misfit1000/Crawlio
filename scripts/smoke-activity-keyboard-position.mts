import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('src/components/audit/AuditActivityPanel.tsx', 'utf8');

assert.match(source, /ArrowLeft/);
assert.match(source, /ArrowRight/);
assert.match(source, /ArrowUp/);
assert.match(source, /ArrowDown/);
assert.match(source, /event\.shiftKey \? 32 : 12/);
assert.match(source, /event\.key === 'Home'/);
assert.match(source, /\(\['left', 'center', 'right'\] as ActivitySnap\[\]\)/);
assert.match(source, /Move to top \{snap === 'center' \? 'centre' : snap\}/);
assert.match(source, /Reset position/);
assert.match(source, /event\.key === 'Escape'/);
assert.match(source, /collapsedRef\.current\?\.focus/);
assert.match(source, /touch-none/);
console.log('Activity keyboard and touch positioning smoke test passed.');
