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
  parseAuditWorkspacePath,
  tabForPath,
  type TabType,
} from './app/routes';

// Lazy load heavy components
const Login = lazy(() => import('./components/Login'));
const Register = lazy(() => import('./components/Register'));
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const Sidebar = lazy(() => import('./components/Sidebar'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const KeywordResearch = lazy(() => import('./components/KeywordResearch'));
const WebsiteAnalyzer = lazy(() => import('./components/WebsiteAnalyzer'));
const KeywordClusters = lazy(() => import('./components/KeywordClusters'));
const CompetitorGap = lazy(() => import('./components/CompetitorGap'));
const ContentBriefs = lazy(() => import('./components/ContentBriefs'));
const SeoAudit = lazy(() => import('./components/SeoAudit'));
const SecurityAudit = lazy(() => import('./components/SecurityAudit'));
const RankTracker = lazy(() => import('./components/RankTracker'));
const Imports = lazy(() => import('./components/Imports'));
const Reports = lazy(() => import('./components/Reports'));
const Settings = lazy(() => import('./components/Settings'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const PublicDiscovery = lazy(() => import('./components/PublicDiscovery'));
const SearchData = lazy(() => import('./components/SearchData'));
const LiveAuditProgress = lazy(() => import('./components/audit/LiveAuditProgress').then((mod) => ({ default: mod.LiveAuditProgress })));
const AuditWorkspace = lazy(() => import('./components/audit/AuditWorkspace'));
const AuditHistoryPage = lazy(() => import('./components/audit/AuditHistoryPage'));
const BlogIndex = lazy(() => import('./components/blog/BlogIndex'));
const BlogPostPage = lazy(() => import('./components/blog/BlogPostPage'));

export type { TabType } from './app/routes';

const LOCATIONS = [
  { code: 'US', name: 'United States' },
  { code: 'UK', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'IN', name: 'India' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'JP', name: 'Japan' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'IT', name: 'Italy' },
  { code: 'ES', name: 'Spain' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'SE', name: 'Sweden' },
  { code: 'SG', name: 'Singapore' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'IE', name: 'Ireland' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'AT', name: 'Austria' },
  { code: 'BE', name: 'Belgium' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
  { code: 'NO', name: 'Norway' },
  { code: 'PT', name: 'Portugal' },
  { code: 'PL', name: 'Poland' },
  { code: 'TR', name: 'Turkey' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'KR', name: 'South Korea' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'PH', name: 'Philippines' },
  { code: 'TH', name: 'Thailand' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CO', name: 'Colombia' },
  { code: 'CL', name: 'Chile' },
  { code: 'PE', name: 'Peru' },
  { code: 'EG', name: 'Egypt' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'KE', name: 'Kenya' },
  { code: 'NP', name: 'Nepal' },
];


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
  const [keyword, setKeyword] = useState('');
  const [searchedKeyword, setSearchedKeyword] = useState('');
  const [location, setLocation] = useState('US');
  const [searchedLocation, setSearchedLocation] = useState('US');
  const [userLatLng, setUserLatLng] = useState<{latitude: number, longitude: number} | null>(null);
  const [searchedLatLng, setSearchedLatLng] = useState<{latitude: number, longitude: number} | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const liveAuditId = pathname.match(/^\/audit\/live\/([^/]+)/)?.[1] || null;
  const [startAuditError, setStartAuditError] = useState<string | null>(null);
  const auditStartGuardRef = useRef(createAuditSubmitGuard());

  useEffect(() => {
    const loadRecent = () => {
      try {
        const stored = localStorage.getItem('recentSearches');
        if (stored) {
          setRecentSearches(JSON.parse(stored));
        }
      } catch (e) {
        console.error("Failed to parse recent searches", e);
      }
    };
    loadRecent();
    window.addEventListener('recentSearchesUpdated', loadRecent);
    return () => window.removeEventListener('recentSearchesUpdated', loadRecent);
  }, []);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const activeTab = tabForPath(pathname);
  const workspaceRoute = parseAuditWorkspacePath(pathname);
  const isSearching = isWorkspacePath(pathname);
  const setActiveTab = (tab: TabType) => navigate(TAB_PATHS[tab]);
  const [inDepthAnalysis, setInDepthAnalysis] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsSidebarOpen(false);
      } else {
        setIsSidebarOpen(true);
      }
    };

    // Set initial state
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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleGetLocation = () => {
    setIsLocating(true);
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          
          setUserLatLng({ latitude: lat, longitude: lng });
          
          try {
            // Reverse geocode to get a more precise location name
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
            const data = await response.json();
            if (data && data.address) {
              const city = data.address.city || data.address.town || data.address.village || data.address.county;
              const country = data.address.country;
              if (city && country) {
                setLocation(`CURRENT_LOCATION:${city}, ${country}`);
              } else {
                setLocation('CURRENT_LOCATION');
              }
            } else {
              setLocation('CURRENT_LOCATION');
            }
          } catch (error) {
            console.error("Reverse geocoding failed", error);
            setLocation('CURRENT_LOCATION');
          }
          
          setIsLocating(false);
        },
        (error) => {
          console.error("Error getting location", error);
          setIsLocating(false);
          alert("Could not get your location. Please check your permissions.");
        }
      );
    } else {
      setIsLocating(false);
      alert("Geolocation is not supported by your browser.");
    }
  };

  const handleSearch = (e?: React.FormEvent | React.MouseEvent, manualKeyword?: string, forceInDepth?: boolean) => {
    if (e) e.preventDefault();
    
    let actualKeyword = (manualKeyword || keyword).trim();
    
    // If empty, default to a keyword so the buttons "work" even without typing
    if (!actualKeyword) {
      actualKeyword = "seo tools";
    }

    // Check if in-depth analysis is requested and user is not logged in
    if (forceInDepth && !user) {
      setAuthMode('login');
      return;
    }

    setKeyword(actualKeyword);
    setSearchedKeyword(actualKeyword);
    setSearchedLocation(location);
    setSearchedLatLng(location.startsWith('CURRENT_LOCATION') ? userLatLng : null);
    setInDepthAnalysis(!!forceInDepth && !!user);
    navigate(TAB_PATHS.dashboard);

    try {
      const stored = localStorage.getItem('recentSearches');
      let recent = stored ? JSON.parse(stored) : [];
      recent = [actualKeyword, ...recent.filter((k: string) => k !== actualKeyword)].slice(0, 5);
      localStorage.setItem('recentSearches', JSON.stringify(recent));
      window.dispatchEvent(new Event('recentSearchesUpdated'));
    } catch (err) {
      console.error("Failed to save recent search", err);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/');
      setKeyword('');
      setSearchedKeyword('');
      setInDepthAnalysis(false);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const startLiveAudit = async (rawUrl: string, mode: 'quick' | 'standard' | 'deep' = 'quick') => {
    if (!auditStartGuardRef.current.begin()) return;
    setStartAuditError(null);
    try {
      const response = await safeJsonFetch<any>(API_ROUTES.auditStart, {
        method: 'POST',
        headers: await getAuditStartHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url: rawUrl, mode }),
      });
      if (!response.success) {
        throw new Error((response as any).error || 'Failed to start audit');
      }
      const auditId = response.data.data?.auditId || response.data.auditId;
      navigate(`/audit/live/${encodeURIComponent(auditId)}`);
    } catch (error) {
      throw error;
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
          <div className="p-3 bg-accent/10 rounded-2xl text-accent mb-4 inline-block">
            <Mail className="w-12 h-12" />
          </div>
          <h1 className="text-2xl font-bold font-display text-foreground mb-4">Verify your email</h1>
          <p className="text-muted-foreground mb-8">
            We have sent you a verification email to <span className="text-foreground font-medium">{unverifiedEmail}</span>. Please verify it and log in.
          </p>
          <button
            onClick={() => {
              setUnverifiedEmail(null);
              setAuthMode('login');
            }}
            className="w-full bg-accent hover:bg-accent/90 text-accent-foreground font-semibold py-3 rounded-xl transition-all shadow-lg shadow-accent/20"
          >
            Login
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
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border h-16 px-4 md:px-6 flex items-center justify-between">
          <button
            type="button"
            className="rounded-2xl"
            onClick={() => navigate('/')}
          >
            <BrandMark />
          </button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </header>
        <main className="mx-auto w-full max-w-[1600px] p-3 sm:p-5 md:p-8">
          <Suspense fallback={<div className="h-64 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>}>
            <LiveAuditProgress auditId={liveAuditId} onRerun={(url) => startLiveAudit(url, 'quick')} onOpenWorkspace={() => navigate(`/app/audits/${encodeURIComponent(liveAuditId)}/overview`)} />
          </Suspense>
        </main>
      </div>
    );
  }

  // Remove the strict !user check here so we can show the search bar
  // if (!user) {
  //   return authMode === 'login' ? (
  //     <Login onToggle={() => setAuthMode('register')} />
  //   ) : (
  //     <Register onToggle={() => setAuthMode('login')} />
  //   );
  // }

  const renderContent = () => {
    const locationName = searchedLocation.startsWith('CURRENT_LOCATION') 
      ? (searchedLocation.split(':')[1] || 'Current Location') 
      : LOCATIONS.find(l => l.code === searchedLocation)?.name;

    if (workspaceRoute) {
      return <AuditWorkspace auditId={workspaceRoute.auditId} section={workspaceRoute.section} />;
    }

    switch (activeTab) {
      case 'dashboard':
        return (
          <Dashboard 
            keyword={searchedKeyword} 
            location={locationName} 
            latLng={searchedLatLng}
            onLocationChange={(newLocationCode) => {
              setLocation(newLocationCode);
              setSearchedLocation(newLocationCode);
              setSearchedLatLng(null);
            }}
            inDepth={inDepthAnalysis}
            isLoggedIn={!!user}
            onRunInDepth={() => handleSearch(undefined, searchedKeyword, true)}
            onOpenSeoAudit={() => setActiveTab('seo-audit')}
            onOpenSecurityAudit={() => setActiveTab('security-audit')}
            onOpenImports={() => setActiveTab('imports')}
            onOpenReports={() => setActiveTab('reports')}
          />
        );
      case 'keyword-research':
        return <KeywordResearch keyword={searchedKeyword} />;
      case 'website-analyzer':
        return <WebsiteAnalyzer />;
      case 'keyword-clusters':
        return <KeywordClusters />;
      case 'competitor-gap':
        return <CompetitorGap />;
      case 'content-briefs':
        return <ContentBriefs />;
      case 'seo-audit':
        return <SeoAudit initialUrl={searchedKeyword} />;
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
      case 'public-discovery': return <PublicDiscovery />;
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
      {isCommandPaletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            isOpen={isCommandPaletteOpen}
            onClose={() => setIsCommandPaletteOpen(false)}
            onSearch={(k) => handleSearch(undefined, k)}
          />
        </Suspense>
      )}

      {authMode && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#0b1b46]/35 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={authMode === 'login' ? 'Sign in' : 'Create account'}>
          <div className="relative w-full max-w-md">
            <Suspense fallback={<div className="flex items-center justify-center rounded-2xl border border-border bg-card p-8"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>}>
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
        {isBlogRoute ? (
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
        ) : !isSearching ? (
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
                onStartAudit={async (url) => {
                  try {
                    await startLiveAudit(url, 'quick');
                  } catch (error: any) {
                    setStartAuditError(error.message || 'Failed to start audit');
                    setKeyword(url);
                    setSearchedKeyword(url);
                    setActiveTab('seo-audit');
                  }
                }}
                onExploreFeatures={() => {
                  openAppTab('dashboard');
                }}
                onNavigate={handleLandingNavigate}
              />
              {startAuditError && (
                <div className="mx-auto mb-6 w-[min(92vw,720px)] rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
                  {startAuditError}
                </div>
              )}
            </MarketingShell>
          ) : (
            <WorkspaceShell
              theme={theme}
              onToggleTheme={toggleTheme}
              sidebarOpen={isSidebarOpen}
              onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
              onHome={() => navigate('/')}
              query={keyword}
              onQueryChange={setKeyword}
              onSearch={(event) => handleSearch(event, undefined, false)}
              onDeepSearch={() => handleSearch(undefined, undefined, true)}
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
          )}
      </div>
    </div>
  );
}
