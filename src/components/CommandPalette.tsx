import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Command, X, TrendingUp, History, Sparkles } from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (keyword: string) => void;
}

const RECENT_SEARCHES = ['digital marketing', 'seo tools', 'react framework', 'tailwind css'];
const SUGGESTED = ['keyword research', 'competitor analysis', 'backlink checker'];

export default function CommandPalette({ isOpen, onClose, onSearch }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[100]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            className="fixed top-[15%] left-1/2 -translate-x-1/2 w-full max-w-2xl bg-slate-900 dark:bg-slate-900 light:bg-white border border-white/10 dark:border-white/10 light:border-slate-200 rounded-2xl shadow-2xl z-[101] overflow-hidden"
          >
            <div className="p-4 border-b border-white/10 dark:border-white/10 light:border-slate-200 flex items-center gap-3">
              <Search className="w-5 h-5 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search keywords, tools, or documentation..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && query && handleSearch(query)}
                className="flex-1 bg-transparent border-none outline-none text-white dark:text-white light:text-slate-900 placeholder:text-slate-500 text-lg"
              />
              <div className="flex items-center gap-1 px-2 py-1 bg-slate-800 dark:bg-slate-800 light:bg-slate-100 rounded text-[10px] font-mono text-slate-400">
                <Command className="w-3 h-3" />
                <span>K</span>
              </div>
              <button onClick={onClose} className="p-1 hover:bg-white/5 dark:hover:bg-white/5 light:hover:bg-slate-100 rounded-lg transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="p-2 max-h-[400px] overflow-y-auto">
              {query.length === 0 ? (
                <div className="space-y-4 p-2">
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-2">Recent Searches</h4>
                    <div className="space-y-1">
                      {RECENT_SEARCHES.map((s) => (
                        <button
                          key={s}
                          onClick={() => handleSearch(s)}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 dark:hover:bg-white/5 light:hover:bg-slate-50 text-slate-300 dark:text-slate-300 light:text-slate-600 group transition-colors"
                        >
                          <History className="w-4 h-4 text-slate-500 group-hover:text-blue-400" />
                          <span className="text-sm">{s}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-2">Suggested</h4>
                    <div className="space-y-1">
                      {SUGGESTED.map((s) => (
                        <button
                          key={s}
                          onClick={() => handleSearch(s)}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 dark:hover:bg-white/5 light:hover:bg-slate-50 text-slate-300 dark:text-slate-300 light:text-slate-600 group transition-colors"
                        >
                          <TrendingUp className="w-4 h-4 text-slate-500 group-hover:text-emerald-400" />
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
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 group transition-colors"
                  >
                    <Sparkles className="w-5 h-5" />
                    <div className="text-left">
                      <div className="font-medium">Analyze "{query}"</div>
                      <div className="text-xs text-blue-400/60">Run full keyword analysis with AI insights</div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            <div className="p-3 bg-slate-950/50 dark:bg-slate-950/50 light:bg-slate-50 border-t border-white/5 dark:border-white/5 light:border-slate-200 flex items-center justify-between text-[10px] text-slate-500">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1"><kbd className="px-1 bg-slate-800 dark:bg-slate-800 light:bg-slate-200 rounded">↵</kbd> to select</span>
                <span className="flex items-center gap-1"><kbd className="px-1 bg-slate-800 dark:bg-slate-800 light:bg-slate-200 rounded">↑↓</kbd> to navigate</span>
              </div>
              <span>Press <kbd className="px-1 bg-slate-800 dark:bg-slate-800 light:bg-slate-200 rounded">ESC</kbd> to close</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
