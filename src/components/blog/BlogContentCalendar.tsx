import { useMemo, useRef, useState } from 'react';
import { CalendarClock, GripVertical, RotateCcw, Undo2 } from 'lucide-react';
import { runAdminBlogWorkflow } from '../../lib/blog/client';
import type { BlogPost } from '../../lib/blog/types';
import { FormField, Notice } from '../ui/page-system';
import { StatusBadge } from '../ui/visual-system';

function zonedDateKey(date: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function zonedDateTime(dateKey: string, hour: number, timezone: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  let candidate = new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(candidate).map((part) => [part.type, part.value]));
    const rendered = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    candidate = new Date(candidate.getTime() + (Date.UTC(year, month - 1, day, hour, 0) - rendered));
  }
  return candidate.toISOString();
}

function formatTime(value: string | null, timezone: string) {
  if (!value) return 'Unscheduled';
  return new Intl.DateTimeFormat('en', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export default function BlogContentCalendar({ posts, settings, onChanged }: { posts: BlogPost[]; settings: Record<string, any>; onChanged: () => void }) {
  const timezone = String(settings.timezone || 'UTC');
  const preferredHour = Number(settings.preferred_start_hour ?? 9);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveValue, setMoveValue] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const undoRef = useRef<{ post: BlogPost; previous: string | null } | null>(null);
  const pointerStartRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const calendarPosts = useMemo(() => posts.filter((post) => ['scheduled', 'draft', 'needs_review', 'review'].includes(post.status)), [posts]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.now() + index * 24 * 60 * 60 * 1000);
    return { key: zonedDateKey(date, timezone), label: new Intl.DateTimeFormat('en', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric' }).format(date) };
  }), [timezone]);

  const move = async (post: BlogPost, scheduledAt: string | null) => {
    setBusy(post.id); setError(''); setMessage('');
    const previous = post.scheduledAt;
    try {
      await runAdminBlogWorkflow(post.id, { action: scheduledAt ? 'reschedule' : 'unschedule', scheduledAt, scheduleVersion: post.scheduleVersion, reason: scheduledAt ? 'Moved in the administrator content calendar.' : 'Moved back to the unscheduled queue.' });
      undoRef.current = { post: { ...post, scheduleVersion: post.scheduleVersion + 1 }, previous };
      setMessage(scheduledAt ? `Moved to ${formatTime(scheduledAt, timezone)}.` : 'Moved to the unscheduled queue.');
      setMovingId(null); setDraggedId(null); onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The calendar move was rejected.');
      setDraggedId(null);
    } finally { setBusy(''); }
  };

  const undo = async () => {
    const latest = undoRef.current;
    if (!latest) return;
    await move(latest.post, latest.previous);
    undoRef.current = null;
    setMessage('The latest calendar move was undone.');
  };

  const dropOnDay = (dateKey: string) => {
    const post = calendarPosts.find((item) => item.id === draggedId);
    if (post) void move(post, zonedDateTime(dateKey, preferredHour, timezone));
  };
  const startPointerMove = (postId: string, event: React.PointerEvent) => {
    pointerStartRef.current = { id: postId, x: event.clientX, y: event.clientY };
    setDraggedId(postId);
  };
  const finishPointerMove = (event: React.PointerEvent, dateKey: string | null) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8) { setDraggedId(null); return; }
    const post = calendarPosts.find((item) => item.id === start.id);
    if (post) void move(post, dateKey ? zonedDateTime(dateKey, preferredHour, timezone) : null);
  };

  return <section className="rounded-lg border border-border p-4" aria-labelledby="content-calendar-title">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><h4 id="content-calendar-title" className="flex items-center gap-2 font-semibold text-foreground"><CalendarClock className="h-4 w-4 text-accent" /> Content calendar</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">Drag with a mouse or touch, or use Move for keyboard scheduling. Times use {timezone}; server rules reject spacing, blackout, and daily-limit conflicts.</p></div>
      <button type="button" onClick={() => void undo()} disabled={!undoRef.current || Boolean(busy)} className="quiet-button"><Undo2 className="h-4 w-4" /> Undo move</button>
    </div>
    {error && <div className="mt-3"><Notice tone="danger">{error}</Notice></div>}
    {message && <p className="mt-3 text-sm text-emerald-700" role="status" aria-live="polite">{message}</p>}
    <div className="mt-4 overflow-x-auto pb-2">
      <div className="grid min-w-[860px] grid-cols-7 gap-2">
        {days.map((day) => <div key={day.key} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOnDay(day.key)} onPointerUp={(event) => finishPointerMove(event, day.key)} className="min-h-40 rounded-lg border border-border bg-muted/20 p-2" data-calendar-drop-target={day.key}>
          <p className="border-b border-border pb-2 text-xs font-semibold text-foreground">{day.label}</p>
          <div className="mt-2 space-y-2">{calendarPosts.filter((post) => post.scheduledAt && zonedDateKey(new Date(post.scheduledAt), timezone) === day.key).map((post) => <article key={post.id} draggable onDragStart={() => setDraggedId(post.id)} onDragEnd={() => setDraggedId(null)} className="rounded-lg border border-border bg-background p-2 text-xs">
            <button type="button" onPointerDown={(event) => startPointerMove(post.id, event)} className="flex w-full cursor-grab touch-none items-start gap-2 text-left" aria-label={`Move ${post.title}`}><GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span className="line-clamp-2 font-semibold text-foreground">{post.title}</span></button>
            <p className="mt-2 text-muted-foreground">{formatTime(post.scheduledAt, timezone)}</p>
            <div className="mt-2 flex gap-1"><button type="button" onClick={() => { setMovingId(post.id); setMoveValue(post.scheduledAt ? post.scheduledAt.slice(0, 16) : ''); }} className="text-accent hover:underline">Move</button>{post.recommendedPublicationAt && <button type="button" onClick={() => void runAdminBlogWorkflow(post.id, { action: 'reset_recommended_time', scheduleVersion: post.scheduleVersion, reason: 'Reset to the deterministic recommended publication time.' }).then(onChanged).catch((requestError) => setError(requestError.message))} className="text-muted-foreground hover:text-foreground" title="Reset recommended time"><RotateCcw className="h-3.5 w-3.5" /></button>}</div>
          </article>)}</div>
        </div>)}
      </div>
    </div>
    <div onDragOver={(event) => event.preventDefault()} onDrop={() => { const post = calendarPosts.find((item) => item.id === draggedId); if (post) void move(post, null); }} onPointerUp={(event) => finishPointerMove(event, null)} className="mt-3 rounded-lg border border-dashed border-border p-3" data-calendar-unscheduled>
      <p className="text-xs font-semibold text-foreground">Unscheduled</p><div className="mt-2 flex flex-wrap gap-2">{calendarPosts.filter((post) => !post.scheduledAt).map((post) => <button key={post.id} type="button" onPointerDown={(event) => startPointerMove(post.id, event)} onClick={() => setMovingId(post.id)} className="quiet-button" disabled={busy === post.id}><GripVertical className="h-4 w-4" /> {post.title}</button>)}</div>
    </div>
    {movingId && (() => { const post = calendarPosts.find((item) => item.id === movingId); return post ? <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4"><FormField label={`Move ${post.title}`} htmlFor="calendar-move-time" hint={`Date and time are interpreted by your browser and validated against the configured ${timezone} calendar.`}><input id="calendar-move-time" type="datetime-local" value={moveValue} onChange={(event) => setMoveValue(event.target.value)} className="suite-input" /></FormField><div className="mt-3 flex gap-2"><button type="button" onClick={() => void move(post, new Date(moveValue).toISOString())} disabled={!moveValue || Boolean(busy)} className="trust-button">Confirm move</button><button type="button" onClick={() => setMovingId(null)} className="quiet-button">Cancel</button><button type="button" onClick={() => void move(post, null)} className="quiet-button">Move to unscheduled</button></div></div> : null; })()}
    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground"><StatusBadge tone="neutral">{timezone}</StatusBadge><span>{settings.minimum_spacing_minutes || 180} minute spacing</span><span>{settings.maximum_posts_per_day || 2} posts per day</span></div>
  </section>;
}
