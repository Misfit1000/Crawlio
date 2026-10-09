import { useState, type ReactNode } from 'react';
import { ArrowRight, LogOut, Menu, User, X } from 'lucide-react';
import { BrandMark, ThemeToggle } from '../ui/visual-system';
import { BRAND } from '../../lib/brand';
import { Link, useLocation } from '../../app/router';
import { PUBLIC_NAVIGATION } from '../public/public-navigation.mjs';

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
  const { pathname } = useLocation();
  const links = PUBLIC_NAVIGATION;
  const auditHref = '/#start-audit';
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className="sticky top-0 z-50 border-b border-border/80 bg-card/92 backdrop-blur-xl">
        <div className="section-shell flex h-[4.5rem] items-center justify-between gap-4">
          <button type="button" onClick={onHome} className="rounded-lg" aria-label={`${BRAND.name} home`}><BrandMark /></button>
          <nav className="hidden items-center gap-1 xl:flex" aria-label="Public navigation">
            {links.map(({ label, path }) => <Link key={path} to={path} aria-current={pathname === path || pathname.startsWith(`${path}/`) ? 'page' : undefined} className="rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:text-foreground">{label}</Link>)}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            {authLoading ? <div className="hidden h-10 w-20 animate-pulse rounded-lg bg-muted sm:block" /> : userLabel ? (
              <>
                <Link to="/app" className="quiet-button hidden min-h-10 px-3 py-2 md:inline-flex">Workspace</Link>
                <button type="button" onClick={onSettings} className="quiet-button min-h-10 px-3 py-2" aria-label="Account settings" title="Account settings"><User className="h-4 w-4 shrink-0" /><span className="hidden max-w-24 truncate xl:inline">{userLabel}</span></button>
                <button type="button" onClick={onLogout} className="hidden rounded-lg p-2.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-600 sm:block" aria-label="Sign out"><LogOut className="h-5 w-5" /></button>
              </>
            ) : <button type="button" onClick={onLogin} className="hidden min-h-10 rounded-lg px-3 text-sm font-semibold text-foreground hover:bg-muted sm:block">Sign in</button>}
            <Link to={auditHref} className="trust-button min-h-10 px-3 py-2 text-sm"><span className="hidden sm:inline">Start audit</span><span className="sm:hidden">Audit</span><ArrowRight className="hidden h-4 w-4 sm:block" /></Link>
            <button type="button" onClick={() => setMenuOpen((open) => !open)} className="rounded-lg p-2.5 text-muted-foreground hover:bg-muted xl:hidden" aria-expanded={menuOpen} aria-controls="public-mobile-nav" aria-label="Toggle navigation">{menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          </div>
        </div>
        {menuOpen && (
          <nav id="public-mobile-nav" className="border-t border-border bg-[var(--surface-raised)] p-4 shadow-[0_12px_32px_var(--shadow-color)] xl:hidden" aria-label="Mobile public navigation">
            <div className="mx-auto grid max-w-xl gap-1">
              {links.map(({ label, path }) => <Link key={path} to={path} onClick={() => setMenuOpen(false)} className="rounded-lg border border-transparent px-4 py-3 text-base font-semibold text-foreground hover:border-border hover:bg-muted">{label}</Link>)}
              {userLabel && <><Link to="/app" onClick={() => setMenuOpen(false)} className="quiet-button">Workspace</Link><button type="button" onClick={() => { setMenuOpen(false); onSettings(); }} className="quiet-button">Account settings</button><button type="button" onClick={() => { setMenuOpen(false); onLogout(); }} className="quiet-button">Sign out</button></>}
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

function PublicFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-card/70">
      <div className="section-shell grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <BrandMark />
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{BRAND.tagline} Evidence-led website audits with transparent coverage and no invented ranking data.</p>
        </div>
        <nav aria-label="Product links">
          <h2 className="text-sm font-semibold">Product</h2>
          <div className="mt-3 grid gap-2 text-sm text-muted-foreground">{PUBLIC_NAVIGATION.map(({ label, path }) => <Link key={path} to={path} className="hover:text-foreground">{label}</Link>)}<Link to="/contact" className="hover:text-foreground">Contact</Link></div>
        </nav>
        <nav aria-label="Legal links">
          <h2 className="text-sm font-semibold">Trust and legal</h2>
          <div className="mt-3 grid gap-2 text-sm text-muted-foreground"><a href="/privacy" className="hover:text-foreground">Privacy</a><a href="/terms" className="hover:text-foreground">Terms</a><a href="/acceptable-use" className="hover:text-foreground">Acceptable use</a><a href="/cookies" className="hover:text-foreground">Cookies</a></div>
        </nav>
      </div>
    </footer>
  );
}
