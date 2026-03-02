import { motion, useSpring, useTransform } from 'motion/react';
import { memo, useEffect } from 'react';
import { Target, TrendingUp, DollarSign, BarChart2, Loader2, Info } from 'lucide-react';
import { Tooltip } from 'react-tooltip';
import 'react-tooltip/dist/react-tooltip.css';
import { KeywordData } from '../services/keywordService';

function AnimatedNumber({ value, format = (v: number) => v.toString() }: { value: number, format?: (v: number) => string }) {
 const spring = useSpring(0, { mass: 1, stiffness: 50, damping: 15 });
 const display = useTransform(spring, (current) => format(current));

 useEffect(() => {
 spring.set(value);
 }, [spring, value]);

 return <motion.span>{display}</motion.span>;
}

function CircularProgress({ value, colorClass }: { value: number, colorClass: string }) {
 return (
 <div className="relative w-16 h-16 flex items-center justify-center">
 <svg className="w-full h-full transform -rotate-90"viewBox="0 0 36 36">
 <path
 className="text-muted/50"
 strokeWidth="3"
 stroke="currentColor"
 fill="none"
 d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
 />
 <motion.path
 className={colorClass}
 strokeWidth="3"
 strokeDasharray="100, 100"
 stroke="currentColor"
 fill="none"
 strokeLinecap="round"
 initial={{ strokeDashoffset: 100 }}
 animate={{ strokeDashoffset: 100 - value }}
 transition={{ duration: 1.5, ease:"easeOut", delay: 0.6 }}
 d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
 />
 </svg>
 <div className="absolute inset-0 flex items-center justify-center text-sm font-bold">
 <AnimatedNumber value={value} format={(v) => Math.round(v).toString()} />
 </div>
 </div>
 );
}

