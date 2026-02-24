import { useState, useEffect, memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUpDown, ArrowUp, ArrowDown, Download, Search, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { KeywordData } from '../services/keywordService';

import { useTheme } from '../contexts/ThemeContext';

type SortConfig = {
  key: keyof KeywordData['relatedKeywords'][0];
  direction: 'asc' | 'desc';
} | null;

const SparklineTooltip = memo(({ active, payload }: any) => {
  const { theme } = useTheme();
  if (active && payload && payload.length) {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border border-slate-200 dark:border-white/10 px-2 py-1 rounded shadow-xl text-xs"
      >
        <span className="text-blue-600 dark:text-blue-400 font-bold">{payload[0].value.toLocaleString()}</span>
      </motion.div>
    );
  }
  return null;
});

export default memo(function KeywordTable({ data, loading }: { data: KeywordData['relatedKeywords'], loading?: boolean }) {
  const { theme } = useTheme();
  const [tableData, setTableData] = useState(data);
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [intentFilter, setIntentFilter] = useState<string>('All');
  const [minVolume, setMinVolume] = useState<string>('');
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    let filteredData = data;
    
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      filteredData = filteredData.filter(item => 
        item.keyword.toLowerCase().includes(lowerQuery) ||
        item.intent.toLowerCase().includes(lowerQuery)
      );
    }

    if (intentFilter !== 'All') {
      filteredData = filteredData.filter(item => item.intent === intentFilter);
    }

    if (minVolume && !isNaN(Number(minVolume))) {
      filteredData = filteredData.filter(item => item.volume >= Number(minVolume));
    }

    if (sortConfig) {
      filteredData = [...filteredData].sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
        if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    setTableData(filteredData);
    setCurrentPage(1); // Reset to first page on filter/sort change
  }, [data, searchQuery, sortConfig, intentFilter, minVolume]);

  const totalPages = Math.ceil(tableData.length / itemsPerPage);
  const paginatedData = tableData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (key: keyof KeywordData['relatedKeywords'][0]) => {
    let direction: 'asc' | 'desc' = 'desc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const handleExport = () => {
    const headers = ['Keyword', 'Intent', 'Volume', 'KD %', 'CPC'];
    const csvContent = [
      headers.join(','),
      ...tableData.map(row => 
        `"${row.keyword}",${row.intent},${row.volume},${row.kd},${row.cpc}`
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'keyword_data.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getIntentColor = (intent: string) => {
    switch (intent) {
      case 'Info': return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20';
      case 'Nav': return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
      case 'Com': return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
      case 'Tx': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
      default: return 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20';
    }
  };

  const getKdColor = (kd: number) => {
    if (kd > 70) return 'text-orange-600 dark:text-orange-400';
    if (kd > 40) return 'text-amber-600 dark:text-amber-400';
    return 'text-emerald-600 dark:text-emerald-400';
  };

  const SortIcon = ({ columnKey }: { columnKey: keyof KeywordData['relatedKeywords'][0] }) => {
    if (sortConfig?.key !== columnKey) return <ArrowUpDown className="w-3 h-3 text-slate-600 ml-1" />;
    return sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-400 ml-1" /> : <ArrowDown className="w-3 h-3 text-blue-400 ml-1" />;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.8 }}
      className="bg-card/50 backdrop-blur-xl border border-border rounded-3xl overflow-hidden relative shadow-sm"
    >
      {loading && (
        <div className="absolute inset-0 z-50 bg-background/50 backdrop-blur-sm flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      )}
      <div className="p-6 border-b border-border flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-bold text-foreground whitespace-nowrap">Keyword Magic</h3>
              <div className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">{tableData.length} keywords found</div>
            </div>
            <p className="text-slate-500 text-xs">Explore related terms, variations, and semantic keywords.</p>
          </div>
          
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Filter keywords..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-100 dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl py-2 pl-9 pr-4 text-sm text-slate-900 dark:text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
              />
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-white rounded-xl text-sm font-medium transition-colors border border-slate-200 dark:border-white/5 whitespace-nowrap shadow-sm"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </motion.button>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-4 pt-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 dark:text-slate-400 font-medium">Intent:</label>
            <select 
              value={intentFilter} 
              onChange={(e) => setIntentFilter(e.target.value)}
              className="bg-slate-100 dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-lg py-1.5 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="All">All Intents</option>
              <option value="Info">Informational</option>
              <option value="Nav">Navigational</option>
              <option value="Com">Commercial</option>
              <option value="Tx">Transactional</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 dark:text-slate-400 font-medium">Min Volume:</label>
            <input 
              type="number" 
              value={minVolume}
              onChange={(e) => setMinVolume(e.target.value)}
              placeholder="e.g. 1000"
              className="bg-slate-100 dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-lg py-1.5 px-3 w-28 text-sm text-slate-900 dark:text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-slate-500 dark:text-slate-400">
              <th className="p-4 font-medium cursor-pointer hover:text-foreground transition-colors" onClick={() => handleSort('keyword')}>
                <div className="flex items-center">Keyword <SortIcon columnKey="keyword" /></div>
              </th>
              <th className="p-4 font-medium cursor-pointer hover:text-foreground transition-colors" onClick={() => handleSort('intent')}>
                <div className="flex items-center">Intent <SortIcon columnKey="intent" /></div>
              </th>
              <th className="p-4 font-medium cursor-pointer hover:text-foreground transition-colors text-right" onClick={() => handleSort('volume')}>
                <div className="flex items-center justify-end">Volume <SortIcon columnKey="volume" /></div>
              </th>
              <th className="p-4 font-medium text-right">
                <div className="flex items-center justify-end">Trend</div>
              </th>
              <th className="p-4 font-medium cursor-pointer hover:text-foreground transition-colors text-right" onClick={() => handleSort('kd')}>
                <div className="flex items-center justify-end">KD % <SortIcon columnKey="kd" /></div>
              </th>
              <th className="p-4 font-medium cursor-pointer hover:text-foreground transition-colors text-right" onClick={() => handleSort('cpc')}>
                <div className="flex items-center justify-end">CPC <SortIcon columnKey="cpc" /></div>
              </th>
            </tr>
          </thead>
          <tbody className="relative">
            <AnimatePresence mode="popLayout">
              {paginatedData.map((row) => (
                <motion.tr
                  key={row.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ 
                    layout: { type: "spring", stiffness: 300, damping: 30 },
                    opacity: { duration: 0.2 }
                  }}
                  className="border-b border-border hover:bg-slate-100 dark:hover:bg-white/[0.02] transition-colors group"
                >
                  <td className="p-4 text-foreground font-medium group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {row.keyword}
                  </td>
                  <td className="p-4">
                    <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${getIntentColor(row.intent)}`}>
                      {row.intent}
                    </span>
                  </td>
                  <td className="p-4 text-right text-slate-600 dark:text-slate-300 font-mono">
                    {row.volume.toLocaleString()}
                  </td>
                  <td className="p-4 w-32">
                    <div className="h-8 w-full">
                      {row.trend && row.trend.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={row.trend.map((v, i) => ({ value: v, index: i }))}>
                            <RechartsTooltip 
                              content={<SparklineTooltip />}
                              cursor={{ stroke: theme === 'dark' ? '#ffffff20' : '#00000020', strokeWidth: 1 }}
                              isAnimationActive={false}
                            />
                            <Line 
                              type="monotone" 
                              dataKey="value" 
                              stroke="#3b82f6" 
                              strokeWidth={2} 
                              dot={false} 
                              isAnimationActive={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-600 text-xs">-</div>
                      )}
                    </div>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className={`font-mono ${getKdColor(row.kd)}`}>{row.kd}</span>
                      <div className="w-12 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${row.kd}%` }}
                          transition={{ duration: 1, delay: 1 }}
                          className="h-full bg-current rounded-full" 
                          style={{ color: row.kd > 70 ? '#fb923c' : row.kd > 40 ? '#fbbf24' : '#34d399' }} 
                        />
                      </div>
                    </div>
                  </td>
                  <td className="p-4 text-right text-slate-600 dark:text-slate-300 font-mono">
                    ${row.cpc.toFixed(2)}
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
      
      <div className="p-4 border-t border-border flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/20">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          Showing <span className="font-medium text-foreground">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium text-foreground">{Math.min(currentPage * itemsPerPage, tableData.length)}</span> of <span className="font-medium text-foreground">{tableData.length}</span> results
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            className="p-2 rounded-lg border border-border bg-card hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum;
              if (totalPages <= 5) pageNum = i + 1;
              else if (currentPage <= 3) pageNum = i + 1;
              else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
              else pageNum = currentPage - 2 + i;
              
              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                    currentPage === pageNum
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border border-border bg-card hover:bg-slate-100 dark:hover:bg-white/5 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages || totalPages === 0}
            className="p-2 rounded-lg border border-border bg-card hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
});
