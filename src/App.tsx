import React, { useState, useEffect, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Activity, LogOut, User, MapPin, Sun, Moon, Command, Menu, Mail, Loader2, X, TrendingUp } from 'lucide-react';
import Login from './components/Login';
import Register from './components/Register';
import Sidebar from './components/Sidebar';
import CountrySelect from './components/CountrySelect';
import CommandPalette from './components/CommandPalette';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './contexts/ThemeContext';

// Lazy load heavy components
const Dashboard = lazy(() => import('./components/Dashboard'));
const KeywordMagicTool = lazy(() => import('./components/KeywordMagicTool'));
const PositionTracking = lazy(() => import('./components/PositionTracking'));
const BacklinkAnalytics = lazy(() => import('./components/BacklinkAnalytics'));
const UserProfile = lazy(() => import('./components/UserProfile'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const KeywordProjects = lazy(() => import('./components/KeywordProjects'));
const TrackedCompetitors = lazy(() => import('./components/TrackedCompetitors'));

export type TabType = 'dashboard' | 'keyword-magic' | 'position-tracking' | 'backlink-analytics' | 'user-profile' | 'admin-dashboard' | 'keyword-projects' | 'tracked-competitors';

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

const POPULAR_KEYWORDS = [
  "artificial intelligence", "machine learning", "saas marketing", "seo tools",
  "content marketing", "digital marketing", "social media marketing", "email marketing",
  "affiliate marketing", "ecommerce seo", "local seo", "link building",
  "keyword research", "chatgpt", "openai", "python programming",
  "javascript frameworks", "react js", "next js", "tailwind css",
  "web development", "app development", "ui ux design", "graphic design",
  "video editing", "data science", "data analytics", "business intelligence",
  "cloud computing", "cybersecurity", "blockchain technology", "cryptocurrency",
  "personal finance", "investing strategies", "real estate", "fitness tips",
  "healthy recipes", "weight loss", "mental health", "travel destinations",
  "photography tips", "home decor", "diy projects", "parenting advice", "pet care"
];

export default function App() {
  const { user, loading: authLoading, logout, unverifiedEmail, setUnverifiedEmail } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null);
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
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (keyword.trim()) {
      const filtered = POPULAR_KEYWORDS.filter(k => k.toLowerCase().includes(keyword.toLowerCase()) && k.toLowerCase() !== keyword.toLowerCase()).slice(0, 3);
      setSuggestions(filtered);
    } else {
      setSuggestions([]);
    }
  }, [keyword]);

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
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
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

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (unverifiedEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 text-center shadow-2xl"
        >
          <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-400 mb-4 inline-block">
            <Mail className="w-12 h-12" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-4">Verify your email</h1>
          <p className="text-slate-400 mb-8">
            We have sent you a verification email to <span className="text-white font-medium">{unverifiedEmail}</span>. Please verify it and log in.
          </p>
          <button
            onClick={() => {
              setUnverifiedEmail(null);
              setAuthMode('login');
            }}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-blue-500/20"
          >
            Login
          </button>
        </motion.div>
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
      case 'keyword-magic':
        return (
          <KeywordMagicTool keyword={searchedKeyword} location={locationName} latLng={searchedLatLng} />
        );
      case 'position-tracking':
        return <PositionTracking keyword={searchedKeyword} location={locationName} />;
      case 'backlink-analytics':
        return <BacklinkAnalytics keyword={searchedKeyword} />;
      case 'user-profile':
        return <UserProfile />;
      case 'admin-dashboard':
        return <AdminDashboard />;
      case 'keyword-projects':
        return <KeywordProjects />;
      case 'tracked-competitors':
        return <TrackedCompetitors />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans overflow-x-hidden selection:bg-accent/30 transition-colors duration-300">
      {/* Background Glow */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-accent/5 blur-[120px] rounded-full dark:bg-accent/10" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-600/5 blur-[120px] rounded-full dark:bg-purple-600/10" />
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
                        setActiveTab('user-profile');
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

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.8, ease: "easeOut" }}
                className="text-center mb-16"
              >
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent text-sm font-medium mb-6 border border-accent/20">
                  <TrendingUp className="w-4 h-4" />
                  <span>Next-Gen SEO Intelligence</span>
                </div>
                <h1 className="text-6xl md:text-8xl font-bold tracking-tighter mb-6 text-foreground">
                  Analyze <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-green-400">Anything.</span>
                </h1>
                <p className="text-muted-foreground text-lg md:text-2xl max-w-3xl mx-auto font-light leading-relaxed">
                  Uncover real-time search volumes, trends, and difficulty in a seamless, unified interface.
                </p>
              </motion.div>

              <form onSubmit={handleSearch} className="w-full max-w-4xl relative group">
                <motion.div layoutId="search-container" className="relative flex flex-col md:flex-row items-center bg-card/80 backdrop-blur-xl border border-border rounded-3xl p-2 shadow-2xl z-20 transition-all duration-300 focus-within:ring-2 focus-within:ring-accent/50 focus-within:border-accent">
                  <div className="absolute -inset-1 bg-gradient-to-r from-accent to-green-400 rounded-3xl blur opacity-20 group-hover:opacity-40 transition duration-500 -z-10"></div>
                  <div className="flex items-center w-full flex-1 px-4 py-4">
                    <Search className="w-8 h-8 text-muted-foreground mr-4" />
                    <input
                      type="text"
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder="Enter a keyword (e.g., react server components)..."
                      className="w-full bg-transparent border-none outline-none text-2xl text-foreground placeholder:text-muted-foreground/50 font-light"
                      autoFocus
                    />
                  </div>
                  
                  <div className="w-full md:w-px h-px md:h-12 bg-border my-2 md:my-0 mx-2"></div>
                  
                  <div className="flex items-center justify-between w-full md:w-auto px-4 py-2 md:py-0">
                    <CountrySelect 
                      locations={LOCATIONS}
                      value={location}
                      onChange={setLocation}
                      onGetLocation={handleGetLocation}
                      isLocating={isLocating}
                    />
                  </div>
                  
                  <div className="flex items-center gap-2 w-full md:w-auto mt-4 md:mt-0 px-2 md:px-0">
                    <button
                      type="submit"
                      className="flex-1 md:flex-none bg-muted text-foreground hover:bg-muted/80 px-6 py-3 rounded-2xl font-medium transition-colors duration-200 whitespace-nowrap"
                    >
                      Basic
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleSearch(e, undefined, true)}
                      className="flex-1 md:flex-none bg-accent text-accent-foreground hover:bg-accent/90 px-6 py-3 rounded-2xl font-bold transition-colors duration-200 whitespace-nowrap flex items-center justify-center gap-2"
                    >
                      <TrendingUp className="w-5 h-5" />
                      In-Depth
                    </button>
                  </div>
                </motion.div>
                
                {/* Search suggestions/recent could go here */}
                <div className="absolute top-full left-0 w-full pt-4 opacity-0 group-focus-within:opacity-100 transition-opacity duration-300 pointer-events-none group-focus-within:pointer-events-auto z-10">
                  <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground flex-wrap">
                    {keyword.trim() ? (
                      suggestions.length > 0 ? (
                        <>
                          <span className="flex items-center gap-1"><Search className="w-4 h-4" /> Suggestions:</span>
                          {suggestions.map((search, index) => (
                            <React.Fragment key={search}>
                              <button type="button" onMouseDown={(e) => { e.preventDefault(); setKeyword(search); handleSearch(undefined, search); }} className="hover:text-foreground transition-colors">{search}</button>
                              {index < suggestions.length - 1 && <span className="w-1 h-1 rounded-full bg-border"></span>}
                            </React.Fragment>
                          ))}
                        </>
                      ) : null
                    ) : (
                      <>
                        <span className="flex items-center gap-1"><TrendingUp className="w-4 h-4" /> {recentSearches.length > 0 ? 'Recent:' : 'Trending:'}</span>
                        {recentSearches.length > 0 ? (
                          recentSearches.slice(0, 3).map((search, index) => (
                            <React.Fragment key={search}>
                              <button type="button" onMouseDown={(e) => { e.preventDefault(); setKeyword(search); handleSearch(undefined, search); }} className="hover:text-foreground transition-colors">{search}</button>
                              {index < Math.min(recentSearches.length, 3) - 1 && <span className="w-1 h-1 rounded-full bg-border"></span>}
                            </React.Fragment>
                          ))
                        ) : (
                          <>
                            <button type="button" onMouseDown={(e) => { e.preventDefault(); setKeyword('machine learning'); handleSearch(undefined, 'machine learning'); }} className="hover:text-foreground transition-colors">machine learning</button>
                            <span className="w-1 h-1 rounded-full bg-border"></span>
                            <button type="button" onMouseDown={(e) => { e.preventDefault(); setKeyword('saas marketing'); handleSearch(undefined, 'saas marketing'); }} className="hover:text-foreground transition-colors">saas marketing</button>
                            <span className="w-1 h-1 rounded-full bg-border"></span>
                            <button type="button" onMouseDown={(e) => { e.preventDefault(); setKeyword('seo tools'); handleSearch(undefined, 'seo tools'); }} className="hover:text-foreground transition-colors">seo tools</button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </form>
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
                      <span className="hidden md:inline text-xl">Keywords<span className="text-accent">Intel</span></span>
                    </motion.div>
                  </div>
                  
                  <form onSubmit={(e) => handleSearch(e, undefined, false)} className="flex-1 max-w-2xl relative group hidden md:flex items-center ml-4 bg-muted/30 hover:bg-muted/60 focus-within:bg-muted/60 border border-border rounded-xl transition-all shadow-sm">
                    <Search className="w-4 h-4 text-muted-foreground ml-3 flex-shrink-0" />
                    <input
                      type="text"
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder="Search keywords..."
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
                        onClick={() => setActiveTab('user-profile')}
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
                      <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
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
