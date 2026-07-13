import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { activityPanelSize, clampActivityLayout, defaultActivityLayout } from '../src/lib/ui/activity-layout';

for (const width of [320, 375, 390, 768, 1024, 1280, 1440, 1920]) {
  const viewport = { width, height: width < 768 ? 720 : 900 };
  const layout = clampActivityLayout(defaultActivityLayout(viewport, true), viewport, true);
  const size = activityPanelSize(layout, viewport, true);
  assert.ok(size.width <= width - 24, `Activity width must fit ${width}px`);
  assert.ok(layout.x >= 12, `Activity x must remain visible at ${width}px`);
  assert.ok(layout.x + size.width <= width - 12, `Activity must not overflow ${width}px`);
}

const css = await readFile('src/index.css', 'utf8');
const landing = await readFile('src/components/LandingPage.tsx', 'utf8');
const findings = await readFile('src/components/audit/FindingWorkspace.tsx', 'utf8');
assert.match(css, /\.dark[\s\S]*--background: #0f131a/);
assert.match(css, /--surface-raised/);
assert.match(css, /--surface-inset/);
assert.match(css, /prefers-reduced-motion/);
assert.match(landing, /sm:flex/);
assert.match(landing, /lg:grid-cols|xl:grid-cols/);
assert.match(findings, /xl:sticky/);
assert.match(findings, /fixed inset-x-0 bottom-0 top-\[4\.25rem\]/);
console.log('Responsive visual hierarchy and theme-token smoke test passed.');
