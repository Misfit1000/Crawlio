import { useEffect, useState } from 'react';
import { Bell, CheckCheck, ExternalLink, X } from 'lucide-react';
import { getAdminBlogNotifications, markAdminBlogNotificationsRead } from '../../lib/blog/client';

type Notification = Awaited<ReturnType<typeof getAdminBlogNotifications>>['notifications'][number];

export default function BlogNotificationInbox() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const load = async () => { try { setItems((await getAdminBlogNotifications()).notifications); } catch {} };
  useEffect(() => {
    void load();
    const interval = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', onFocus); };
  }, []);
  const unread = items.filter((item) => !item.readAt).length;
  const markAll = async () => { await markAdminBlogNotificationsRead(); await load(); };
  const openItem = async (item: Notification) => {
    if (!item.readAt) await markAdminBlogNotificationsRead([item.id]);
    window.history.pushState({}, '', item.linkPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
    setOpen(false);
  };
  return <div className="relative">
    <button type="button" onClick={() => setOpen((value) => !value)} className="quiet-button relative" aria-expanded={open} aria-label={`Blog notifications${unread ? `, ${unread} unread` : ''}`}><Bell className="h-4 w-4" /> Alerts{unread > 0 && <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-white">{unread}</span>}</button>
    {open && <div className="absolute right-0 top-12 z-50 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-3"><div><p className="text-sm font-semibold">Blog alerts</p><p className="text-xs text-muted-foreground">AI publishing results that need your attention.</p></div><button type="button" className="icon-action" onClick={() => setOpen(false)} aria-label="Close alerts"><X className="h-4 w-4" /></button></div>
      <div className="max-h-96 overflow-y-auto divide-y divide-border">{items.length ? items.map((item) => <button key={item.id} type="button" onClick={() => void openItem(item)} className={`w-full px-4 py-3 text-left hover:bg-muted/40 ${item.readAt ? '' : 'bg-accent/5'}`}><div className="flex items-start justify-between gap-3"><p className="text-sm font-semibold">{item.title}</p>{!item.readAt && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.message}</p><span className="mt-2 flex items-center gap-1 text-xs text-accent">Open <ExternalLink className="h-3 w-3" /></span></button>) : <p className="p-5 text-sm text-muted-foreground">No blog alerts.</p>}</div>
      {unread > 0 && <button type="button" onClick={() => void markAll()} className="flex w-full items-center justify-center gap-2 border-t border-border px-4 py-3 text-sm font-semibold text-accent hover:bg-muted/40"><CheckCheck className="h-4 w-4" /> Mark all read</button>}
    </div>}
  </div>;
}
