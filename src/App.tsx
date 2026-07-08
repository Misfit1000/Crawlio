import React, { useState, useEffect, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Activity, LogOut, User, MapPin, Sun, Moon, Command, Menu, Mail, Loader2, X, TrendingUp } from 'lucide-react';
import Login from './components/Login';
import Register from './components/Register';
import Sidebar from './components/Sidebar';
import CountrySelect from './components/CountrySelect';
import CommandPalette from './components/CommandPalette';
import LandingPage from './components/LandingPage';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './contexts/ThemeContext';
import { API_ROUTES } from './lib/api/routes';
import { safeJsonFetch } from './lib/http/safe-json';

// Lazy load heavy components
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

export type TabType = 'dashboard' | 'keyword-research' | 'website-analyzer' | 'keyword-clusters' | 'competitor-gap' | 'content-briefs' | 'seo-audit' | 'security-audit' | 'rank-tracker' | 'imports' | 'reports' | 'settings' | 'admin-dashboard' | 'public-discovery' | 'search-data';

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
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(() => {
    if (window.location.pathname === '/admin/login') {
      return 'login';
    }
    return null;
  });
  const [isSearching, setIsSearching] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [searchedKeyword, setSearchedKeyword] = useState('');
  const [location, setLocation] = useState('US');
  const [searchedLocation, setSearchedLocation] = useState('US');
  const [userLatLng, setUserLatLng] = useState<{latitude: number, longitude: number} | null>(null);
  const [searchedLatLng, setSearchedLatLng] = useState<{latitude: number, longitude: number} | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [liveAuditId, setLiveAuditId] = useState<string | null>(() => {
    const match = window.location.pathname.match(/^\/audit\/live\/([^/]+)/);
    return match?.[1] || null;
  });
  const [startAuditError, setStartAuditError] = useState<string | null>(null);

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

  useEffect(() => {
    const syncLiveRoute = () => {
      const match = window.location.pathname.match(/^\/audit\/live\/([^/]+)/);
      setLiveAuditId(match?.[1] || null);
    };
    const handleNavigate = (event: Event) => {
      const auditId = (event as CustomEvent<string>).detail;
      if (auditId) setLiveAuditId(auditId);
    };
    window.addEventListener('popstate', syncLiveRoute);
    window.addEventListener('navigate-live-audit', handleNavigate);
    return () => {
      window.removeEventListener('popstate', syncLiveRoute);
      window.removeEventListener('navigate-live-audit', handleNavigate);
    };
  }, []);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    if (window.location.pathname.startsWith('/admin')) {
      return 'admin-dashboard';
    }
    return 'dashboard';
  });
  const [inDepthAnalysis, setInDepthAnalysis] = useState(false);

  useEffect(() => {
    if (activeTab === 'admin-dashboard') {
      if (authMode === 'login') {
        window.history.replaceState(null, '', '/admin/login');
      } else {
        window.history.replaceState(null, '', '/admin');
      }
    } else {
      window.history.replaceState(null, '', '/');
    }
  }, [activeTab, authMode]);

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
    setIsSearching(true);

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
      setIsSearching(false);
      setKeyword('');
      setSearchedKeyword('');
      setInDepthAnalysis(false);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const startLiveAudit = async (rawUrl: string, mode: 'quick' | 'standard' | 'deep' = 'quick') => {
    setStartAuditError(null);
    const response = await safeJsonFetch<any>(API_ROUTES.auditStart, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: rawUrl, mode }),
    });
    if (!response.success) {
      throw new Error((response as any).error || 'Failed to start audit');
    }
    const auditId = response.data.data?.auditId || response.data.auditId;
    window.history.pushState(null, '', `/audit/live/${auditId}`);
    setLiveAuditId(auditId);
    setIsSearching(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (unverifiedEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-card border border-border rounded-3xl p-8 text-center shadow-2xl"
        >
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
        </motion.div>
      </div>
    );
  }

  if (liveAuditId) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans transition-colors duration-300">
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border h-16 px-4 md:px-6 flex items-center justify-between">
          <button
            type="button"
            className="flex items-center gap-2 text-foreground font-bold text-lg tracking-tight"
            onClick={() => {
              window.history.pushState(null, '', '/');
              setLiveAuditId(null);
              setIsSearching(false);
            }}
          >
            <div className="bg-accent text-accent-foreground p-1.5 rounded-lg">
              <TrendingUp className="w-5 h-5" />
            </div>
            <span className="text-xl">SEO<span className="text-accent">Intel</span></span>
          </button>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </header>
        <main className="max-w-7xl mx-auto p-4 md:p-8">
          <Suspense fallback={<div className="h-64 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>}>
            <LiveAuditProgress auditId={liveAuditId} />
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
      case 'security-audit':
        return <SecurityAudit />;
      case 'rank-tracker':
        return <RankTracker />;
      case 'public-discovery': return <PublicDiscovery />;
      case 'search-data': return <SearchData />;
      case 'imports':
        return <Imports />;
      case 'reports':
        return <Reports />;
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
      {/* Background Glow */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent/10 blur-[120px] rounded-full dark:bg-accent/15" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full dark:bg-blue-500/15" />
      </div>

      <CommandPalette 
        isOpen={isCommandPaletteOpen} 
        onClose={() => setIsCommandPaletteOpen(false)} 
        onSearch={(k) => handleSearch(undefined, k)} 
      />

      <AnimatePresence>
        {authMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          >
            <div className="relative w-full max-w-md">
              {authMode === 'login' ? (
                <Login onToggle={() => setAuthMode('register')} onClose={() => setAuthMode(null)} />
              ) : (
                <Register onToggle={() => setAuthMode('login')} onClose={() => setAuthMode(null)} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10 flex flex-col min-h-screen">
        <AnimatePresence mode="wait">
          {!isSearching ? (
            <motion.div
              key="hero"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.3 } }}
              className="flex-1 flex flex-col items-center justify-center p-6"
            >
              <div className="absolute top-6 right-6 flex items-center gap-4">
                <button 
                  onClick={toggleTheme}
                  className="p-2 rounded-full bg-card/50 backdrop-blur-md border border-border text-muted-foreground hover:text-foreground transition-colors"
                  title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                >
                  {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
                {user ? (
                  <>
                    <button 
                      onClick={() => {
                        setActiveTab('settings');
                        setIsSearching(true);
                      }}
                      className="flex items-center gap-2 text-foreground bg-card/50 backdrop-blur-md border border-border px-4 py-2 rounded-full cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <User className="w-4 h-4" />
                      <span className="text-sm font-medium">{user.username || 'User'}</span>
                    </button>
                    <button onClick={handleLogout} className="text-muted-foreground hover:text-red-500 transition-colors p-2 rounded-full hover:bg-muted/50" title="Sign out">
                      <LogOut className="w-5 h-5" />
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setAuthMode('login')}
                      className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-4 py-2"
                    >
                      Log in
                    </button>
                    <button 
                      onClick={() => setAuthMode('register')}
                      className="text-sm font-medium bg-foreground text-background hover:bg-foreground/90 px-4 py-2 rounded-full transition-colors"
                    >
                      Sign up
                    </button>
                  </div>
                )}
              </div>

              <LandingPage 
                onStartAudit={async (url) => {
                  try {
                    await startLiveAudit(url, 'quick');
                  } catch (error: any) {
                    setStartAuditError(error.message || 'Failed to start audit');
                    setKeyword(url);
                    setSearchedKeyword(url);
                    setActiveTab('seo-audit');
                    setIsSearching(true);
                  }
                }}
                onExploreFeatures={() => {
                  setActiveTab('dashboard');
                  setIsSearching(true);
                }}
              />
              {startAuditError && (
                <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
                  {startAuditError}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="flex-1 flex flex-col"
            >
              {/* Header */}
              <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border h-16 px-4 md:px-6 flex items-center justify-between transition-colors duration-300">
                <div className="flex items-center gap-4 flex-1">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                      className="p-2 -ml-2 rounded-xl hover:bg-muted text-muted-foreground transition-colors"
                    >
                      <Menu className="w-5 h-5" />
                    </button>
                    <motion.div 
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.2 }}
                      className="flex items-center gap-2 text-foreground font-bold text-lg tracking-tight cursor-pointer" 
                      onClick={() => setIsSearching(false)}
                    >
                      <div className="bg-accent text-accent-foreground p-1.5 rounded-lg">
                        <TrendingUp className="w-5 h-5" />
                      </div>
                      <span className="hidden md:inline text-xl">SEO<span className="text-accent">Intel</span></span>
                    </motion.div>
                  </div>
                  
                  <form onSubmit={(e) => handleSearch(e, undefined, false)} className="flex-1 max-w-2xl relative group hidden md:flex items-center ml-4 bg-muted/30 hover:bg-muted/60 focus-within:bg-muted/60 border border-border rounded-xl transition-all shadow-sm">
                    <Search className="w-4 h-4 text-muted-foreground ml-3 flex-shrink-0" />
                    <input
                      type="text"
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder="Search audits, reports, pages..."
                      className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground px-3 py-2 text-sm font-medium min-w-0"
                    />
                    <div className="flex items-center gap-1 pr-2 flex-shrink-0">
                      <button
                        type="submit"
                        className="px-3 py-1.5 text-xs font-medium bg-background border border-border text-foreground rounded-lg hover:bg-muted transition-colors"
                      >
                        Basic
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleSearch(e, undefined, true)}
                        className="px-3 py-1.5 text-xs font-bold bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 transition-colors flex items-center gap-1 shadow-sm shadow-accent/20"
                      >
                        <TrendingUp className="w-3 h-3" />
                        In-Depth
                      </button>
                    </div>
                  </form>
                </div>
                
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                  className="flex items-center gap-3 ml-4"
                >
                  <button 
                    onClick={toggleTheme}
                    className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                  >
                    {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                  </button>
                  <div className="h-5 w-px bg-border hidden md:block mx-1"></div>
                  {user ? (
                    <>
                      <button 
                        onClick={() => setActiveTab('settings')}
                        className="hidden md:flex items-center gap-2 text-foreground bg-muted/30 border border-border px-3 py-1.5 rounded-xl hover:bg-muted/60 transition-colors"
                      >
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium truncate max-w-[120px]">{user.username || 'User'}</span>
                      </button>
                      <button onClick={handleLogout} className="text-muted-foreground hover:text-red-500 transition-colors p-2 rounded-xl hover:bg-red-500/10" title="Sign out">
                        <LogOut className="w-5 h-5" />
                      </button>
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setAuthMode('login')}
                        className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded-xl hover:bg-muted"
                      >
                        Log in
                      </button>
                      <button 
                        onClick={() => setAuthMode('register')}
                        className="text-sm font-bold bg-accent text-accent-foreground hover:bg-accent/90 px-4 py-2 rounded-xl transition-colors shadow-sm shadow-accent/20"
                      >
                        Sign up
                      </button>
                    </div>
                  )}
                </motion.div>
              </header>

              <div className="flex flex-1 relative">
                <Sidebar 
                  isOpen={isSidebarOpen} 
                  onClose={() => setIsSidebarOpen(false)} 
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                />
                <main className="flex-1 p-6 md:p-8 w-full">
                  <Suspense fallback={
                    <div className="flex items-center justify-center h-64">
                      <Loader2 className="w-8 h-8 text-accent animate-spin" />
                    </div>
                  }>
                    {renderContent()}
                  </Suspense>
                </main>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
