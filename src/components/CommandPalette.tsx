import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Command, X, TrendingUp, History, Sparkles } from 'lucide-react';

interface CommandPaletteProps {
 isOpen: boolean;
 onClose: () => void;
 onSearch: (keyword: string) => void;
}

const SUGGESTED = ['keyword research', 'competitor analysis', 'backlink checker'];

export default function CommandPalette({ isOpen, onClose, onSearch }: CommandPaletteProps) {
 const [query, setQuery] = useState('');
 const [recentSearches, setRecentSearches] = useState<string[]>([]);
 const inputRef = useRef<HTMLInputElement>(null);

 useEffect(() => {
 const loadRecent = () => {
 try {
 const stored = localStorage.getItem('recentSearches');
 if (stored) {
 setRecentSearches(JSON.parse(stored));
 }
 } catch (e) {
 // ignore
 }
 };
 
 loadRecent();
 window.addEventListener('recentSearchesUpdated', loadRecent);
 return () => window.removeEventListener('recentSearchesUpdated', loadRecent);
 }, []);

 useEffect(() => {
 if (isOpen) {
 inputRef.current?.focus();
 setQuery('');
 }
 }, [isOpen]);

 useEffect(() => {
 const handleKeyDown = (e: KeyboardEvent) => {
 if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
 e.preventDefault();
 // This is handled by the parent, but good to have here too
 }
 if (e.key === 'Escape') {
 onClose();
 }
 };
 window.addEventListener('keydown', handleKeyDown);
 return () => window.removeEventListener('keydown', handleKeyDown);
 }, [onClose]);

 const handleSearch = (keyword: string) => {
 onSearch(keyword);
 onClose();
 };

 return (
 <AnimatePresence>
 {isOpen && (
 <>
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 onClick={onClose}
 className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[100]"
 />
 <motion.div
 initial={{ opacity: 0, scale: 0.95, y: -20 }}
 animate={{ opacity: 1, scale: 1, y: 0 }}
 exit={{ opacity: 0, scale: 0.95, y: -20 }}
 className="fixed top-[15%] left-1/2 -translate-x-1/2 w-full max-w-2xl bg-card border border-border rounded-3xl shadow-2xl z-[101] overflow-hidden"
 >
 <div className="p-4 border-b border-border flex items-center gap-3">
 <Search className="w-5 h-5 text-muted-foreground"/>
 <input
 ref={inputRef}
 type="text"
 placeholder="Search keywords, tools, or documentation..."
 value={query}
 onChange={(e) => setQuery(e.target.value)}
 onKeyDown={(e) => e.key === 'Enter' && query && handleSearch(query)}
 className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground text-lg"
 />
 <div className="flex items-center gap-1 px-2 py-1 bg-muted rounded text-[10px] text-muted-foreground">
 <Command className="w-3 h-3"/>
 <span>K</span>
 </div>
 <button onClick={onClose} className="p-1 hover:bg-muted rounded-lg transition-colors">
 <X className="w-5 h-5 text-muted-foreground"/>
 </button>
 </div>

 <div className="p-2 max-h-[400px] overflow-y-auto">
 {query.length === 0 ? (
 <div className="space-y-4 p-2">
 {recentSearches.length > 0 && (
 <div>
 <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 px-2">Recent Searches</h4>
 <div className="space-y-1">
 {recentSearches.map((s) => (
 <button
 key={s}
 onClick={() => handleSearch(s)}
 className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted text-foreground group transition-colors"
 >
 <History className="w-4 h-4 text-muted-foreground group-hover:text-accent"/>
 <span className="text-sm">{s}</span>
 </button>
 ))}
 </div>
 </div>
 )}
 <div>
 <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 px-2">Suggested</h4>
 <div className="space-y-1">
 {SUGGESTED.map((s) => (
 <button
 key={s}
 onClick={() => handleSearch(s)}
 className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted text-foreground group transition-colors"
 >
 <TrendingUp className="w-4 h-4 text-muted-foreground group-hover:text-emerald-500"/>
 <span className="text-sm">{s}</span>
 </button>
 ))}
 </div>
 </div>
 </div>
 ) : (
 <div className="p-2">
 <button
 onClick={() => handleSearch(query)}
 className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-accent/10 border border-accent/20 text-accent group transition-colors"
 >
 <Sparkles className="w-5 h-5"/>
 <div className="text-left">
 <div className="font-medium">Analyze "{query}"</div>
 <div className="text-xs text-accent/60">Run full SEO analysis</div>
 </div>
 </button>
 </div>
 )}
 </div>

 <div className="p-3 bg-muted/50 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground">
 <div className="flex items-center gap-4">
 <span className="flex items-center gap-1"><kbd className="px-1 bg-muted rounded border border-border">↵</kbd> to select</span>
 <span className="flex items-center gap-1"><kbd className="px-1 bg-muted rounded border border-border">↑↓</kbd> to navigate</span>
 </div>
 <span>Press <kbd className="px-1 bg-muted rounded border border-border">ESC</kbd> to close</span>
 </div>
 </motion.div>
 </>
 )}
 </AnimatePresence>
 );
}
