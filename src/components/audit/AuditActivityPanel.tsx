import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, ChevronDown, CircleDot, GripHorizontal, MoreHorizontal, RotateCcw, X } from 'lucide-react';
import type { ResourceAuditEvent } from '../../lib/audit/resource-types';
import { customerSafeDiagnosticText } from '../../lib/audit/audit-failures';
import {
  ACTIVITY_LAYOUT_KEY,
  activityPanelSize,
  clampActivityLayout,
  defaultActivityLayout,
  parseActivityLayout,
  serializableActivityLayout,
  snapActivityLayout,
  type ActivityPanelLayout,
  type ActivitySnap,
} from '../../lib/ui/activity-layout';

type EventFilter = 'all' | 'pages' | 'warnings';

function viewportSize() {
  return {
    width: typeof window === 'undefined' ? 1440 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  };
}

function readableEventTitle(event: ResourceAuditEvent) {
  if (event.type === 'audit_started') return 'Audit started';
  if (event.type === 'url_normalized') return 'Website address confirmed';
  if (event.type === 'page_discovered') return 'Page discovered';
  if (event.type === 'page_warning' || event.type === 'warning_summary') return 'Audit warning';
  if (event.type === 'page_crawled') return 'Page analysed';
  if (event.type === 'check_completed') return 'Checks completed';
  if (event.type === 'audit_completed_with_warnings') return 'Report generated with warnings';
  if (event.type === 'audit_completed') return 'Report generated';
  if (event.type === 'audit_failed') return 'Audit stopped safely';
  return event.type.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventMatches(event: ResourceAuditEvent, filter: EventFilter) {
  if (filter === 'warnings') return event.type.includes('warning') || event.severity === 'critical' || event.severity === 'high';
  if (filter === 'pages') return event.type.includes('page_') || Boolean(event.affectedUrl || event.currentUrl);
  return true;
}

function eventDot(event: ResourceAuditEvent) {
  if (event.type.includes('warning') || event.severity === 'critical' || event.severity === 'high') return 'bg-amber-500';
  if (event.type.includes('completed')) return 'bg-emerald-500';
  return 'bg-accent';
}

export default function AuditActivityPanel({
  events,
  phase,
  progress,
  pagesAnalysed,
  pageLimit,
}: {
  events: ResourceAuditEvent[];
  phase?: string | null;
  progress?: number;
  pagesAnalysed?: number;
  pageLimit?: number;
}) {
  const [layout, setLayout] = useState<ActivityPanelLayout>(() => {
    if (typeof window === 'undefined') return defaultActivityLayout(viewportSize());
    return parseActivityLayout(window.localStorage.getItem(ACTIVITY_LAYOUT_KEY), viewportSize());
  });
  const [lastSeenCount, setLastSeenCount] = useState(0);
  const [filter, setFilter] = useState<EventFilter>('all');
  const [positionMenuOpen, setPositionMenuOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const collapsedRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);

  const visibleEvents = useMemo(() => events.filter((event) => eventMatches(event, filter)), [events, filter]);
  const unread = layout.open ? 0 : Math.max(0, events.length - lastSeenCount);
  const latest = events[events.length - 1];
  const activityLabel = phase?.trim()
    || (pagesAnalysed != null && pageLimit ? `Analysing pages · ${pagesAnalysed}/${pageLimit}` : '')
    || (latest ? readableEventTitle(latest) : 'Waiting for audit activity');

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVITY_LAYOUT_KEY, serializableActivityLayout(layout));
    } catch {}
  }, [layout]);

  useEffect(() => {
    const onResize = () => setLayout((current) => snapActivityLayout(clampActivityLayout(current, viewportSize(), current.open), viewportSize(), current.snap));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!layout.open || !panelRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (dragRef.current || !entry) return;
      if (resizeFrameRef.current != null) window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        const bounds = panelRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const { width, height } = bounds;
        setLayout((current) => {
          if (Math.abs(current.width - width) < 2 && Math.abs(current.height - height) < 2) return current;
          return clampActivityLayout({ ...current, width, height }, viewportSize(), true);
        });
      });
    });
    observer.observe(panelRef.current);
    return () => {
      observer.disconnect();
      if (resizeFrameRef.current != null) window.cancelAnimationFrame(resizeFrameRef.current);
    };
  }, [layout.open]);

  useEffect(() => {
    if (!layout.open) return;
    window.requestAnimationFrame(() => {
      collapseRef.current?.focus();
      if (scrollRef.current) scrollRef.current.scrollTop = scrollTop;
    });
  }, [layout.open]);

  const updatePosition = (x: number, y: number) => {
    setLayout((current) => clampActivityLayout({ ...current, x, y }, viewportSize(), current.open));
  };

  const beginDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const bounds = (event.currentTarget.closest('[data-activity-panel]') as HTMLElement | null)?.getBoundingClientRect();
    if (!bounds) return;
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    updatePosition(event.clientX - dragRef.current.offsetX, event.clientY - dragRef.current.offsetY);
  };

  const finishDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setLayout((current) => snapActivityLayout(current, viewportSize()));
  };

  const moveTo = (snap: ActivitySnap) => {
    setLayout((current) => snapActivityLayout(current, viewportSize(), snap));
    setPositionMenuOpen(false);
  };

  const resetLayout = () => {
    setLayout((current) => defaultActivityLayout(viewportSize(), current.open));
    setPositionMenuOpen(false);
  };

  const keyboardMove = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') {
      resetLayout();
      return;
    }
    const step = event.shiftKey ? 32 : 12;
    const nextX = layout.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0);
    const nextY = layout.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
    updatePosition(nextX, nextY);
  };

  const expand = () => {
    setLastSeenCount(events.length);
    setLayout((current) => clampActivityLayout({ ...current, open: true }, viewportSize(), true));
  };

  const collapse = () => {
    setPositionMenuOpen(false);
    setLayout((current) => snapActivityLayout({ ...current, open: false }, viewportSize(), current.snap));
    window.requestAnimationFrame(() => collapsedRef.current?.focus());
  };

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      collapse();
    }
  };

  const renderedSize = activityPanelSize(layout, viewportSize(), layout.open);
  const style = {
    left: `${layout.x}px`,
    top: `${layout.y}px`,
    width: `${renderedSize.width}px`,
    height: `${renderedSize.height}px`,
  };

  const positionMenu = positionMenuOpen && (
    <div className="absolute right-2 top-12 z-20 w-52 rounded-lg border border-border bg-card p-1.5 shadow-sm" role="menu" aria-label="Activity position">
      {(['left', 'center', 'right'] as ActivitySnap[]).map((snap) => (
        <button key={snap} type="button" onClick={() => moveTo(snap)} className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm hover:bg-muted" role="menuitem">
          Move to top {snap === 'center' ? 'centre' : snap}
        </button>
      ))}
      <button type="button" onClick={resetLayout} className="mt-1 flex min-h-10 w-full items-center gap-2 border-t border-border px-3 pt-1 text-left text-sm hover:bg-muted" role="menuitem">
        <RotateCcw className="h-4 w-4" /> Reset position
      </button>
    </div>
  );

  return createPortal(
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{activityLabel}</div>
      {!layout.open ? (
        <div data-activity-panel className="fixed z-[65] flex h-12 max-w-[calc(100vw-1.5rem)] items-center overflow-visible rounded-lg border border-border bg-card text-sm shadow-sm" style={style}>
          <button
            type="button"
            className="flex h-full w-10 shrink-0 touch-none cursor-grab items-center justify-center rounded-l-lg border-r border-border text-muted-foreground active:cursor-grabbing"
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onKeyDown={keyboardMove}
            aria-label="Move audit activity. Use arrow keys to reposition; hold Shift for larger steps."
            aria-describedby="activity-move-instructions"
          >
            <GripHorizontal className="h-4 w-4" />
          </button>
          <button ref={collapsedRef} type="button" onClick={expand} className="flex min-w-0 flex-1 items-center gap-2 px-3 text-left" aria-label={`Open audit activity, ${events.length} events${unread ? `, ${unread} new` : ''}`}>
            <Activity className="h-4 w-4 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate font-semibold">{activityLabel}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{events.length}</span>
            {unread > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label={`${unread} new events`} />}
            <ChevronDown className="h-4 w-4 shrink-0 -rotate-90 text-muted-foreground" />
          </button>
          <button type="button" onClick={() => setPositionMenuOpen((open) => !open)} className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Activity position options" aria-expanded={positionMenuOpen}>
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {positionMenu}
        </div>
      ) : (
        <aside
          ref={panelRef}
          data-activity-panel
          role="dialog"
          aria-modal="false"
          aria-labelledby="audit-activity-title"
          onKeyDown={onPanelKeyDown}
          className="fixed z-[65] flex max-h-[calc(100dvh-5.75rem)] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm md:resize"
          style={style}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-2 py-2">
            <button
              type="button"
              className="flex min-h-10 min-w-10 touch-none cursor-grab items-center justify-center rounded-lg text-muted-foreground hover:bg-muted active:cursor-grabbing"
              onPointerDown={beginDrag}
              onPointerMove={moveDrag}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onKeyDown={keyboardMove}
              aria-label="Move audit activity. Use arrow keys to reposition; hold Shift for larger steps."
              aria-describedby="activity-move-instructions"
            >
              <GripHorizontal className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <h2 id="audit-activity-title" className="truncate text-sm font-semibold">Audit activity</h2>
              <p className="truncate text-xs text-muted-foreground">{activityLabel}</p>
            </div>
            <button type="button" onClick={() => setPositionMenuOpen((open) => !open)} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Activity position options" aria-expanded={positionMenuOpen}><MoreHorizontal className="h-4 w-4" /></button>
            <button ref={collapseRef} type="button" onClick={collapse} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Collapse audit activity"><X className="h-5 w-5" /></button>
            {positionMenu}
          </div>

          <div className="flex shrink-0 items-center gap-1 border-b border-border bg-[var(--surface-inset)] p-2" role="tablist" aria-label="Filter audit activity">
            {(['all', 'pages', 'warnings'] as EventFilter[]).map((value) => (
              <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={`min-h-9 rounded-md px-3 text-xs font-semibold capitalize ${filter === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{value}</button>
            ))}
            <span className="ml-auto pr-2 text-xs text-muted-foreground">{visibleEvents.length} shown</span>
          </div>

          <div ref={scrollRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {visibleEvents.length === 0 ? (
              <div className="flex h-full min-h-44 flex-col items-center justify-center p-6 text-center"><CircleDot className="h-5 w-5 text-muted-foreground" /><p className="mt-3 text-sm font-semibold">No activity matches this filter</p><p className="mt-1 text-xs leading-5 text-muted-foreground">New page checks and warning summaries will appear here.</p></div>
            ) : visibleEvents.map((event) => {
              const message = customerSafeDiagnosticText(event.message) || 'Audit update recorded.';
              return (
                <article key={event.id} className="grid grid-cols-[12px_minmax(0,1fr)] gap-3 border-b border-border px-4 py-3.5 last:border-0">
                  <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${eventDot(event)}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3"><h3 className="text-sm font-semibold">{readableEventTitle(event)}</h3><time className="shrink-0 text-[11px] text-muted-foreground">{new Date(event.timestamp).toLocaleTimeString()}</time></div>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">{message}</p>
                    {(event.affectedUrl || event.currentUrl) && <p className="mt-1.5 truncate rounded-md bg-muted/45 px-2 py-1 text-xs text-muted-foreground" title={event.affectedUrl || event.currentUrl || ''}>{event.affectedUrl || event.currentUrl}</p>}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            <span>{progress == null ? 'Stored audit events' : `${Math.round(Math.max(0, Math.min(100, progress)))}% complete`}</span>
            <button type="button" onClick={resetLayout} className="rounded-md px-2 py-1.5 font-semibold hover:bg-muted hover:text-foreground">Reset layout</button>
          </div>
        </aside>
      )}
      <p id="activity-move-instructions" className="sr-only">Drag with a pointer or use the arrow keys. Hold Shift for larger steps. Press Home to reset the position.</p>
    </>,
    document.body,
  );
}
