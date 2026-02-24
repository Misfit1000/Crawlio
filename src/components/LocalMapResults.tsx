import { useState, useEffect, memo } from 'react';
import { motion } from 'motion/react';
import { Map as MapIcon, MapPin, Loader2, Navigation } from 'lucide-react';
import { isRateLimitError } from '../services/geminiClient';
import { fetchLocalMapData } from '../services/keywordService';

interface LocalResult {
  title: string;
  uri: string;
}

export default memo(function LocalMapResults({ keyword, location, latLng }: { keyword: string, location?: string, latLng?: {latitude: number, longitude: number} | null }) {
  const [results, setResults] = useState<LocalResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    const loadMapData = async () => {
      try {
        const uniqueResults = await fetchLocalMapData(keyword, location, latLng);

        if (!isMounted) return;

        setResults(uniqueResults);
        setLoading(false);
      } catch (err) {
        if (isMounted) {
          console.error("Map data error:", err);
          if (isRateLimitError(err)) {
            setError("Rate limit exceeded for map results.");
          } else {
            setError("Failed to load local map results.");
          }
          setLoading(false);
        }
      }
    };

    loadMapData();

    return () => { isMounted = false; };
  }, [keyword, location, latLng]);

  if (loading) {
    return (
      <div className="bg-card/50 backdrop-blur-xl border border-border rounded-3xl p-6 flex flex-col items-center justify-center min-h-[200px] shadow-sm">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
        <p className="text-slate-500 dark:text-slate-400 text-sm">Finding local map results...</p>
      </div>
    );
  }

  if (error || results.length === 0) {
    return null; // Hide if no results or error
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="bg-card/50 backdrop-blur-xl border border-border rounded-3xl p-6 shadow-sm"
    >
      <div className="flex flex-col mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500">
            <MapIcon className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold text-foreground">Local Map Results</h3>
          {location && (
            <span className="text-sm text-slate-500 dark:text-slate-400 ml-auto flex items-center gap-1">
              <MapPin className="w-4 h-4" /> {location}
            </span>
          )}
        </div>
        <p className="text-slate-500 text-xs mt-2">Nearby businesses and locations relevant to this search term.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {results.slice(0, 6).map((result, i) => (
          <motion.a
            key={i}
            href={result.uri}
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ y: -5, scale: 1.02 }}
            className="flex flex-col p-4 rounded-2xl bg-slate-100 dark:bg-white/[0.02] border border-border hover:bg-slate-200 dark:hover:bg-white/[0.04] hover:border-blue-500/30 transition-all group"
          >
            <h4 className="text-foreground font-medium mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2">
              {result.title}
            </h4>
            <div className="mt-auto flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-2">
              <span className="flex items-center gap-1 text-blue-600/80 dark:text-blue-400/80 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                <Navigation className="w-3 h-3" /> View on Maps
              </span>
            </div>
          </motion.a>
        ))}
      </div>
    </motion.div>
  );
});
