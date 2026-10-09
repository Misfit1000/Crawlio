import { ArrowLeft, HelpCircle, Settings, ShieldAlert, X } from 'lucide-react';
import type { TabType } from '../app/routes';
import { useAuth } from '../contexts/AuthContext';
import { Link, useLocation } from '../app/router';
import { useEffect, useRef } from 'react';
import { adminGroupForPath, adminNavigation, adminSectionForPath, clientGroupForTab, clientNavigation, clientNavigationPath, currentNavigationPath } from './navigation/product-navigation';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  onOpenHelp?: () => void;
}

const navigationClass = (active: boolean) => `workspace-nav-link flex min-h-11 min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${active ? 'is-active text-accent' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`;

export default function Sidebar({ isOpen, onClose, activeTab, onOpenHelp }: SidebarProps) {
  const navigationRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen || window.innerWidth >= 1024) return;
    const previous = document.activeElement as HTMLElement | null;
    const navigation = navigationRef.current;
    navigation?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (window.innerWidth >= 1024) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab' || !navigation) return;
      const controls = [...navigation.querySelectorAll<HTMLElement>('button, a[href], summary, input, select, [tabindex="0"]')].filter(element => element.getClientRects().length && !element.hasAttribute('disabled'));
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === navigation)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    navigation?.addEventListener('keydown', handleKey);
    return () => { navigation?.removeEventListener('keydown', handleKey); if (previous?.isConnected) previous.focus(); };
  }, [isOpen]);
  const { user } = useAuth();
  const location = useLocation();
  const isAdmin = activeTab === 'admin-dashboard' && user?.role === 'admin';
  const activeGroup = clientGroupForTab(activeTab);
  const adminGroup = adminGroupForPath(location.pathname);
  const adminSection = adminSectionForPath(location.pathname);
  const closeOnMobile = () => { if (window.innerWidth < 1024) onClose(); };
  const clientPath = (tab: TabType) => clientNavigationPath(tab, location.pathname, location.search, location.hash);

  return <>
    {isOpen && <div onClick={onClose} className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm lg:hidden" />}
    {isOpen && <aside id="workspace-navigation" ref={navigationRef} tabIndex={-1} aria-label={isAdmin ? 'Admin navigation' : 'Workspace navigation'} className="workspace-navigation fixed left-0 top-[4.25rem] z-50 flex h-[calc(100dvh-4.25rem)] w-[14.5rem] max-w-full flex-col overflow-hidden border-r border-border bg-card lg:relative lg:top-0 lg:h-full lg:shrink-0">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{isAdmin ? 'Administration' : 'Workspace'}</h2>
        <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:hidden" aria-label="Close navigation"><X className="mx-auto h-4 w-4" /></button>
      </div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-3" aria-label={isAdmin ? 'Admin primary navigation' : 'Main navigation'}>
        {isAdmin ? adminNavigation.map(group => {
          const active = group === adminGroup;
          const Icon = group.icon;
          const path = active ? adminSection.path : group.sections[0].path;
          return <Link key={group.label} to={currentNavigationPath(path, location)} onClick={closeOnMobile} aria-current={active ? 'page' : undefined} className={navigationClass(active)}><Icon className="h-5 w-5 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{group.label}</span></Link>;
        }) : clientNavigation.map(group => {
          const active = group === activeGroup;
          const Icon = group.icon;
          return <div key={group.id}>
            <Link to={active ? `${location.pathname}${location.search}${location.hash}` : clientPath(group.id)} onClick={closeOnMobile} aria-current={active ? 'page' : undefined} className={navigationClass(active)}><Icon className="h-5 w-5 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{group.label}</span></Link>
          </div>;
        })}
      </nav>
      <div className="shrink-0 border-t border-border bg-card p-3">
        {isAdmin ? <Link to="/app" onClick={closeOnMobile} className={navigationClass(false)}><ArrowLeft className="h-5 w-5 shrink-0" aria-hidden="true" />Back to workspace</Link> : user?.role === 'admin' && <Link to="/admin" onClick={closeOnMobile} className={navigationClass(false)}><ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />Administration</Link>}
        <Link to={clientPath('settings')} onClick={closeOnMobile} aria-current={activeTab === 'settings' ? 'page' : undefined} className={navigationClass(activeTab === 'settings')}><Settings className="h-5 w-5 shrink-0" aria-hidden="true" />Account settings</Link>
        {onOpenHelp && <button type="button" onClick={() => { onOpenHelp(); closeOnMobile(); }} className={`${navigationClass(false)} w-full text-left`}><HelpCircle className="h-5 w-5 shrink-0" aria-hidden="true" />Help</button>}
      </div>
    </aside>}
  </>;
}
