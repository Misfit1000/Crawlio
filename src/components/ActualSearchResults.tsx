import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ExternalLink, Search, Loader2, Globe } from 'lucide-react';
import { fetchActualSearchResults } from '../services/keywordService';

export default function ActualSearchResults({ keyword, location }: { keyword: string; location?: string }) {
 const [results, setResults] = useState<{ title: string; uri: string; snippet: string }[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 let isMounted = true;
 setLoading(true);
 fetchActualSearchResults(keyword, location).then((data) => {
 if (isMounted) {
 setResults(data);
 setLoading(false);
 }
 });
 return () => {
 isMounted = false;
 };
 }, [keyword, location]);

 return (
 <motion.div
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.6, delay: 0.8 }}
 className="bg-card border border-border rounded-3xl overflow-hidden relative shadow-2xl mt-8 group"
 >
 {loading && (
 <div className="absolute inset-0 z-50 bg-background/50 backdrop-blur-sm flex items-center justify-center">
 <Loader2 className="w-8 h-8 text-accent animate-spin"/>
 </div>
 )}
 <div className="p-6 border-b border-border flex flex-col gap-4 relative">
 <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 blur-[100px] rounded-full pointer-events-none"></div>
 <div className="flex justify-between items-center mb-1 relative z-10">
 <h3 className="text-2xl font-bold text-foreground flex items-center gap-2">
 <Globe className="w-6 h-6 text-accent"/>
 Live Search Results
 </h3>
 <div className="text-sm text-accent bg-accent/10 px-3 py-1 rounded-full border border-accent/20">Powered by Google Search</div>
 </div>
 <p className="text-muted-foreground text-sm relative z-10">Actual top ranking pages for this keyword right now.</p>
 </div>
 
 <div className="p-6">
 {results.length > 0 ? (
 <div className="space-y-6">
 {results.map((result, index) => (
 <motion.div 
 key={index}
 initial={{ opacity: 0, x: -20 }}
 animate={{ opacity: 1, x: 0 }}
 transition={{ delay: 0.2 + index * 0.05 }}
 className="group"
 >
 <div className="flex items-start gap-4">
 <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-sm font-bold text-accent border border-accent/20 flex-shrink-0 mt-1">
 {index + 1}
 </div>
 <div className="flex-1 min-w-0">
 <div className="text-xs text-muted-foreground truncate mb-1"title={result.uri}>
 {result.uri}
 </div>
 <a 
 href={result.uri} 
 target="_blank"
 rel="noopener noreferrer"
 className="text-lg font-bold text-accent hover:text-accent/80 hover:underline flex items-center gap-1.5 mb-1.5 transition-colors"
 title={result.title}
 >
 {result.title}
 <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"/>
 </a>
 <p className="text-sm text-foreground/80 leading-relaxed line-clamp-2">
 {result.snippet ||"No snippet available for this result."}
 </p>
 </div>
 </div>
 </motion.div>
 ))}
 </div>
 ) : !loading ? (
 <div className="text-center py-12 text-muted-foreground">
 <Search className="w-12 h-12 mx-auto mb-4 opacity-20"/>
 <p>No live search results could be retrieved.</p>
 </div>
 ) : null}
 </div>
 </motion.div>
 );
}
