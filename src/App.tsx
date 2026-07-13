import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { Mail, Loader2 } from 'lucide-react';
import LandingPage, { type LandingDestination } from './components/LandingPage';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './contexts/ThemeContext';
import { API_ROUTES } from './lib/api/routes';
import { safeJsonFetch } from './lib/http/safe-json';
import { getAuditStartHeaders } from './lib/api/auth-headers';
import { createAuditSubmitGuard } from './lib/api/audit-submit-guard';
import { BrandMark, LoadingSkeleton, ThemeToggle } from './components/ui/visual-system';
import { MarketingShell, WorkspaceShell } from './components/layout/ProductShells';
import { useLocation, useNavigate } from 'react-router';
import {
  TAB_PATHS,
  isWorkspacePath,
  isKnownWorkspacePath,
  parseAuditWorkspacePath,
  tabForPath,
  type TabType,
} from './app/routes';

const Login = lazy(() => import('./components/Login'));
const Register = lazy(() => import('./components/Register'));
const Sidebar = lazy(() => import('./components/Sidebar'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const WebsiteAnalyzer = lazy(() => import('./components/WebsiteAnalyzer'));
const SeoAudit = lazy(() => import('./components/SeoAudit'));
const SecurityAudit = lazy(() => import('./components/SecurityAudit'));
const RankTracker = lazy(() => import('./components/RankTracker'));
const Imports = lazy(() => import('./components/Imports'));
const Reports = lazy(() => import('./components/Reports'));
const Settings = lazy(() => import('./components/Settings'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const SearchData = lazy(() => import('./components/SearchData'));
const LiveAuditProgress = lazy(() => import('./components/audit/LiveAuditProgress').then((mod) => ({ default: mod.LiveAuditProgress })));
const AuditWorkspace = lazy(() => import('./components/audit/AuditWorkspace'));
const AuditHistoryPage = lazy(() => import('./components/audit/AuditHistoryPage'));
const BlogIndex = lazy(() => import('./components/blog/BlogIndex'));
const BlogPostPage = lazy(() => import('./components/blog/BlogPostPage'));
const LegalPage = lazy(() => import('./components/LegalPage'));
const NotFoundPage = lazy(() => import('./components/NotFoundPage'));

export type { TabType } from './app/routes';

export default function App() {
  const { user, loading: authLoading, logout, unverifiedEmail, setUnverifiedEmail } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const routerLocation = useLocation();
  const navigate = useNavigate();
  const pathname = routerLocation.pathname;
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(() => {
    if (window.location.pathname === '/admin/login' || window.location.pathname === '/login') {
      return 'login';
    }
    if (window.location.pathname === '/register') return 'register';
    return null;
  });
  const liveAuditId = pathname.match(/^\/audit\/live\/([^/]+)/)?.[1] || null;
  const auditStartGuardRef = useRef(createAuditSubmitGuard());

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const activeTab = tabForPath(pathname);
  const workspaceRoute = parseAuditWorkspacePath(pathname);
  const isSearching = isWorkspacePath(pathname);
  const isKnownWorkspace = isKnownWorkspacePath(pathname);
  const legalKind = ({
    '/privacy': 'privacy',
    '/terms': 'terms',
    '/acceptable-use': 'acceptable-use',
    '/cookies': 'cookies',
    '/contact': 'contact',
  } as const)[pathname as '/privacy' | '/terms' | '/acceptable-use' | '/cookies' | '/contact'];
  const setActiveTab = (tab: TabType) => navigate(TAB_PATHS[tab]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsSidebarOpen(false);
      } else {
        setIsSidebarOpen(true);
      }
    };

    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handleOpenLogin = () => {
      setAuthMode('login');
    };
    window.addEventListener('open-login', handleOpenLogin);
    return () => window.removeEventListener('open-login', handleOpenLogin);
  }, []);

  useEffect(() => {
    if (pathname === '/login' || pathname === '/admin/login') setAuthMode('login');
    if (pathname === '/register') setAuthMode('register');
    if (pathname === '/pricing') window.setTimeout(() => document.getElementById('pricing')?.scrollIntoView({ block: 'start' }), 80);
    if (pathname === '/reports/example') window.setTimeout(() => document.getElementById('reports')?.scrollIntoView({ block: 'start' }), 80);
  }, [pathname]);

  useEffect(() => {
    const pages: Record<string, { title: string; description: string }> = {
      '/': { title: 'SEOIntel - Visual SEO, Technical SEO & Passive Security Audit Tool', description: 'Run visual SEO, technical SEO, crawlability, performance, and passive security audits with desktop, mobile, and Google-style previews.' },
      '/pricing': { title: 'SEOIntel Pricing and Free Audit Limits', description: 'Compare SEOIntel Free, Full, and Agency-ready audit limits without hidden ranking or backlink data claims.' },
      '/reports/example': { title: 'SEOIntel Example Audit Report', description: 'Explore an example SEOIntel report layout with website health, coverage, passive security, previews, and prioritized fixes.' },
    };
    const page = pages[pathname];
    if (!page) return;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    document.title = page.title;
    if (description) description.content = page.description;
    if (canonical) canonical.href = `${window.location.origin}${pathname}`;
  }, [pathname]);

  useEffect(() => {
    const legacyRoutes: Record<string, string> = {
      '/dashboard': '/app',
      '/seo-audit': '/app/audits/new',
      '/audit-history': '/app/audits/history',
      '/reports': '/app/reports',
      '/settings': '/app/settings',
    };
    if (legacyRoutes[pathname]) navigate(legacyRoutes[pathname], { replace: true });
    if (user && (pathname === '/login' || pathname === '/register')) navigate('/app', { replace: true });
  }, [navigate, pathname, user]);

  useEffect(() => {
    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]') || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'robots' }));
    robots.content = pathname.startsWith('/app') || pathname.startsWith('/admin') || pathname.startsWith('/audit/live/') || pathname === '/login' || pathname === '/register'
      ? 'noindex, nofollow'
      : 'index, follow';
  }, [pathname]);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/');
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const startLiveAudit = async (rawUrl: string, mode: 'quick' | 'standard' | 'deep' = 'quick') => {
    if (!auditStartGuardRef.current.begin()) return;
    try {
      const response = await safeJsonFetch<any>(API_ROUTES.auditStart, {
        method: 'POST',
        headers: await getAuditStartHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url: rawUrl, mode }),
      });
      if (!response.success) {
        throw new Error((response as any).error || 'The audit could not start. Please try again.');
      }
      const auditId = response.data.data?.auditId || response.data.auditId;
      navigate(`/audit/live/${encodeURIComponent(auditId)}`);
    } finally {
      auditStartGuardRef.current.end();
    }
  };

  const openHomeSection = (sectionId: string) => {
    navigate('/');
    window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  };

  const openAppTab = (tab: TabType) => {
    navigate(TAB_PATHS[tab]);
  };

  const handleLandingNavigate = (destination: LandingDestination) => {
    if (destination === 'start-audit') {
      openHomeSection('start-audit');
      return;
    }
    openAppTab(destination);
  };

  const blogMatch = pathname.match(/^\/blog(?:\/([^/]+))?\/?$/);
  const isBlogRoute = Boolean(blogMatch);
  const knownPublicRoute = pathname === '/' || pathname === '/pricing' || pathname === '/reports/example' || pathname === '/login' || pathname === '/register' || isBlogRoute || Boolean(legalKind);
  let blogSlug = '';
  if (blogMatch?.[1]) {
    try {
      blogSlug = decodeURIComponent(blogMatch[1]);
    } catch {
      blogSlug = blogMatch[1];
    }
  }

  if (unverifiedEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="mb-4 inline-block rounded-xl bg-accent/10 p-3 text-accent">
            <Mail className="w-12 h-12" />
          </div>
          <h1 className="text-2xl font-bold font-display text-foreground mb-4">Verify your email</h1>
          <p className="text-muted-foreground mb-8">
            A verification link was sent to <span className="text-foreground font-medium">{unverifiedEmail}</span>. Open it to verify the address, then sign in.
          </p>
          <button
            onClick={() => {
              setUnverifiedEmail(null);
              setAuthMode('login');
            }}
            className="trust-button w-full"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (isSearching && authLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-foreground"><Loader2 className="h-7 w-7 animate-spin text-accent" /><span className="ml-3 text-sm font-semibold">Loading your workspace...</span></div>;
  }

  if (pathname.startsWith('/app') && !user) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 md:px-6"><button type="button" onClick={() => navigate('/')}><BrandMark /></button><ThemeToggle theme={theme} onToggle={toggleTheme} /></header>
        <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center p-4">
          <Suspense fallback={<LoadingSkeleton rows={4} />}>{authMode === 'register' ? <Register onToggle={() => setAuthMode('login')} /> : <Login onToggle={() => setAuthMode('register')} />}</Suspense>
        </main>
      </div>
    );
  }

  if (pathname.startsWith('/admin') && user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 md:px-6"><button type="button" onClick={() => navigate('/')}><BrandMark /></button><ThemeToggle theme={theme} onToggle={toggleTheme} /></header>
        <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-lg items-center p-4">
          {user ? <div className="w-full rounded-lg border border-border bg-card p-6"><h1 className="text-xl font-semibold">Admin access required</h1><p className="mt-2 text-sm text-muted-foreground">This account does not have permission to open the administration workspace.</p><button type="button" className="trust-button mt-5" onClick={() => navigate('/app')}>Return to workspace</button></div> : <Suspense fallback={<LoadingSkeleton rows={4} />}>{authMode === 'register' ? <Register onToggle={() => setAuthMode('login')} /> : <Login onToggle={() => setAuthMode('register')} />}</Suspense>}
        </main>
      </div>
    );
  }

  if (liveAuditId) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans transition-colors duration-300">
        <a href="#live-audit-content" className="skip-link">Skip to audit progress</a>
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border h-16 px-4 md:px-6 flex items-center justify-between">
          <button
            type="button"
            className="rounded-lg"
            onClick={() => navigate('/')}
          >
            <BrandMark />
          </button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </header>
        <main id="live-audit-content" className="mx-auto w-full max-w-[1600px] p-3 sm:p-5 md:p-8" tabIndex={-1}>
          <Suspense fallback={<div className="h-64 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>}>
            <LiveAuditProgress auditId={liveAuditId} onRerun={(url) => startLiveAudit(url, 'quick')} onOpenWorkspace={() => navigate(`/app/audits/${encodeURIComponent(liveAuditId)}/overview`)} />
          </Suspense>
        </main>
      </div>
    );
  }

  const renderContent = () => {
    if (workspaceRoute) {
      return <AuditWorkspace auditId={workspaceRoute.auditId} section={workspaceRoute.section} onRerun={startLiveAudit} />;
    }

    switch (activeTab) {
      case 'dashboard':
        return (
          <Dashboard
            onOpenSeoAudit={() => setActiveTab('seo-audit')}
            onOpenSecurityAudit={() => setActiveTab('security-audit')}
            onOpenImports={() => setActiveTab('imports')}
            onOpenReports={() => setActiveTab('reports')}
          />
        );
      case 'website-analyzer':
        return <WebsiteAnalyzer />;
      case 'seo-audit':
        return <SeoAudit />;
      case 'seo-findings':
        return <Reports onStartAudit={() => setActiveTab('seo-audit')} initialSection="report-on-page" />;
      case 'technical-seo':
        return <Reports onStartAudit={() => setActiveTab('seo-audit')} initialSection="report-technical" />;
      case 'crawlability':
        return <Reports onStartAudit={() => setActiveTab('seo-audit')} initialSection="report-crawlability" />;
      case 'performance':
        return <Reports onStartAudit={() => setActiveTab('seo-audit')} initialSection="report-performance" />;
      case 'pages':
        return <Reports onStartAudit={() => setActiveTab('seo-audit')} initialSection="report-pages" />;
      case 'audit-history':
        return <AuditHistoryPage onStartAudit={() => setActiveTab('seo-audit')} />;
      case 'security-audit':
        return <SecurityAudit />;
      case 'rank-tracker':
        return <RankTracker />;
      case 'search-data': return <SearchData />;
      case 'imports':
        return <Imports />;
      case 'reports':
        return <Reports onStartAudit={() => setActiveTab('seo-audit')} />;
      case 'settings':
        return <Settings />;
      case 'admin-dashboard':
        return <AdminDashboard />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans overflow-x-hidden selection:bg-accent/30 transition-colors duration-300">
      {authMode && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#0b1b46]/35 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={authMode === 'login' ? 'Sign in' : 'Create account'}>
          <div className="relative w-full max-w-md">
            <Suspense fallback={<div className="flex items-center justify-center rounded-xl border border-border bg-card p-8"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>}>
              {authMode === 'login' ? (
                <Login onToggle={() => { setAuthMode('register'); if (pathname === '/login') navigate('/register'); }} onClose={() => { setAuthMode(null); if (pathname === '/login' || pathname === '/admin/login') navigate('/'); }} />
              ) : (
                <Register onToggle={() => { setAuthMode('login'); if (pathname === '/register') navigate('/login'); }} onClose={() => { setAuthMode(null); if (pathname === '/register') navigate('/'); }} />
              )}
            </Suspense>
          </div>
        </div>
      )}

      <div className="relative z-10 flex flex-col min-h-screen">
        {legalKind ? (
          <MarketingShell
            theme={theme}
            onToggleTheme={toggleTheme}
            userLabel={user?.username || (user ? 'Account' : null)}
            authLoading={authLoading}
            navigationBase="/"
            onHome={() => navigate('/')}
            onLogin={() => setAuthMode('login')}
            onSettings={() => openAppTab('settings')}
            onLogout={handleLogout}
          >
            <Suspense fallback={<LoadingSkeleton rows={5} />}><LegalPage kind={legalKind} /></Suspense>
          </MarketingShell>
        ) : isBlogRoute ? (
          <MarketingShell
            theme={theme}
            onToggleTheme={toggleTheme}
            userLabel={user?.username || (user ? 'Account' : null)}
            authLoading={authLoading}
            navigationBase="/"
            onHome={() => navigate('/')}
            onLogin={() => setAuthMode('login')}
            onSettings={() => openAppTab('settings')}
            onLogout={handleLogout}
          >
            <Suspense fallback={<LoadingSkeleton rows={5} />}>
              {blogSlug ? <BlogPostPage slug={blogSlug} /> : <BlogIndex />}
            </Suspense>
          </MarketingShell>
        ) : !isSearching && knownPublicRoute ? (
            <MarketingShell
              theme={theme}
              onToggleTheme={toggleTheme}
              userLabel={user?.username || (user ? 'Account' : null)}
              authLoading={authLoading}
              onHome={() => navigate('/')}
              onLogin={() => setAuthMode('login')}
              onSettings={() => openAppTab('settings')}
              onLogout={handleLogout}
            >
              <LandingPage 
                onStartAudit={(url) => startLiveAudit(url, 'quick')}
                onExploreFeatures={() => {
                  openAppTab('dashboard');
                }}
                onNavigate={handleLandingNavigate}
              />
            </MarketingShell>
          ) : isSearching && isKnownWorkspace ? (
            <WorkspaceShell
              theme={theme}
              onToggleTheme={toggleTheme}
              sidebarOpen={isSidebarOpen}
              onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
              onHome={() => navigate('/')}
              userLabel={user?.username || (user ? 'Account' : null)}
              authLoading={authLoading}
              onLogin={() => setAuthMode('login')}
              onRegister={() => setAuthMode('register')}
              onSettings={() => setActiveTab('settings')}
              onLogout={handleLogout}
              sidebar={
                <Suspense fallback={null}>
                  <Sidebar
                    isOpen={isSidebarOpen}
                    onClose={() => setIsSidebarOpen(false)}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    onOpenHelp={() => openHomeSection('faq')}
                  />
                </Suspense>
              }
            >
              <Suspense fallback={<LoadingSkeleton rows={5} />}>{renderContent()}</Suspense>
            </WorkspaceShell>
          ) : (
            <MarketingShell
              theme={theme}
              onToggleTheme={toggleTheme}
              userLabel={user?.username || (user ? 'Account' : null)}
              authLoading={authLoading}
              navigationBase="/"
              onHome={() => navigate('/')}
              onLogin={() => setAuthMode('login')}
              onSettings={() => openAppTab('settings')}
              onLogout={handleLogout}
            >
              <Suspense fallback={<LoadingSkeleton rows={3} />}><NotFoundPage onHome={() => navigate('/')} /></Suspense>
            </MarketingShell>
          )}
      </div>
    </div>
  );
}
