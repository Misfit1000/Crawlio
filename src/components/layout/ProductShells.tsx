import { useState, type ReactNode } from 'react';
import { ArrowRight, LogOut, Menu, User, X } from 'lucide-react';
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
    ['How it works', `${navigationBase}#how-it-works`],
    ['Pricing', `${navigationBase}#pricing`],
    ['Reports', `${navigationBase}#reports`],
    ['Blog', '/blog'],
  ];
  const auditHref = `${navigationBase}#start-audit`;
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className="sticky top-0 z-50 border-b border-border/80 bg-card/92 backdrop-blur-xl">
        <div className="section-shell flex h-[4.5rem] items-center justify-between gap-4">
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
            <a href={auditHref} className="trust-button min-h-10 px-4 py-2 text-sm"><span className="hidden sm:inline">Start free audit</span><span className="sm:hidden">Audit</span><ArrowRight className="hidden h-4 w-4 sm:block" /></a>
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
      <PublicFooter />
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
  userLabel?: string | null;
  authLoading?: boolean;
  onLogin: () => void;
  onRegister: () => void;
  onSettings: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <a href="#workspace-content" className="skip-link">Skip to workspace content</a>
      <header className="relative z-50 flex h-[4.25rem] shrink-0 items-center border-b border-border/80 bg-card/92 px-4 backdrop-blur-xl md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button type="button" onClick={onToggleSidebar} className="rounded-lg p-2.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}><Menu className="h-5 w-5" /></button>
          <button type="button" onClick={onHome} className="rounded-lg" aria-label="SEOIntel home"><BrandMark /></button>
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
      <div className="flex min-h-0 flex-1 overflow-hidden">{sidebar}<main id="workspace-content" className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain" tabIndex={-1}><div className="suite-page">{children}</div></main></div>
    </div>
  );
}

function PublicFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-card/70">
      <div className="section-shell grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <BrandMark />
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">Website audits with transparent coverage, passive security boundaries, and no invented ranking data.</p>
        </div>
        <nav aria-label="Product links">
          <h2 className="text-sm font-semibold">Product</h2>
          <div className="mt-3 grid gap-2 text-sm text-muted-foreground"><a href="/#features" className="hover:text-foreground">Features</a><a href="/#pricing" className="hover:text-foreground">Pricing</a><a href="/blog" className="hover:text-foreground">Blog</a><a href="/contact" className="hover:text-foreground">Contact</a></div>
        </nav>
        <nav aria-label="Legal links">
          <h2 className="text-sm font-semibold">Trust and legal</h2>
          <div className="mt-3 grid gap-2 text-sm text-muted-foreground"><a href="/privacy" className="hover:text-foreground">Privacy</a><a href="/terms" className="hover:text-foreground">Terms</a><a href="/acceptable-use" className="hover:text-foreground">Acceptable use</a><a href="/cookies" className="hover:text-foreground">Cookies</a></div>
        </nav>
      </div>
    </footer>
  );
}
