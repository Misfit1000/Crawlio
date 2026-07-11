import { useState, type FormEvent, type ReactNode } from 'react';
import { LogOut, Menu, Search, TrendingUp, User, X } from 'lucide-react';
import { BrandMark, ThemeToggle } from '../ui/visual-system';

type Theme = 'light' | 'dark';

export function MarketingShell({
  children,
  theme,
  onToggleTheme,
  userLabel,
  authLoading,
  onHome,
  onLogin,
  onSettings,
  onLogout,
  navigationBase = '',
}: {
  children: ReactNode;
  theme: Theme;
  onToggleTheme: () => void;
  userLabel?: string | null;
  authLoading?: boolean;
  onHome: () => void;
  onLogin: () => void;
  onSettings: () => void;
  onLogout: () => void;
  navigationBase?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const links = [
    ['Features', `${navigationBase}#features`],
    ['Free Tools', `${navigationBase}#free-tools`],
    ['Pricing', `${navigationBase}#pricing`],
    ['Reports', `${navigationBase}#reports`],
    ['Blog', '/blog'],
  ];
  const auditHref = `${navigationBase}#start-audit`;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-border bg-card/94 shadow-[0_8px_30px_-26px_rgba(11,27,70,0.4)] backdrop-blur-xl">
        <div className="section-shell flex h-16 items-center justify-between gap-4">
          <button type="button" onClick={onHome} className="rounded-lg" aria-label="SEOIntel home"><BrandMark /></button>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Public navigation">
            {links.map(([label, href]) => <a key={href} href={href} className="rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">{label}</a>)}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            {authLoading ? <div className="hidden h-10 w-20 animate-pulse rounded-lg bg-muted sm:block" /> : userLabel ? (
              <>
                <button type="button" onClick={onSettings} className="quiet-button hidden min-h-10 px-3 py-2 sm:inline-flex"><User className="h-4 w-4" />{userLabel}</button>
                <button type="button" onClick={onLogout} className="rounded-lg p-2.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-600" aria-label="Sign out"><LogOut className="h-5 w-5" /></button>
              </>
            ) : <button type="button" onClick={onLogin} className="hidden min-h-10 rounded-lg px-3 text-sm font-semibold text-foreground hover:bg-muted sm:block">Sign in</button>}
            <a href={auditHref} className="trust-button min-h-10 px-3 py-2 text-sm"><span className="hidden sm:inline">Start free audit</span><span className="sm:hidden">Audit</span></a>
            <button type="button" onClick={() => setMenuOpen((open) => !open)} className="rounded-lg p-2.5 text-muted-foreground hover:bg-muted lg:hidden" aria-expanded={menuOpen} aria-controls="public-mobile-nav" aria-label="Toggle navigation">{menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          </div>
        </div>
        {menuOpen && (
          <nav id="public-mobile-nav" className="border-t border-border bg-card p-4 lg:hidden" aria-label="Mobile public navigation">
            <div className="mx-auto grid max-w-xl gap-1">
              {links.map(([label, href]) => <a key={href} href={href} onClick={() => setMenuOpen(false)} className="rounded-lg px-4 py-3 text-base font-semibold hover:bg-muted">{label}</a>)}
              {!userLabel && <button type="button" onClick={() => { setMenuOpen(false); onLogin(); }} className="mt-2 quiet-button w-full">Sign in</button>}
            </div>
          </nav>
        )}
      </header>
      {children}
    </div>
  );
}

export function WorkspaceShell({
  children,
  sidebar,
  theme,
  onToggleTheme,
  sidebarOpen,
  onToggleSidebar,
  onHome,
  query,
  onQueryChange,
  onSearch,
  onDeepSearch,
  userLabel,
  authLoading,
  onLogin,
  onRegister,
  onSettings,
  onLogout,
}: {
  children: ReactNode;
  sidebar: ReactNode;
  theme: Theme;
  onToggleTheme: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onHome: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: (event: FormEvent) => void;
  onDeepSearch: () => void;
  userLabel?: string | null;
  authLoading?: boolean;
  onLogin: () => void;
  onRegister: () => void;
  onSettings: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 flex h-[4.25rem] items-center border-b border-border bg-card/94 px-4 shadow-[0_8px_30px_-26px_rgba(11,27,70,0.4)] backdrop-blur-xl md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button type="button" onClick={onToggleSidebar} className="rounded-lg p-2.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}><Menu className="h-5 w-5" /></button>
          <button type="button" onClick={onHome} className="rounded-lg" aria-label="SEOIntel home"><BrandMark /></button>
          <form onSubmit={onSearch} className="ml-3 hidden max-w-2xl flex-1 items-center rounded-xl border border-border bg-background shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15 md:flex">
            <Search className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" />
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search audits, reports, or pages" className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none" />
            <button type="submit" className="mr-1 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">Search</button>
            <button type="button" onClick={onDeepSearch} className="mr-1 inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]"><TrendingUp className="h-3.5 w-3.5" /> Deep</button>
          </form>
        </div>
        <div className="ml-3 flex items-center gap-2">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          {authLoading ? <div className="h-9 w-20 animate-pulse rounded-lg bg-muted" /> : userLabel ? (
            <>
              <button type="button" onClick={onSettings} className="hidden rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold hover:bg-muted md:inline-flex"><User className="mr-2 h-4 w-4" />{userLabel}</button>
              <button type="button" onClick={onLogout} className="rounded-lg p-2.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-600" aria-label="Sign out"><LogOut className="h-5 w-5" /></button>
            </>
          ) : (
            <><button type="button" onClick={onLogin} className="hidden rounded-lg px-3 py-2 text-sm font-semibold hover:bg-muted sm:block">Log in</button><button type="button" onClick={onRegister} className="trust-button min-h-10 px-3 py-2 text-sm">Sign up</button></>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">{sidebar}<main className="min-w-0 flex-1"><div className="suite-page">{children}</div></main></div>
    </div>
  );
}
