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
 <div className="bg-card border border-border rounded-3xl p-6 flex flex-col items-center justify-center min-h-[200px] shadow-2xl relative overflow-hidden">
 <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 blur-[100px] rounded-full pointer-events-none"></div>
 <Loader2 className="w-8 h-8 text-accent animate-spin mb-4 relative z-10"/>
 <p className="text-muted-foreground text-sm relative z-10">Finding local map results...</p>
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
 className="bg-card border border-border rounded-3xl p-6 shadow-2xl relative overflow-hidden group"
 >
 <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 blur-[100px] rounded-full pointer-events-none"></div>
 <div className="flex flex-col mb-6 relative z-10">
 <div className="flex items-center gap-3">
 <div className="p-2 bg-accent/10 rounded-lg text-accent">
 <MapIcon className="w-6 h-6"/>
 </div>
 <h3 className="text-2xl font-bold text-foreground">Local Map Results</h3>
 {location && (
 <span className="text-sm text-accent bg-accent/10 px-3 py-1 rounded-full border border-accent/20 ml-auto flex items-center gap-1">
 <MapPin className="w-4 h-4"/> {location}
 </span>
 )}
 </div>
 <p className="text-muted-foreground text-sm mt-2">Nearby businesses and locations relevant to this search term.</p>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 relative z-10">
 {results.slice(0, 6).map((result, i) => (
 <motion.a
 key={i}
 href={result.uri}
 target="_blank"
 rel="noopener noreferrer"
 whileHover={{ y: -5, scale: 1.02 }}
 className="flex flex-col p-4 rounded-2xl bg-card border border-border hover:bg-muted hover:border-accent/30 transition-all group"
 >
 <h4 className="text-foreground font-bold mb-2 group-hover:text-accent transition-colors line-clamp-2">
 {result.title}
 </h4>
 <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground pt-2">
 <span className="flex items-center gap-1 text-accent/80 group-hover:text-accent">
 <Navigation className="w-3 h-3"/> View on Maps
 </span>
 </div>
 </motion.a>
 ))}
 </div>
 </motion.div>
 );
});
