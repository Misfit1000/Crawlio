import { memo } from 'react';
import { motion } from 'motion/react';
import { ExternalLink, Users, BarChart, ShieldAlert, Loader2 } from 'lucide-react';
import { KeywordData } from '../services/keywordService';

export default memo(function CompetitorsList({ data, loading }: { data: KeywordData['competitors'], loading?: boolean }) {
 return (
 <motion.div
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.6, delay: 0.6 }}
 className="bg-card border border-border rounded-3xl overflow-hidden h-full flex flex-col relative shadow-2xl"
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
 <ShieldAlert className="w-6 h-6 text-accent"/>
 Top Competitors
 </h3>
 <div className="text-sm text-accent bg-accent/10 px-3 py-1 rounded-full border border-accent/20">Ranking for this keyword</div>
 </div>
 <p className="text-muted-foreground text-sm relative z-10">Domains currently competing for organic visibility.</p>
 </div>
 
 <div className="p-6 flex-1 overflow-y-auto">
 <div className="space-y-4">
 {data.map((competitor, index) => (
 <motion.div
 key={index}
 initial={{ opacity: 0, x: -20 }}
 animate={{ opacity: 1, x: 0 }}
 transition={{ delay: 0.8 + index * 0.1 }}
 whileHover={{ scale: 1.02, x: 5 }}
 className="flex flex-col p-4 rounded-2xl bg-card border border-border hover:bg-muted hover:border-accent/30 transition-all group cursor-pointer"
 >
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-4">
 <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent font-bold text-sm border border-accent/20 group-hover:bg-accent/20 transition-colors">
 {index + 1}
 </div>
 <div>
 <div className="text-foreground font-bold flex items-center gap-2 group-hover:text-accent transition-colors">
 {competitor.domain}
 <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"/>
 </div>
 <div className="text-sm text-muted-foreground flex items-center gap-3 mt-1">
 <span className="flex items-center gap-1"title="Estimated Monthly Traffic">
 <Users className="w-3 h-3 text-accent"/>
 {competitor.traffic.toLocaleString()}
 </span>
 <span className="flex items-center gap-1"title="Domain Authority (0-100)">
 <ShieldAlert className="w-3 h-3 text-orange-500"/>
 DA: {competitor.domainAuthority}
 </span>
 </div>
 </div>
 </div>
 
 <div className="text-right">
 <div className="text-sm text-muted-foreground mb-1 flex items-center justify-end gap-1 font-bold">
 <BarChart className="w-3 h-3 text-accent"/>
 Overlap
 </div>
 <div className="text-foreground font-bold text-xl group-hover:text-accent transition-colors">
 {competitor.overlap}%
 </div>
 </div>
 </div>
 
 <div className="mt-2 pt-3 border-t border-border">
 <div className="text-xs text-muted-foreground mb-2 font-bold">Top Shared Keywords</div>
 <div className="flex flex-wrap gap-2">
 {competitor.topKeywords.map((kw, i) => (
 <span key={i} className="px-2 py-1 bg-muted/50 rounded-md text-xs text-foreground border border-border hover:border-accent/50 transition-colors">
 {kw}
 </span>
 ))}
 </div>
 </div>
 </motion.div>
 ))}
 </div>
 </div>
 </motion.div>
 );
});
