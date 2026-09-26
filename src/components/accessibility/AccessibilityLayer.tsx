import { useEffect, useMemo, useRef, useState } from 'react';
import { FileBarChart, FolderKanban, History, LayoutDashboard, Search, Settings, ShieldCheck, X } from 'lucide-react';
import { useLocation, useNavigate } from '../../app/router';

const destinations = [
  { label: 'Dashboard', description: 'Latest website health and next actions', path: '/app', icon: LayoutDashboard },
  { label: 'Projects', description: 'Websites, schedules, and recent audits', path: '/app/projects', icon: FolderKanban },
  { label: 'Start an audit', description: 'Run a quick, full, or deep website audit', path: '/app/audits/new', icon: Search },
  { label: 'Audit history', description: 'Past audits and comparisons', path: '/app/audits/history', icon: History },
  { label: 'Reports', description: 'Findings, pages, scores, and exports', path: '/app/reports', icon: FileBarChart },
  { label: 'Passive security', description: 'Public browser-protection observations', path: '/app/reports/security', icon: ShieldCheck },
  { label: 'Settings', description: 'Account, display, and data preferences', path: '/app/settings', icon: Settings },
] as const;

function routeLabel(pathname: string) {
  if (pathname === '/') return 'Crawlio home';
  if (pathname.startsWith('/audit/live/')) return 'Live audit';
  if (pathname.startsWith('/app/audits/') && !pathname.endsWith('/new') && !pathname.endsWith('/history')) return 'Audit report workspace';
  const match = destinations.find((item) => item.path === pathname);
  if (match) return match.label;
  if (pathname.startsWith('/admin')) return 'Administration';
  if (pathname.startsWith('/blog/')) return 'Blog article';
  if (pathname === '/blog') return 'Blog';
  return document.title.split('|')[0]?.trim() || 'Page';
}

function focusRouteTarget() {
  const dialog = document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]');
  if (dialog) return false;
  const target = document.querySelector<HTMLElement>('main h1, main h2');
  if (!target) return false;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  return true;
}

export default function AccessibilityLayer() {
  const location = useLocation();
  const navigate = useNavigate();
  const [announcement, setAnnouncement] = useState('');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return destinations;
    return destinations.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(needle));
  }, [query]);

  useEffect(() => {
    setAnnouncement(`Navigated to ${routeLabel(location.pathname)}`);
    if (location.hash) return;
    const observer = new MutationObserver(() => { if (focusRouteTarget()) observer.disconnect(); });
    const timer = window.setTimeout(() => {
      if (!focusRouteTarget()) observer.observe(document.body, { childList: true, subtree: true });
    }, 40);
    const expiry = window.setTimeout(() => observer.disconnect(), 5000);
    return () => { window.clearTimeout(timer); window.clearTimeout(expiry); observer.disconnect(); };
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openerRef.current = document.activeElement as HTMLElement | null;
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      setQuery('');
      setActiveIndex(0);
      window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => { document.body.style.overflow = previousOverflow; };
    }
    openerRef.current?.focus?.();
  }, [open]);

  const containDialogFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') || []);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const select = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
      {open && (
        <div className="fixed inset-0 z-[400] flex items-start justify-center bg-[#09142d]/55 p-4 pt-[12vh] backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
          <section ref={dialogRef} onKeyDown={containDialogFocus} className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="quick-navigation-title">
            <div className="flex items-center gap-3 border-b border-border p-3">
              <Search className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              <label htmlFor="quick-navigation-search" id="quick-navigation-title" className="sr-only">Quick navigation</label>
              <input
                ref={searchRef}
                id="quick-navigation-search"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(filtered.length - 1, index + 1)); }
                  if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
                  if (event.key === 'Home') { event.preventDefault(); setActiveIndex(0); }
                  if (event.key === 'End') { event.preventDefault(); setActiveIndex(Math.max(0, filtered.length - 1)); }
                  if (event.key === 'Enter' && filtered[activeIndex]) { event.preventDefault(); select(filtered[activeIndex].path); }
                }}
                className="min-h-11 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
                placeholder="Go to a page or workflow"
                role="combobox"
                aria-expanded="true"
                aria-controls="quick-navigation-results"
                aria-activedescendant={filtered[activeIndex] ? `quick-navigation-${activeIndex}` : undefined}
                autoComplete="off"
              />
              <button type="button" className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setOpen(false)} aria-label="Close quick navigation"><X className="h-5 w-5" /></button>
            </div>
            <div id="quick-navigation-results" role="listbox" aria-label="Destinations" className="max-h-[55vh] overflow-y-auto p-2">
              {filtered.map((item, index) => {
                const Icon = item.icon;
                const active = index === activeIndex;
                return (
                  <button
                    id={`quick-navigation-${index}`}
                    key={item.path}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(item.path)}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${active ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted'}`}
                  >
                    <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0"><span className="block text-sm font-semibold">{item.label}</span><span className={`block truncate text-xs ${active ? 'text-accent-foreground/80' : 'text-muted-foreground'}`}>{item.description}</span></span>
                  </button>
                );
              })}
              {!filtered.length && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No matching destination.</p>}
            </div>
            <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">Use ↑ and ↓ to choose, Enter to open, and Escape to close.</p>
          </section>
        </div>
      )}
    </>
  );
}
