import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { Mail, Loader2 } from 'lucide-react';
import LandingPage, { type LandingDestination } from './components/LandingPage';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './contexts/ThemeContext';
import { AuditLaunchProvider, useAuditLaunch } from './contexts/AuditLaunchContext';
import { loadLiveAuditScreen } from './lib/audit/live-screen-loader';
import { BrandMark, LoadingSkeleton, ThemeToggle } from './components/ui/visual-system';
import { MarketingShell, WorkspaceShell } from './components/layout/ProductShells';
import { useLocation, useNavigate } from './app/router';
import { BRAND } from './lib/brand';
import { activateBrowserMonitoringForPath } from './lib/monitoring/sentry-browser';
import {
  TAB_PATHS,
  isWorkspacePath,
  isKnownWorkspacePath,
  parseAuditWorkspacePath,
  tabForPath,
  type AuditWorkspaceSection,
  type TabType,
} from './app/routes';

const Login = lazy(() => import('./components/Login'));
const Register = lazy(() => import('./components/Register'));
const AccountRecovery = lazy(() => import('./components/AccountRecovery'));
const Sidebar = lazy(() => import('./components/Sidebar'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const ProjectsPage = lazy(() => import('./components/projects/ProjectsPage'));
const WebsiteAnalyzer = lazy(() => import('./components/WebsiteAnalyzer'));
const SeoAudit = lazy(() => import('./components/SeoAudit'));
const SecurityAudit = lazy(() => import('./components/SecurityAudit'));
const RankTracker = lazy(() => import('./components/RankTracker'));
const Imports = lazy(() => import('./components/Imports'));
const Reports = lazy(() => import('./components/Reports'));
const Settings = lazy(() => import('./components/Settings'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const SearchData = lazy(() => import('./components/SearchData'));
const LiveAuditProgress = lazy(() => loadLiveAuditScreen().then((mod) => ({ default: mod.LiveAuditProgress })));
const AuditWorkspace = lazy(() => import('./components/audit/AuditWorkspace'));
const AuditHistoryPage = lazy(() => import('./components/audit/AuditHistoryPage'));
const SharedReportPage = lazy(() => import('./components/audit/SharedReportPage'));
const BlogIndex = lazy(() => import('./components/blog/BlogIndex'));
const BlogPostPage = lazy(() => import('./components/blog/BlogPostPage'));
const LegalPage = lazy(() => import('./components/LegalPage'));
const ToolsHub = lazy(() => import('./components/tools/ToolsHub'));
const NotFoundPage = lazy(() => import('./components/NotFoundPage'));

export type { TabType } from './app/routes';

export default function App() {
  return <AuditLaunchProvider><AppContent /></AuditLaunchProvider>;
}

function AppContent() {
  const { user, loading: authLoading, logout, profilePending, unverifiedEmail, setUnverifiedEmail } = useAuth();
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
  const liveAuditId = (() => {
    const encodedId = pathname.match(/^\/audit\/live\/([^/]+)\/?$/)?.[1];
    if (!encodedId) return null;
    try {
      return decodeURIComponent(encodedId);
    } catch {
      return encodedId;
    }
  })();
  const requestedLiveSection = new URLSearchParams(routerLocation.search).get('section');
  const liveAuditSection: AuditWorkspaceSection = ['overview', 'seo', 'technical', 'crawlability', 'links', 'performance', 'accessibility', 'security', 'pages'].includes(requestedLiveSection || '')
    ? requestedLiveSection as AuditWorkspaceSection
    : 'overview';
  const { startAudit, initialSnapshotFor } = useAuditLaunch();

  useEffect(() => {
    activateBrowserMonitoringForPath(pathname);
  }, [pathname]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth >= 1024);
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
      '/': { title: `${BRAND.name} - ${BRAND.tagline}`, description: BRAND.description },
      '/pricing': { title: `Pricing and Free Audit Limits | ${BRAND.name}`, description: `Compare ${BRAND.name} Quick, Standard, and Deep audit limits without hidden ranking or backlink data claims.` },
      '/reports/example': { title: `Example Website Audit Report | ${BRAND.name}`, description: `Explore an example ${BRAND.name} report with website health, coverage, passive security, previews, and prioritized fixes.` },
      '/tools': { title: `Free SEO Tools | ${BRAND.name}`, description: 'Private browser tools for search previews, robots rules, structured data and observed header remediation.' },
      '/login': { title: `Sign in | ${BRAND.name}`, description: `Sign in to manage ${BRAND.name} website audits and reports.` },
      '/register': { title: `Create an account | ${BRAND.name}`, description: `Create a ${BRAND.name} account to save audits, reports, and fix progress.` },
      '/admin/login': { title: `Administrator sign in | ${BRAND.name}`, description: `Secure administrator access for ${BRAND.name}.` },
    };
    const page = pages[pathname]
      || (pathname.startsWith('/audit/live/') ? { title: `Live website audit | ${BRAND.name}`, description: 'Follow website checks and collected evidence as the audit runs.' } : null)
      || (pathname.startsWith('/app') ? { title: `Audit workspace | ${BRAND.name}`, description: 'Review website audits, findings, reports, imports, and saved history.' } : null)
      || (pathname.startsWith('/admin') ? { title: `Admin dashboard | ${BRAND.name}`, description: `Manage ${BRAND.name} users, audits, plans, blog operations, and deployment health.` } : null);
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
    if (user && (pathname === '/login' || pathname === '/register')) {
      setAuthMode(null);
      navigate('/app', { replace: true });
    }
  }, [navigate, pathname, user]);

  useEffect(() => {
    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]') || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'robots' }));
    robots.content = pathname.startsWith('/app') || pathname.startsWith('/admin') || pathname.startsWith('/audit/live/') || pathname.startsWith('/share/') || pathname === '/login' || pathname === '/register'
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
    await startAudit({ url: rawUrl, mode });
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
  const shareMatch = pathname.match(/^\/share\/([A-Za-z0-9_-]{40,80})\/?$/);
  const knownPublicRoute = pathname === '/' || pathname === '/tools' || pathname === '/pricing' || pathname === '/reports/example' || pathname === '/login' || pathname === '/register' || isBlogRoute || Boolean(shareMatch) || Boolean(legalKind);
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
          <h1 className="text-2xl font-bold font-display text-foreground mb-4">Check your email</h1>
          <p className="text-muted-foreground mb-8">
            Check <span className="text-foreground font-medium">{unverifiedEmail}</span> for a confirmation link, including your spam folder. Confirm your email, then sign in. If you already have an account, sign in instead.
          </p>
          <button
            onClick={() => {
              setUnverifiedEmail(null);
              setAuthMode('login');
              navigate('/login', { replace: true });
            }}
            className="trust-button w-full"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (profilePending && !user) {
    return <Suspense fallback={<LoadingSkeleton rows={4} />}><AccountRecovery /></Suspense>;
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
            <LiveAuditProgress
              auditId={liveAuditId}
              initialSnapshot={initialSnapshotFor(liveAuditId)}
              onRerun={startLiveAudit}
              onOpenWorkspace={() => navigate(`/app/audits/${encodeURIComponent(liveAuditId)}/${liveAuditSection}`)}
            />
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
      case 'projects':
        return <ProjectsPage onStartAudit={() => setActiveTab('seo-audit')} onOpenReports={() => setActiveTab('reports')} />;
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
      case 'tools':
        return <ToolsHub />;
      case 'admin-dashboard':
        return <AdminDashboard />;
      default:
        return <NotFoundPage onHome={() => navigate('/')} />;
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans overflow-x-hidden selection:bg-accent/30 transition-colors duration-300">
      {authMode && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#0b1b46]/35 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={authMode === 'login' ? 'Sign in' : 'Create account'}>
          <div className="relative w-full max-w-md">
            <Suspense fallback={<div className="flex items-center justify-center rounded-xl border border-border bg-card p-8"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>}>
              {authMode === 'login' ? (
                <Login onSuccess={() => { setAuthMode(null); navigate('/app'); }} onToggle={() => { setAuthMode('register'); if (pathname === '/login') navigate('/register'); }} onClose={() => { setAuthMode(null); if (pathname === '/login' || pathname === '/admin/login') navigate('/'); }} />
              ) : (
                <Register onSuccess={() => { setAuthMode(null); navigate('/app'); }} onToggle={() => { setAuthMode('login'); if (pathname === '/register') navigate('/login'); }} onClose={() => { setAuthMode(null); if (pathname === '/register') navigate('/'); }} />
              )}
            </Suspense>
          </div>
        </div>
      )}

      <div className="relative z-10 flex flex-col min-h-screen">
        {pathname === '/tools' ? (
          <MarketingShell theme={theme} onToggleTheme={toggleTheme} userLabel={user?.username || (user ? 'Account' : null)} authLoading={authLoading} navigationBase="/" onHome={() => navigate('/')} onLogin={() => setAuthMode('login')} onSettings={() => openAppTab('settings')} onLogout={handleLogout}>
            <main id="main-content" className="section-shell py-8" tabIndex={-1}><Suspense fallback={<LoadingSkeleton rows={5} />}><ToolsHub /></Suspense></main>
          </MarketingShell>
        ) : shareMatch ? (
          <MarketingShell theme={theme} onToggleTheme={toggleTheme} userLabel={user?.username || (user ? 'Account' : null)} authLoading={authLoading} navigationBase="/" onHome={() => navigate('/')} onLogin={() => setAuthMode('login')} onSettings={() => openAppTab('settings')} onLogout={handleLogout}>
            <Suspense fallback={<LoadingSkeleton rows={5} />}><SharedReportPage token={shareMatch[1]} /></Suspense>
          </MarketingShell>
        ) : legalKind ? (
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
                onStartAudit={startLiveAudit}
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