export default memo(function MetricsCards({ data, loading }: { data: KeywordData, loading?: boolean }) {
 const container = {
 hidden: { opacity: 0 },
 show: {
 opacity: 1,
 transition: { staggerChildren: 0.1, delayChildren: 0.4 }
 }
 };

 const item = {
 hidden: { opacity: 0, y: 20, scale: 0.95 },
 show: { opacity: 1, y: 0, scale: 1, transition: { type:"spring"as const, stiffness: 100, damping: 15 } }
 };

 const getKdColor = (kd: number) => {
 if (kd > 70) return 'text-orange-500';
 if (kd > 40) return 'text-amber-500';
 return 'text-emerald-500';
 };

 const getKdLabel = (kd: number) => {
 if (kd > 70) return 'Hard';
 if (kd > 40) return 'Medium';
 return 'Easy';
 };

 const intentLabel = data.intent === 'Info' ? 'Informational' : 
 data.intent === 'Nav' ? 'Navigational' : 
 data.intent === 'Com' ? 'Commercial' : 'Transactional';

 return (
 <motion.div
 variants={container}
 initial="hidden"
 animate="show"
 className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
 >
 {/* Total Volume */}
 <motion.div 
 variants={item} 
 whileHover={{ y: -5, scale: 1.02 }} 
 transition={{ type:"spring", stiffness: 400, damping: 25 }} 
 className="bg-card border border-border rounded-3xl p-6 relative overflow-hidden group hover:border-accent/30 transition-colors flex flex-col justify-between shadow-lg"
 data-tooltip-id="metric-tooltip"
 data-tooltip-content="The average number of times a specific keyword is searched for in a month."
 >
 {loading && (
 <div className="absolute inset-0 z-50 bg-background/50 backdrop-blur-sm flex items-center justify-center">
 <Loader2 className="w-6 h-6 text-accent animate-spin"/>
 </div>
 )}
 <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"/>
 <div className="flex justify-between items-start mb-4">
 <div>
 <div className="flex items-center gap-1.5 mb-1">
 <p className="text-muted-foreground text-sm font-medium">Total Volume</p>
 <Info className="w-3 h-3 text-muted-foreground/60"/>
 </div>
 <h3 className="text-4xl font-bold text-foreground tracking-tight">
 <AnimatedNumber value={data.volume} format={(v) => Math.round(v).toLocaleString()} />
 </h3>
 <p className="text-[10px] text-muted-foreground mt-1">Monthly Search Demand</p>
 </div>
 <div className="p-3 bg-accent/10 rounded-xl text-accent group-hover:scale-110 transition-transform duration-300">
 <BarChart2 className="w-6 h-6"/>
 </div>
 </div>
 <div className="flex items-center gap-2 text-sm mt-4">
 <TrendingUp className="w-4 h-4 text-green-400"/>
 <span className="text-green-400 font-medium">+12.5%</span>
 <span className="text-muted-foreground">vs last month</span>
 </div>
 </motion.div>

 {/* Keyword Difficulty */}
 <motion.div 
 variants={item} 
 whileHover={{ y: -5, scale: 1.02 }} 
 transition={{ type:"spring", stiffness: 400, damping: 25 }} 
 className="bg-card border border-border rounded-3xl p-6 relative overflow-hidden group hover:border-orange-500/30 transition-colors flex flex-col justify-between shadow-lg"
 data-tooltip-id="metric-tooltip"
 data-tooltip-content="An estimate of how difficult it is to rank in the top 10 organic search results for a keyword."
 >
 {loading && (
 <div className="absolute inset-0 z-50 bg-background/50 backdrop-blur-sm flex items-center justify-center">
 <Loader2 className="w-6 h-6 text-accent animate-spin"/>
 </div>
 )}
 <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"/>
 <div className="flex justify-between items-start mb-4">
 <div>
 <div className="flex items-center gap-1.5 mb-1">
 <p className="text-muted-foreground text-sm font-medium">Keyword Difficulty</p>
 <Info className="w-3 h-3 text-muted-foreground/60"/>
 </div>
 <div className="flex items-baseline gap-2 mt-2">
 <span className={`${getKdColor(data.kd)} font-bold text-2xl `}>{getKdLabel(data.kd)}</span>
 </div>
 <p className="text-[10px] text-muted-foreground mt-1">Ranking Competition</p>
 </div>
 <div className="group-hover:scale-110 transition-transform duration-300">
 <CircularProgress value={data.kd} colorClass={getKdColor(data.kd)} />
 </div>
 </div>
 <p className="text-muted-foreground text-sm">You will need lots of high-quality backlinks to rank.</p>
 </motion.div>

 {/* Average CPC */}
 <motion.div 
 variants={item} 
 whileHover={{ y: -5, scale: 1.02 }} 
 transition={{ type:"spring", stiffness: 400, damping: 25 }} 
 className="bg-card border border-border rounded-3xl p-6 relative overflow-hidden group hover:border-green-400/30 transition-colors flex flex-col justify-between shadow-lg"
 data-tooltip-id="metric-tooltip"
 data-tooltip-content="The average amount advertisers pay for a click on their ad for this keyword."
 >
 {loading && (
 <div className="absolute inset-0 z-50 bg-background/50 backdrop-blur-sm flex items-center justify-center">
 <Loader2 className="w-6 h-6 text-accent animate-spin"/>
 </div>
 )}
 <div className="absolute inset-0 bg-gradient-to-br from-green-400/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"/>
 <div className="flex justify-between items-start mb-4">
 <div>
 <div className="flex items-center gap-1.5 mb-1">
 <p className="text-muted-foreground text-sm font-medium">Average CPC</p>
 <Info className="w-3 h-3 text-muted-foreground/60"/>
 </div>
 <h3 className="text-4xl font-bold text-foreground tracking-tight flex items-center">
 $<AnimatedNumber value={data.cpc} format={(v) => v.toFixed(2)} />
 </h3>
 <p className="text-[10px] text-muted-foreground mt-1">Ad Cost Per Click</p>
 </div>
 <div className="p-3 bg-green-400/10 rounded-xl text-green-400 group-hover:scale-110 transition-transform duration-300">
 <DollarSign className="w-6 h-6"/>
 </div>
 </div>
 <div className="flex items-center gap-2 text-sm mt-4">
 <span className="text-muted-foreground font-medium">High commercial value</span>
 </div>
 </motion.div>

 {/* Search Intent */}
 <motion.div 
 variants={item} 
 whileHover={{ y: -5, scale: 1.02 }} 
 transition={{ type:"spring", stiffness: 400, damping: 25 }} 
 className="bg-card border border-border rounded-3xl p-6 relative overflow-hidden group hover:border-purple-500/30 transition-colors flex flex-col justify-between shadow-lg"
 data-tooltip-id="metric-tooltip"
 data-tooltip-content="The primary goal a user has when searching for a keyword (Informational, Navigational, Commercial, or Transactional)."
 >
 {loading && (
 <div className="absolute inset-0 z-50 bg-background/50 backdrop-blur-sm flex items-center justify-center">
 <Loader2 className="w-6 h-6 text-accent animate-spin"/>
 </div>
 )}
 <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"/>
 <div className="flex justify-between items-start mb-4">
 <div>
 <div className="flex items-center gap-1.5 mb-1">
 <p className="text-muted-foreground text-sm font-medium">Search Intent</p>
 <Info className="w-3 h-3 text-muted-foreground/60"/>
 </div>
 <h3 className="text-3xl font-bold text-foreground tracking-tight mt-1">
 {intentLabel}
 </h3>
 <p className="text-[10px] text-muted-foreground mt-1">User Goal Analysis</p>
 </div>
 <div className="p-3 bg-purple-500/10 rounded-xl text-purple-400 group-hover:scale-110 transition-transform duration-300">
 <Target className="w-6 h-6"/>
 </div>
 </div>
 <div>
 <div className="w-full bg-muted rounded-full h-2 mt-4 overflow-hidden flex">
 <motion.div 
 initial={{ width: 0 }} animate={{ width: `${data.intentBreakdown.info}%` }} transition={{ duration: 1, delay: 0.8 }}
 className="bg-purple-500 h-full"title={`Informational ${data.intentBreakdown.info}%`} 
 />
 <motion.div 
 initial={{ width: 0 }} animate={{ width: `${data.intentBreakdown.com}%` }} transition={{ duration: 1, delay: 0.9 }}
 className="bg-accent h-full"title={`Commercial ${data.intentBreakdown.com}%`} 
 />
 <motion.div 
 initial={{ width: 0 }} animate={{ width: `${data.intentBreakdown.tx}%` }} transition={{ duration: 1, delay: 1.0 }}
 className="bg-green-400 h-full"title={`Transactional ${data.intentBreakdown.tx}%`} 
 />
 <motion.div 
 initial={{ width: 0 }} animate={{ width: `${data.intentBreakdown.nav}%` }} transition={{ duration: 1, delay: 1.1 }}
 className="bg-orange-500 h-full"title={`Navigational ${data.intentBreakdown.nav}%`} 
 />
 </div>
 <div className="flex justify-between text-xs text-muted-foreground mt-2">
 <span>Info {data.intentBreakdown.info}%</span>
 <span>Com {data.intentBreakdown.com}%</span>
 <span>Tx {data.intentBreakdown.tx}%</span>
 </div>
 </div>
 </motion.div>

 <Tooltip 
 id="metric-tooltip"
 className="!bg-card/95 !backdrop-blur-md !border !border-border !rounded-xl !shadow-sm !p-3 !z-50 !max-w-[200px] !text-xs !leading-relaxed !text-muted-foreground"
 />
 </motion.div>
 );
});
