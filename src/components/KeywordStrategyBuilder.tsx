import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { KeywordData } from '../services/keywordService';
import { Network, FileText, ChevronDown, ChevronRight, Download, ExternalLink } from 'lucide-react';

interface Cluster {
 id: string;
 pillar: string;
 volume: number;
 keywords: KeywordData['relatedKeywords'];
}

export default function KeywordStrategyBuilder({ data }: { data: KeywordData['relatedKeywords'] }) {
 const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

 const clusters = useMemo(() => {
 // Simple clustering logic based on common words
 const stopWords = new Set(['how', 'to', 'what', 'is', 'the', 'a', 'an', 'for', 'in', 'on', 'with', 'and', 'or', 'of', 'best', 'top', 'vs', 'guide']);
 const wordCounts = new Map<string, number>();
 
 data.forEach(item => {
 const words = item.keyword.toLowerCase().split(/\s+/);
 words.forEach(word => {
 if (!stopWords.has(word) && word.length > 2) {
 wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
 }
 });
 });

 // Find top words to act as pillars
 const sortedWords = Array.from(wordCounts.entries())
 .sort((a, b) => b[1] - a[1])
 .slice(0, 8)
 .map(entry => entry[0]);

 const generatedClusters: Cluster[] = [];
 const usedKeywords = new Set<string>();

 sortedWords.forEach((word, index) => {
 const clusterKeywords = data.filter(item => 
 item.keyword.toLowerCase().includes(word) && !usedKeywords.has(item.id)
 );

 if (clusterKeywords.length > 0) {
 clusterKeywords.forEach(k => usedKeywords.add(k.id));
 const totalVolume = clusterKeywords.reduce((sum, k) => sum + k.volume, 0);
 
 generatedClusters.push({
 id: `cluster-${index}`,
 pillar: word.charAt(0).toUpperCase() + word.slice(1) + ' Guide',
 volume: totalVolume,
 keywords: clusterKeywords.sort((a, b) => b.volume - a.volume)
 });
 }
 });

 // Group remaining keywords
 const remaining = data.filter(item => !usedKeywords.has(item.id));
 if (remaining.length > 0) {
 generatedClusters.push({
 id: 'cluster-other',
 pillar: 'Other Topics',
 volume: remaining.reduce((sum, k) => sum + k.volume, 0),
 keywords: remaining.sort((a, b) => b.volume - a.volume)
 });
 }

 return generatedClusters.sort((a, b) => b.volume - a.volume);
 }, [data]);

 const toggleCluster = (id: string) => {
 const newExpanded = new Set(expandedClusters);
 if (newExpanded.has(id)) {
 newExpanded.delete(id);
 } else {
 newExpanded.add(id);
 }
 setExpandedClusters(newExpanded);
 };

 const handleExport = () => {
 let csvContent ="Pillar Page,Keyword,Volume,KD,Intent\n";
 clusters.forEach(cluster => {
 cluster.keywords.forEach(kw => {
 csvContent += `"${cluster.pillar}","${kw.keyword}",${kw.volume},${kw.kd},${kw.intent}\n`;
 });
 });

 const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
 const link = document.createElement('a');
 const url = URL.createObjectURL(blob);
 link.setAttribute('href', url);
 link.setAttribute('download', 'keyword_strategy.csv');
 link.style.visibility = 'hidden';
 document.body.appendChild(link);
 link.click();
 document.body.removeChild(link);
 };

 return (
 <div className="bg-card border border-border rounded-3xl p-6 shadow-2xl relative overflow-hidden group">
 <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 blur-[100px] rounded-full pointer-events-none"></div>
 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 relative z-10">
 <div>
 <h3 className="text-2xl font-bold text-foreground flex items-center gap-2">
 <Network className="w-6 h-6 text-accent"/>
 Keyword Strategy Builder
 </h3>
 <p className="text-sm text-muted-foreground mt-1">
 Automatically grouped keywords into logical clusters for pillar pages and subtopics.
 </p>
 </div>
 <button
 onClick={handleExport}
 className="flex items-center gap-2 px-4 py-2 bg-accent/10 hover:bg-accent/20 text-accent rounded-xl text-sm font-bold transition-colors border border-accent/20 shadow-sm"
 >
 <Download className="w-4 h-4"/>
 Export Strategy
 </button>
 </div>

 <div className="space-y-4 relative z-10">
 {clusters.map((cluster) => (
 <div key={cluster.id} className="border border-border rounded-2xl overflow-hidden bg-card/30">
 <button
 onClick={() => toggleCluster(cluster.id)}
 className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
 >
 <div className="flex items-center gap-3">
 {expandedClusters.has(cluster.id) ? (
 <ChevronDown className="w-5 h-5 text-muted-foreground"/>
 ) : (
 <ChevronRight className="w-5 h-5 text-muted-foreground"/>
 )}
 <div className="flex items-center gap-2">
 <FileText className="w-4 h-4 text-accent"/>
 <span className="font-bold text-foreground">{cluster.pillar}</span>
 <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20 font-bold">
 {cluster.keywords.length} topics
 </span>
 </div>
 </div>
 <div className="text-sm font-bold text-foreground">
 {cluster.volume.toLocaleString()} <span className="text-xs text-muted-foreground font-bold">vol</span>
 </div>
 </button>
 
 <AnimatePresence>
 {expandedClusters.has(cluster.id) && (
 <motion.div
 initial={{ height: 0, opacity: 0 }}
 animate={{ height: 'auto', opacity: 1 }}
 exit={{ height: 0, opacity: 0 }}
 className="overflow-hidden"
 >
 <div className="p-4 pt-0 border-t border-border/50 bg-muted/10">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
 {cluster.keywords.map(kw => (
 <div key={kw.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border group">
 <div className="flex items-center gap-2 overflow-hidden">
 <div className="w-1.5 h-1.5 rounded-full bg-accent/50 group-hover:bg-accent transition-colors shadow-sm group-hover:shadow-accent/50"/>
 <span className="text-sm font-bold text-muted-foreground group-hover:text-accent truncate transition-colors">{kw.keyword}</span>
 </div>
 <div className="flex items-center gap-3 text-xs">
 <span className="text-muted-foreground font-bold">{kw.volume.toLocaleString()}</span>
 <span className={`px-1.5 py-0.5 rounded border font-bold ${
 kw.kd > 70 ? 'border-orange-500/20 text-orange-500 bg-orange-500/10' :
 kw.kd > 40 ? 'border-amber-500/20 text-amber-500 bg-amber-500/10' :
 'border-emerald-500/20 text-emerald-500 bg-emerald-500/10'
 }`}>
 KD {kw.kd}
 </span>
 </div>
 </div>
 ))}
 </div>
 </div>
 </motion.div>
 )}
 </AnimatePresence>
 </div>
 ))}
 </div>
 </div>
 );
}
