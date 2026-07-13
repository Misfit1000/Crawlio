import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIVITY_TOP_OFFSET, clampActivityLayout, defaultActivityLayout, parseActivityLayout, serializableActivityLayout, snapActivityLayout } from '../src/lib/ui/activity-layout';

const viewport = { width: 1280, height: 800 };
const initial = defaultActivityLayout(viewport, true);
assert.equal(initial.snap, 'right');
assert.equal(initial.y, ACTIVITY_TOP_OFFSET);

const clamped = clampActivityLayout({ ...initial, x: -900, y: 9000 }, viewport, true);
assert.ok(clamped.x >= 12);
assert.ok(clamped.y >= ACTIVITY_TOP_OFFSET);
assert.ok(clamped.x + clamped.width <= viewport.width - 12);
assert.ok(clamped.y + clamped.height <= viewport.height - 12);

assert.equal(snapActivityLayout({ ...initial, x: 8 }, viewport).snap, 'left');
assert.equal(snapActivityLayout({ ...initial, x: 450 }, viewport).snap, 'center');
assert.equal(snapActivityLayout({ ...initial, x: 1200 }, viewport).snap, 'right');

const restored = parseActivityLayout(serializableActivityLayout({ ...initial, width: 510, height: 610 }), viewport);
assert.equal(restored.width, 510);
assert.equal(restored.height, 610);

const source = await readFile('src/components/audit/AuditActivityPanel.tsx', 'utf8');
assert.match(source, /onPointerDown=\{beginDrag\}/);
assert.match(source, /onPointerMove=\{moveDrag\}/);
assert.match(source, /onPointerUp=\{finishDrag\}/);
assert.match(source, /onPointerCancel=\{finishDrag\}/);
assert.match(source, /ResizeObserver/);
assert.match(source, /panelRef\.current\?\.getBoundingClientRect\(\)/, 'Panel resizing must persist rendered border-box dimensions.');
console.log('Activity drag, snap, persistence, and boundary smoke test passed.');
