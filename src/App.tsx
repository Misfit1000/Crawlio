import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Activity, LogOut, User, MapPin, Sun, Moon, Command, Menu, Mail } from 'lucide-react';
import Dashboard from './components/Dashboard';
import KeywordMagicTool from './components/KeywordMagicTool';
import PositionTracking from './components/PositionTracking';
import BacklinkAnalytics from './components/BacklinkAnalytics';
import Login from './components/Login';
import Register from './components/Register';
import Sidebar from './components/Sidebar';
import CountrySelect from './components/CountrySelect';
import CommandPalette from './components/CommandPalette';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './contexts/ThemeContext';

export type TabType = 'dashboard' | 'keyword-magic' | 'position-tracking' | 'backlink-analytics';

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
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [isSearching, setIsSearching] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [searchedKeyword, setSearchedKeyword] = useState('');
  const [location, setLocation] = useState('US');
  const [searchedLocation, setSearchedLocation] = useState('US');
  const [userLatLng, setUserLatLng] = useState<{latitude: number, longitude: number} | null>(null);
  const [searchedLatLng, setSearchedLatLng] = useState<{latitude: number, longitude: number} | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

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

  const handleSearch = (e?: React.FormEvent, manualKeyword?: string) => {
    if (e) e.preventDefault();
    const searchVal = manualKeyword || keyword;
    if (searchVal.trim()) {
      setKeyword(searchVal);
      setSearchedKeyword(searchVal);
      setSearchedLocation(location);
      setSearchedLatLng(location.startsWith('CURRENT_LOCATION') ? userLatLng : null);
      setIsSearching(true);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setIsSearching(false);
      setKeyword('');
      setSearchedKeyword('');
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

  if (!user) {
    return authMode === 'login' ? (
      <Login onToggle={() => setAuthMode('register')} />
    ) : (
      <Register onToggle={() => setAuthMode('login')} />
    );
  }

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
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans overflow-x-hidden selection:bg-accent/30 transition-colors duration-300">
      {/* Background Glow */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-accent/10 blur-[120px] rounded-full mix-blend-screen dark:mix-blend-screen" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-600/10 blur-[120px] rounded-full mix-blend-screen dark:mix-blend-screen" />
      </div>

      <CommandPalette 
        isOpen={isCommandPaletteOpen} 
        onClose={() => setIsCommandPaletteOpen(false)} 
        onSearch={(k) => handleSearch(undefined, k)} 
      />

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
                <div className="flex items-center gap-2 text-foreground bg-card/50 backdrop-blur-md border border-border px-4 py-2 rounded-full cursor-pointer hover:bg-muted/50 transition-colors">
                  <User className="w-4 h-4" />
                  <span className="text-sm font-medium">{user?.username || 'Pro Account'}</span>
                </div>
                <button onClick={handleLogout} className="text-muted-foreground hover:text-red-500 transition-colors p-2 rounded-full hover:bg-muted/50" title="Sign out">
                  <LogOut className="w-5 h-5" />
                </button>
              </div>

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.8, ease: "easeOut" }}
                className="text-center mb-12"
              >
                <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-4 bg-gradient-to-br from-foreground via-foreground/80 to-foreground/50 bg-clip-text text-transparent">
                  Keyword Intelligence
                </h1>
                <p className="text-muted-foreground text-lg md:text-xl max-w-2xl mx-auto font-light">
                  Uncover real-time search volumes, trends, and difficulty in a seamless, unified interface.
                </p>
              </motion.div>

              <form onSubmit={handleSearch} className="w-full max-w-3xl relative group">
                <motion.div layoutId="search-container" className="relative flex items-center bg-card/80 backdrop-blur-xl border border-border rounded-2xl p-2 shadow-sm z-20">
                  <Search className="w-6 h-6 text-muted-foreground ml-4" />
                  <input
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="Enter a keyword (e.g., artificial intelligence)..."
                    className="w-full bg-transparent border-none outline-none text-xl text-foreground px-4 py-4 placeholder:text-muted-foreground font-light"
                    autoFocus
                  />
                  <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-muted rounded-lg text-[10px] font-mono text-muted-foreground border border-border">
                    <Command className="w-3 h-3" />
                    <span>K</span>
                  </div>
                  <div className="h-8 w-px bg-border mx-2 hidden md:block"></div>
                  <div className="hidden md:flex items-center px-4 border-l border-transparent">
                    <CountrySelect 
                      locations={LOCATIONS}
                      value={location}
                      onChange={setLocation}
                      onGetLocation={handleGetLocation}
                      isLocating={isLocating}
                    />
                  </div>
                  <button
                    type="submit"
                    className="bg-foreground text-background hover:bg-foreground/90 px-8 py-3 rounded-xl font-medium transition-colors duration-200 ml-2"
                  >
                    Analyze
                  </button>
                </motion.div>
                
                {/* Search suggestions/recent could go here */}
                <div className="absolute top-full left-0 w-full pt-4 opacity-0 group-focus-within:opacity-100 transition-opacity duration-300 pointer-events-none group-focus-within:pointer-events-auto z-10">
                  <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1"><Activity className="w-4 h-4" /> Trending:</span>
                    <button type="button" onClick={() => setKeyword('machine learning')} className="hover:text-foreground transition-colors">machine learning</button>
                    <span className="w-1 h-1 rounded-full bg-border"></span>
                    <button type="button" onClick={() => setKeyword('saas marketing')} className="hover:text-foreground transition-colors">saas marketing</button>
                    <span className="w-1 h-1 rounded-full bg-border"></span>
                    <button type="button" onClick={() => setKeyword('seo tools')} className="hover:text-foreground transition-colors">seo tools</button>
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
              <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border py-4 px-6 md:px-8 flex items-center justify-between transition-colors duration-300">
                <div className="flex items-center gap-6 flex-1">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                      className="p-2 -ml-2 rounded-full hover:bg-muted/50 text-muted-foreground transition-colors"
                    >
                      <Menu className="w-5 h-5" />
                    </button>
                    <motion.div 
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.2 }}
                      className="flex items-center gap-2 text-accent font-bold text-xl tracking-tight cursor-pointer" 
                      onClick={() => setIsSearching(false)}
                    >
                      <Activity className="w-6 h-6" />
                      <span className="hidden md:inline">KeywordIntel</span>
                    </motion.div>
                  </div>
                  
                  <form onSubmit={handleSearch} className="flex-1 max-w-3xl relative group">
                    <motion.div layoutId="search-container" className="relative flex items-center bg-card/80 backdrop-blur-md border border-border rounded-xl p-1 z-20">
                      <Search className="w-5 h-5 text-accent ml-3" />
                      <input
                        type="text"
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        className="w-full bg-transparent border-none outline-none text-foreground px-3 py-2 placeholder:text-muted-foreground"
                        onFocus={() => setIsCommandPaletteOpen(true)}
                        readOnly
                      />
                      <div className="hidden sm:flex items-center gap-1 px-2 py-1 bg-muted rounded text-[10px] font-mono text-muted-foreground">
                        <Command className="w-3 h-3" />
                        <span>K</span>
                      </div>
                      <div className="h-6 w-px bg-border mx-2 hidden sm:block"></div>
                      <div className="hidden sm:flex items-center px-2">
                        <CountrySelect 
                          locations={LOCATIONS}
                          value={location}
                          onChange={setLocation}
                          onGetLocation={handleGetLocation}
                          isLocating={isLocating}
                          compact
                        />
                      </div>
                      <button type="submit" className="hidden"></button>
                    </motion.div>
                  </form>
                </div>
                
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                  className="flex items-center gap-4 ml-6"
                >
                  <button 
                    onClick={toggleTheme}
                    className="p-2 rounded-full bg-card/50 border border-border text-muted-foreground hover:text-foreground transition-colors"
                    title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                  >
                    {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                  </button>
                  <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    Live Data
                  </div>
                  <div className="h-6 w-px bg-border hidden md:block"></div>
                  <div className="hidden md:flex items-center gap-2 text-foreground bg-card/50 backdrop-blur-md border border-border px-3 py-1.5 rounded-full">
                    <User className="w-4 h-4" />
                    <span className="text-xs font-medium truncate max-w-[100px]">{user?.username || 'Pro Account'}</span>
                  </div>
                  <button onClick={handleLogout} className="text-muted-foreground hover:text-red-500 transition-colors p-2 rounded-full hover:bg-muted/50" title="Sign out">
                    <LogOut className="w-5 h-5" />
                  </button>
                </motion.div>
              </header>

              <div className="flex flex-1 relative">
                <Sidebar 
                  isOpen={isSidebarOpen} 
                  onClose={() => setIsSidebarOpen(false)} 
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                />
                <main className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full">
                  {renderContent()}
                </main>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
