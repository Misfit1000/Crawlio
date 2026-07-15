export type ActivitySnap = 'left' | 'center' | 'right';

export interface ActivityPanelLayout {
  open: boolean;
  snap: ActivitySnap;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export const ACTIVITY_LAYOUT_KEY = 'crawlio_audit_activity_layout_v1';
export const LEGACY_ACTIVITY_LAYOUT_KEY = 'seointel_audit_activity_layout_v2';
export const ACTIVITY_TOP_OFFSET = 80;
export const ACTIVITY_EDGE_GAP = 12;
export const ACTIVITY_DEFAULT_LAYOUT: ActivityPanelLayout = {
  open: false,
  snap: 'right',
  x: 0,
  y: ACTIVITY_TOP_OFFSET,
  width: 440,
  height: 520,
};

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const bounded = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

export function activityPanelSize(layout: ActivityPanelLayout, viewport: ViewportSize, expanded = layout.open) {
  const maximumWidth = Math.max(240, viewport.width - ACTIVITY_EDGE_GAP * 2);
  const maximumHeight = Math.max(220, viewport.height - ACTIVITY_TOP_OFFSET - ACTIVITY_EDGE_GAP);
  const minimumExpandedWidth = Math.min(320, maximumWidth);
  const minimumExpandedHeight = Math.min(340, maximumHeight);
  return expanded
    ? {
        width: bounded(layout.width, minimumExpandedWidth, Math.min(620, maximumWidth)),
        height: bounded(layout.height, minimumExpandedHeight, Math.min(760, maximumHeight)),
      }
    : {
        width: bounded(Math.min(330, maximumWidth), Math.min(240, maximumWidth), maximumWidth),
        height: 48,
      };
}

export function snapX(snap: ActivitySnap, panelWidth: number, viewportWidth: number) {
  if (snap === 'left') return ACTIVITY_EDGE_GAP;
  if (snap === 'center') return Math.max(ACTIVITY_EDGE_GAP, Math.round((viewportWidth - panelWidth) / 2));
  return Math.max(ACTIVITY_EDGE_GAP, viewportWidth - panelWidth - ACTIVITY_EDGE_GAP);
}

export function clampActivityLayout(layout: ActivityPanelLayout, viewport: ViewportSize, expanded = layout.open): ActivityPanelLayout {
  const size = activityPanelSize(layout, viewport, expanded);
  const storedSize = activityPanelSize(layout, viewport, true);
  const maxX = Math.max(ACTIVITY_EDGE_GAP, viewport.width - size.width - ACTIVITY_EDGE_GAP);
  const maxY = Math.max(ACTIVITY_TOP_OFFSET, viewport.height - size.height - ACTIVITY_EDGE_GAP);
  return {
    ...layout,
    width: storedSize.width,
    height: storedSize.height,
    x: bounded(finite(layout.x, snapX(layout.snap, size.width, viewport.width)), ACTIVITY_EDGE_GAP, maxX),
    y: bounded(finite(layout.y, ACTIVITY_TOP_OFFSET), ACTIVITY_TOP_OFFSET, maxY),
  };
}

export function snapActivityLayout(layout: ActivityPanelLayout, viewport: ViewportSize, snap?: ActivitySnap): ActivityPanelLayout {
  const size = activityPanelSize(layout, viewport, layout.open);
  const candidates: Array<{ snap: ActivitySnap; x: number }> = [
    { snap: 'left', x: snapX('left', size.width, viewport.width) },
    { snap: 'center', x: snapX('center', size.width, viewport.width) },
    { snap: 'right', x: snapX('right', size.width, viewport.width) },
  ];
  const selected = snap
    ? candidates.find((candidate) => candidate.snap === snap) || candidates[2]
    : candidates.reduce((closest, candidate) => Math.abs(candidate.x - layout.x) < Math.abs(closest.x - layout.x) ? candidate : closest);
  return clampActivityLayout({ ...layout, snap: selected.snap, x: selected.x, y: ACTIVITY_TOP_OFFSET }, viewport, layout.open);
}

export function defaultActivityLayout(viewport: ViewportSize, open = false) {
  return snapActivityLayout({ ...ACTIVITY_DEFAULT_LAYOUT, open }, viewport, 'right');
}

export function parseActivityLayout(value: string | null, viewport: ViewportSize): ActivityPanelLayout {
  if (!value) return defaultActivityLayout(viewport);
  try {
    const parsed = JSON.parse(value) as Partial<ActivityPanelLayout>;
    const snap: ActivitySnap = parsed.snap === 'left' || parsed.snap === 'center' || parsed.snap === 'right' ? parsed.snap : 'right';
    return clampActivityLayout({
      open: parsed.open === true,
      snap,
      x: finite(parsed.x, snapX(snap, ACTIVITY_DEFAULT_LAYOUT.width, viewport.width)),
      y: finite(parsed.y, ACTIVITY_TOP_OFFSET),
      width: finite(parsed.width, ACTIVITY_DEFAULT_LAYOUT.width),
      height: finite(parsed.height, ACTIVITY_DEFAULT_LAYOUT.height),
    }, viewport, parsed.open === true);
  } catch {
    return defaultActivityLayout(viewport);
  }
}

export function serializableActivityLayout(layout: ActivityPanelLayout) {
  return JSON.stringify({
    open: layout.open,
    snap: layout.snap,
    x: Math.round(layout.x),
    y: Math.round(layout.y),
    width: Math.round(layout.width),
    height: Math.round(layout.height),
  });
}
