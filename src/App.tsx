import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Activity, LogOut, User, MapPin, Sun, Moon, Command } from 'lucide-react';
import Dashboard from './components/Dashboard';
import Login from './components/Login';
import Register from './components/Register';
import Sidebar from './components/Sidebar';
import CountrySelect from './components/CountrySelect';
import CommandPalette from './components/CommandPalette';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './contexts/ThemeContext';

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
  const { user, loading: authLoading, logout } = useAuth();
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

  if (!user) {
    return authMode === 'login' ? (
      <Login onToggle={() => setAuthMode('register')} />
    ) : (
      <Register onToggle={() => setAuthMode('login')} />
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans overflow-x-hidden selection:bg-blue-500/30 transition-colors duration-300">
      {/* Background Glow */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 dark:bg-blue-600/20 light:bg-blue-400/10 blur-[120px] rounded-full mix-blend-screen dark:mix-blend-screen light:mix-blend-multiply" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-600/20 dark:bg-indigo-600/20 light:bg-indigo-400/10 blur-[120px] rounded-full mix-blend-screen dark:mix-blend-screen light:mix-blend-multiply" />
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
                  className="p-2 rounded-full bg-slate-900/50 dark:bg-slate-900/50 light:bg-white border border-white/5 dark:border-white/5 light:border-slate-200 text-slate-400 hover:text-white dark:hover:text-white light:hover:text-blue-600 transition-colors"
                  title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                >
                  {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
                <div className="flex items-center gap-2 text-slate-300 dark:text-slate-300 light:text-slate-600 bg-slate-900/50 dark:bg-slate-900/50 light:bg-white backdrop-blur-md border border-white/5 dark:border-white/5 light:border-slate-200 px-4 py-2 rounded-full cursor-pointer hover:bg-slate-800/50 transition-colors">
                  <User className="w-4 h-4" />
                  <span className="text-sm font-medium">{user?.username || 'Pro Account'}</span>
                </div>
                <button onClick={handleLogout} className="text-slate-400 hover:text-white dark:hover:text-white light:hover:text-red-500 transition-colors p-2 rounded-full hover:bg-white/5" title="Sign out">
                  <LogOut className="w-5 h-5" />
                </button>
              </div>

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.8, ease: "easeOut" }}
                className="text-center mb-12"
              >
                <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-4 bg-gradient-to-br from-white via-blue-100 to-blue-500 dark:from-white dark:via-blue-100 dark:to-blue-500 light:from-slate-900 light:via-slate-800 light:to-blue-600 bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(59,130,246,0.5)]">
                  Keyword Intelligence
                </h1>
                <p className="text-slate-400 dark:text-slate-400 light:text-slate-500 text-lg md:text-xl max-w-2xl mx-auto font-light">
                  Uncover real-time search volumes, trends, and difficulty in a seamless, unified interface.
                </p>
              </motion.div>

              <form onSubmit={handleSearch} className="w-full max-w-3xl relative group">
                <motion.div layoutId="search-container" className="relative flex items-center bg-slate-900/80 dark:bg-slate-900/80 light:bg-white backdrop-blur-xl border border-white/10 dark:border-white/10 light:border-slate-200 rounded-2xl p-2 shadow-2xl z-20">
                  <Search className="w-6 h-6 text-blue-400 ml-4" />
                  <input
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="Enter a keyword (e.g., artificial intelligence)..."
                    className="w-full bg-transparent border-none outline-none text-xl text-white dark:text-white light:text-slate-900 px-4 py-4 placeholder:text-slate-500 font-light"
                    autoFocus
                  />
                  <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-slate-800 dark:bg-slate-800 light:bg-slate-100 rounded-lg text-[10px] font-mono text-slate-500 border border-white/5 dark:border-white/5 light:border-slate-200">
                    <Command className="w-3 h-3" />
                    <span>K</span>
                  </div>
                  <div className="h-8 w-px bg-white/10 dark:bg-white/10 light:bg-slate-200 mx-2 hidden md:block"></div>
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
                    className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-medium transition-colors duration-200 shadow-[0_0_20px_rgba(37,99,235,0.4)] ml-2"
                  >
                    Analyze
                  </button>
                </motion.div>
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200 z-10" />
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
                  <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 }}
                    className="flex items-center gap-2 text-blue-400 font-bold text-xl tracking-tight cursor-pointer" 
                    onClick={() => setIsSearching(false)}
                  >
                    <Activity className="w-6 h-6" />
                    <span className="hidden md:inline">KeywordIntel</span>
                  </motion.div>
                  
                  <form onSubmit={handleSearch} className="flex-1 max-w-3xl relative group">
                    <motion.div layoutId="search-container" className="relative flex items-center bg-slate-900/80 dark:bg-slate-900/80 light:bg-white backdrop-blur-md border border-white/10 dark:border-white/10 light:border-slate-200 rounded-xl p-1 z-20">
                      <Search className="w-5 h-5 text-blue-400 ml-3" />
                      <input
                        type="text"
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        className="w-full bg-transparent border-none outline-none text-white dark:text-white light:text-slate-900 px-3 py-2 placeholder:text-slate-500"
                        onFocus={() => setIsCommandPaletteOpen(true)}
                        readOnly
                      />
                      <div className="hidden sm:flex items-center gap-1 px-2 py-1 bg-slate-800 dark:bg-slate-800 light:bg-slate-100 rounded text-[10px] font-mono text-slate-500">
                        <Command className="w-3 h-3" />
                        <span>K</span>
                      </div>
                      <div className="h-6 w-px bg-white/10 dark:bg-white/10 light:bg-slate-200 mx-2 hidden sm:block"></div>
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
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl blur opacity-20 group-hover:opacity-40 transition duration-500 z-10" />
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
                    className="p-2 rounded-full bg-slate-900/50 dark:bg-slate-900/50 light:bg-white border border-white/5 dark:border-white/5 light:border-slate-200 text-slate-400 hover:text-white dark:hover:text-white light:hover:text-blue-600 transition-colors"
                    title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                  >
                    {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                  </button>
                  <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-medium">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    Live Data
                  </div>
                  <div className="h-6 w-px bg-white/10 dark:bg-white/10 light:bg-slate-200 hidden md:block"></div>
                  <div className="hidden md:flex items-center gap-2 text-slate-300 dark:text-slate-300 light:text-slate-600 bg-slate-900/50 dark:bg-slate-900/50 light:bg-white backdrop-blur-md border border-white/5 dark:border-white/5 light:border-slate-200 px-3 py-1.5 rounded-full">
                    <User className="w-4 h-4" />
                    <span className="text-xs font-medium truncate max-w-[100px]">{user?.username || 'Pro Account'}</span>
                  </div>
                  <button onClick={handleLogout} className="text-slate-400 hover:text-white dark:hover:text-white light:hover:text-red-500 transition-colors p-2 rounded-full hover:bg-white/5" title="Sign out">
                    <LogOut className="w-5 h-5" />
                  </button>
                </motion.div>
              </header>

              <div className="flex flex-1">
                <Sidebar />
                <main className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full">
                  <Dashboard 
                    keyword={searchedKeyword} 
                    location={searchedLocation.startsWith('CURRENT_LOCATION') ? (searchedLocation.split(':')[1] || 'Current Location') : LOCATIONS.find(l => l.code === searchedLocation)?.name} 
                    latLng={searchedLatLng}
                    onLocationChange={(newLocationCode) => {
                      setLocation(newLocationCode);
                      setSearchedLocation(newLocationCode);
                      setSearchedLatLng(null);
                    }}
                  />
                </main>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
