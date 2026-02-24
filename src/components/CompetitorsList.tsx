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
      className="bg-card/50 backdrop-blur-xl border border-border rounded-3xl overflow-hidden h-full flex flex-col relative shadow-sm"
    >
      {loading && (
        <div className="absolute inset-0 z-50 bg-background/50 backdrop-blur-sm flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      )}
      <div className="p-6 border-b border-border bg-slate-100/50 dark:bg-slate-800/20 relative z-10">
        <div className="flex justify-between items-center mb-1">
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-blue-500" />
            Top Competitors
          </h3>
          <div className="text-sm text-slate-500">Ranking for this keyword</div>
        </div>
        <p className="text-slate-500 text-xs">Domains currently competing for organic visibility.</p>
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
              className="flex flex-col p-4 rounded-2xl bg-slate-100 dark:bg-white/[0.02] border border-border hover:bg-slate-200 dark:hover:bg-white/[0.04] hover:border-blue-500/30 transition-all group cursor-pointer"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm border border-blue-500/20 group-hover:bg-blue-500/20 transition-colors">
                    {index + 1}
                  </div>
                  <div>
                    <div className="text-foreground font-medium flex items-center gap-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {competitor.domain}
                      <ExternalLink className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1" title="Estimated Monthly Traffic">
                        <Users className="w-3 h-3" />
                        {competitor.traffic.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1" title="Domain Authority (0-100)">
                        <ShieldAlert className="w-3 h-3" />
                        DA: {competitor.domainAuthority}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="text-right">
                  <div className="text-sm text-slate-500 mb-1 flex items-center justify-end gap-1">
                    <BarChart className="w-3 h-3" />
                    Overlap
                  </div>
                  <div className="text-foreground font-mono font-medium group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {competitor.overlap}%
                  </div>
                </div>
              </div>
              
              <div className="mt-2 pt-3 border-t border-border">
                <div className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">Top Shared Keywords</div>
                <div className="flex flex-wrap gap-2">
                  {competitor.topKeywords.map((kw, i) => (
                    <span key={i} className="px-2 py-1 bg-slate-200 dark:bg-slate-800/50 rounded-md text-xs text-slate-600 dark:text-slate-300 border border-border">
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
