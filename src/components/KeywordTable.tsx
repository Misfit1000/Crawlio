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
 className="bg-card/90 backdrop-blur-md border border-border px-2 py-1 rounded shadow-sm text-xs"
 >
 <span className="text-accent font-bold">{payload[0].value.toLocaleString()}</span>
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
 case 'Info': return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
 case 'Nav': return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
 case 'Com': return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
 case 'Tx': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
 default: return 'bg-muted text-muted-foreground border-border';
 }
 };

 const getKdColor = (kd: number) => {
 if (kd > 70) return 'text-orange-500';
 if (kd > 40) return 'text-amber-500';
 return 'text-emerald-500';
 };

 const SortIcon = ({ columnKey }: { columnKey: keyof KeywordData['relatedKeywords'][0] }) => {
 if (sortConfig?.key !== columnKey) return <ArrowUpDown className="w-3 h-3 text-muted-foreground ml-1"/>;
 return sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-accent ml-1"/> : <ArrowDown className="w-3 h-3 text-accent ml-1"/>;
 };

 return (
 <motion.div
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.6, delay: 0.8 }}
 className="bg-card border border-border rounded-3xl overflow-hidden relative shadow-2xl"
 >
 {loading && (
 <div className="absolute inset-0 z-50 bg-background/50 backdrop-blur-sm flex items-center justify-center">
 <Loader2 className="w-8 h-8 text-accent animate-spin"/>
 </div>
 )}
 <div className="p-6 border-b border-border flex flex-col gap-4 relative">
 <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 blur-[100px] rounded-full pointer-events-none"></div>
 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative z-10">
 <div className="flex flex-col gap-1">
 <div className="flex items-center gap-4">
 <h3 className="text-2xl font-bold text-foreground whitespace-nowrap">Keyword Magic</h3>
 <div className="text-sm text-accent bg-accent/10 px-3 py-1 rounded-full whitespace-nowrap border border-accent/20">{tableData.length} keywords found</div>
 </div>
 <p className="text-muted-foreground text-sm">Explore related terms, variations, and semantic keywords.</p>
 </div>
 
 <div className="flex items-center gap-3 w-full sm:w-auto">
 <div className="relative flex-1 sm:w-64">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
 <input
 type="text"
 placeholder="Filter keywords..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full bg-background/50 border border-border rounded-xl py-2 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
 />
 </div>
 <motion.button
 whileHover={{ scale: 1.05 }}
 whileTap={{ scale: 0.95 }}
 onClick={handleExport}
 className="flex items-center gap-2 px-4 py-2 bg-accent/10 hover:bg-accent/20 text-accent rounded-xl text-sm font-bold transition-colors border border-accent/20 whitespace-nowrap shadow-sm"
 >
 <Download className="w-4 h-4"/>
 Export CSV
 </motion.button>
 </div>
 </div>
 
 <div className="flex flex-wrap items-center gap-4 pt-2 relative z-10">
 <div className="flex items-center gap-2">
 <label className="text-xs text-muted-foreground font-bold">Intent:</label>
 <select 
 value={intentFilter} 
 onChange={(e) => setIntentFilter(e.target.value)}
 className="bg-background/50 border border-border rounded-lg py-1.5 px-3 text-sm text-foreground focus:outline-none focus:border-accent transition-colors"
 >
 <option value="All">All Intents</option>
 <option value="Info">Informational</option>
 <option value="Nav">Navigational</option>
 <option value="Com">Commercial</option>
 <option value="Tx">Transactional</option>
 </select>
 </div>
 <div className="flex items-center gap-2">
 <label className="text-xs text-muted-foreground font-bold">Min Volume:</label>
 <input 
 type="number"
 value={minVolume}
 onChange={(e) => setMinVolume(e.target.value)}
 placeholder="e.g. 1000"
 className="bg-background/50 border border-border rounded-lg py-1.5 px-3 w-28 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent transition-colors"
 />
 </div>
 </div>
 </div>
 
 <div className="overflow-x-auto">
 <table className="w-full text-left border-collapse">
 <thead>
 <tr className="border-b border-border text-xs text-muted-foreground font-bold bg-muted/20">
 <th className="p-4 cursor-pointer hover:text-accent transition-colors"onClick={() => handleSort('keyword')}>
 <div className="flex items-center">Keyword <SortIcon columnKey="keyword"/></div>
 </th>
 <th className="p-4 cursor-pointer hover:text-accent transition-colors"onClick={() => handleSort('intent')}>
 <div className="flex items-center">Intent <SortIcon columnKey="intent"/></div>
 </th>
 <th className="p-4 cursor-pointer hover:text-accent transition-colors text-right"onClick={() => handleSort('volume')}>
 <div className="flex items-center justify-end">Volume <SortIcon columnKey="volume"/></div>
 </th>
 <th className="p-4 text-right">
 <div className="flex items-center justify-end">Trend</div>
 </th>
 <th className="p-4 cursor-pointer hover:text-accent transition-colors text-right"onClick={() => handleSort('kd')}>
 <div className="flex items-center justify-end">KD % <SortIcon columnKey="kd"/></div>
 </th>
 <th className="p-4 cursor-pointer hover:text-accent transition-colors text-right"onClick={() => handleSort('cpc')}>
 <div className="flex items-center justify-end">CPC <SortIcon columnKey="cpc"/></div>
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
 layout: { type:"spring", stiffness: 300, damping: 30 },
 opacity: { duration: 0.2 }
 }}
 className="border-b border-border hover:bg-muted/50 transition-colors group"
 >
 <td className="p-4 text-foreground font-bold group-hover:text-accent transition-colors">
 {row.keyword}
 </td>
 <td className="p-4">
 <span className={`px-2.5 py-1 rounded-md text-xs font-bold border ${getIntentColor(row.intent)}`}>
 {row.intent}
 </span>
 </td>
 <td className="p-4 text-right text-muted-foreground">
 {row.volume.toLocaleString()}
 </td>
 <td className="p-4 w-32">
 <div className="h-8 w-full">
 {row.trend && row.trend.length > 0 ? (
 <ResponsiveContainer width="100%"height="100%">
 <LineChart data={row.trend.map((v, i) => ({ value: v, index: i }))}>
 <RechartsTooltip 
 content={<SparklineTooltip />}
 cursor={{ stroke: theme === 'dark' ? '#ffffff20' : '#00000020', strokeWidth: 1 }}
 isAnimationActive={false}
 />
 <Line 
 type="monotone"
 dataKey="value"
 stroke="#00FF00"
 strokeWidth={2} 
 dot={false} 
 isAnimationActive={false}
 />
 </LineChart>
 </ResponsiveContainer>
 ) : (
 <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">-</div>
 )}
 </div>
 </td>
 <td className="p-4 text-right">
 <div className="flex items-center justify-end gap-2">
 <span className={` ${getKdColor(row.kd)}`}>{row.kd}</span>
 <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
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
 <td className="p-4 text-right text-muted-foreground">
 ${row.cpc.toFixed(2)}
 </td>
 </motion.tr>
 ))}
 </AnimatePresence>
 </tbody>
 </table>
 </div>
 
 <div className="p-4 border-t border-border flex items-center justify-between bg-muted/30">
 <div className="text-sm text-muted-foreground">
 Showing <span className="font-medium text-foreground">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium text-foreground">{Math.min(currentPage * itemsPerPage, tableData.length)}</span> of <span className="font-medium text-foreground">{tableData.length}</span> results
 </div>
 
 <div className="flex items-center gap-2">
 <button
 onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
 disabled={currentPage === 1}
 className="p-2 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
 >
 <ChevronLeft className="w-4 h-4"/>
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
 ? 'bg-accent text-accent-foreground border-accent'
 : 'border border-border bg-card hover:bg-muted text-muted-foreground'
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
 className="p-2 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
 >
 <ChevronRight className="w-4 h-4"/>
 </button>
 </div>
 </div>
 </motion.div>
 );
});
