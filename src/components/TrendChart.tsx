import { motion, AnimatePresence } from"motion/react";
import {
 AreaChart,
 Area,
 XAxis,
 YAxis,
 CartesianGrid,
 Tooltip,
 ResponsiveContainer,
 ReferenceArea,
} from"recharts";
import { useState, useEffect, memo, useMemo } from"react";
import { Loader2, ZoomOut, Info } from"lucide-react";
import { KeywordData } from"../services/keywordService";

import { useTheme } from"../contexts/ThemeContext";

const CustomTooltip = ({ active, payload, label }: any) => {
 const { theme } = useTheme();
 if (active && payload && payload.length) {
 return (
 <AnimatePresence>
 <motion.div
 initial={{ opacity: 0, y: 10, scale: 0.95 }}
 animate={{ opacity: 1, y: 0, scale: 1 }}
 exit={{ opacity: 0, y: 10, scale: 0.95 }}
 transition={{ duration: 0.2 }}
 className="bg-card/95 backdrop-blur-md border border-border p-4 rounded-xl shadow-lg min-w-[200px]"
 >
 <div className="flex items-center justify-between mb-3 border-b border-border/50 pb-2">
 <p className="text-foreground font-medium">{label}</p>
 <Info className="w-4 h-4 text-muted-foreground"/>
 </div>
 <div className="space-y-3">
 {payload.map((entry: any, index: number) => (
 <div key={index} className="flex flex-col gap-1">
 <div className="flex items-center justify-between">
 <span className="text-sm text-muted-foreground flex items-center gap-1.5">
 <div className="w-2 h-2 rounded-full"style={{ backgroundColor: entry.color }} />
 {entry.dataKey === 'volume' ? 'Search Volume' : 'Est. CPC'}
 </span>
 <span className="font-bold text-foreground"style={{ color: entry.color }}>
 {entry.dataKey === 'cpc' ? '$' : ''}
 {entry.value.toLocaleString(undefined, { 
 minimumFractionDigits: entry.dataKey === 'cpc' ? 2 : 0, 
 maximumFractionDigits: entry.dataKey === 'cpc' ? 2 : 0 
 })}
 </span>
 </div>
 {entry.dataKey === 'volume' && (
 <div className="w-full bg-muted rounded-full h-1.5 mt-1 overflow-hidden">
 <div 
 className="bg-blue-500 h-1.5 rounded-full"
 style={{ width: `${Math.min(100, (entry.value / 10000) * 100)}%` }} 
 />
 </div>
 )}
 </div>
 ))}
 </div>
 </motion.div>
 </AnimatePresence>
 );
 }
 return null;
};

type Timeframe ="1h"|"24h"|"7d"|"30d"|"1y"|"5y";

const TIMEFRAMES: { label: string; value: Timeframe }[] = [
 { label:"1H", value:"1h"},
 { label:"24H", value:"24h"},
 { label:"7D", value:"7d"},
 { label:"30D", value:"30d"},
 { label:"1Y", value:"1y"},
 { label:"5Y", value:"5y"},
];

export default memo(function TrendChart({
 data,
 loading,
}: {
 data: KeywordData["trends"];
 loading?: boolean;
}) {
 const { theme } = useTheme();
 const [isMounted, setIsMounted] = useState(false);
 const [timeframe, setTimeframe] = useState<Timeframe>("1y");
 
 // Zooming state
 const [refAreaLeft, setRefAreaLeft] = useState<string | number | null>(null);
 const [refAreaRight, setRefAreaRight] = useState<string | number | null>(null);
 const [zoomedData, setZoomedData] = useState<any[] | null>(null);

 useEffect(() => {
 setIsMounted(true);
 }, []);

 const chartData = data?.[timeframe] || [];

 // Reset zoom when timeframe changes
 useEffect(() => {
 setZoomedData(null);
 setRefAreaLeft(null);
 setRefAreaRight(null);
 }, [timeframe, data]);

 const displayData = zoomedData || chartData;

 const zoom = () => {
 if (refAreaLeft === refAreaRight || refAreaRight === null || refAreaLeft === null) {
 setRefAreaLeft(null);
 setRefAreaRight(null);
 return;
 }

 let leftIndex = chartData.findIndex((d) => d.time === refAreaLeft);
 let rightIndex = chartData.findIndex((d) => d.time === refAreaRight);

 if (leftIndex > rightIndex) {
 [leftIndex, rightIndex] = [rightIndex, leftIndex];
 }

 // Prevent zooming in too much (e.g., less than 2 points)
 if (rightIndex - leftIndex < 2) {
 setRefAreaLeft(null);
 setRefAreaRight(null);
 return;
 }

 setZoomedData(chartData.slice(leftIndex, rightIndex + 1));
 setRefAreaLeft(null);
 setRefAreaRight(null);
 };

 const zoomOut = () => {
 setZoomedData(null);
 setRefAreaLeft(null);
 setRefAreaRight(null);
 };

 return (
 <motion.div
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.6, delay: 0.6 }}
 whileHover={{ y: -5 }}
 className="bg-card border border-border rounded-3xl p-6 h-[450px] flex flex-col relative overflow-hidden group hover:border-accent/30 transition-colors shadow-2xl"
 >
 {loading && (
 <div className="absolute inset-0 z-50 bg-background/50 backdrop-blur-sm flex items-center justify-center">
 <Loader2 className="w-8 h-8 text-accent animate-spin"/>
 </div>
 )}
 <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 blur-[100px] rounded-full pointer-events-none"></div>
 <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-50 group-hover:opacity-100 transition-opacity duration-500"/>

 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 relative z-10">
 <div>
 <h3 className="text-2xl font-bold text-foreground group-hover:text-accent transition-colors flex items-center gap-2">
 Search Volume Trend
 {zoomedData && (
 <span className="text-xs font-bold bg-accent/10 text-accent px-2 py-0.5 rounded-full border border-accent/20">
 Zoomed
 </span>
 )}
 </h3>
 <p className="text-sm text-muted-foreground">
 {zoomedData 
 ?"Showing zoomed timeframe. Click 'Zoom Out' to reset."
 :"Historical search interest over selected timeframe. Click and drag to zoom."}
 </p>
 </div>

 <div className="flex items-center gap-3">
 <AnimatePresence>
 {zoomedData && (
 <motion.button
 initial={{ opacity: 0, scale: 0.8 }}
 animate={{ opacity: 1, scale: 1 }}
 exit={{ opacity: 0, scale: 0.8 }}
 onClick={zoomOut}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-accent/10 text-accent hover:bg-accent/20 rounded-md transition-colors border border-accent/20"
 >
 <ZoomOut className="w-3.5 h-3.5"/>
 Zoom Out
 </motion.button>
 )}
 </AnimatePresence>
 <div className="flex items-center bg-background/50 border border-border rounded-lg p-1">
 {TIMEFRAMES.map((tf) => (
 <button
 key={tf.value}
 onClick={() => setTimeframe(tf.value)}
 className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
 timeframe === tf.value
 ?"bg-accent/20 text-accent border border-accent/30"
 :"text-muted-foreground hover:text-foreground hover:bg-card border border-transparent"
 }`}
 >
 {tf.label}
 </button>
 ))}
 </div>
 </div>
 </div>

 <div className="flex-1 w-full h-full min-h-0 select-none">
 {isMounted && chartData.length > 0 ? (
 <ResponsiveContainer width="100%"height="100%">
 <AreaChart
 data={displayData}
 margin={{ top: 10, right: 0, left: -20, bottom: 0 }}
 onMouseDown={(e) => e && setRefAreaLeft(e.activeLabel || null)}
 onMouseMove={(e) => e && refAreaLeft && setRefAreaRight(e.activeLabel || null)}
 onMouseUp={zoom}
 >
 <defs>
 <linearGradient id="colorVolume"x1="0"y1="0"x2="0"y2="1">
 <stop offset="5%"stopColor="#00FF00"stopOpacity={0.3} />
 <stop offset="95%"stopColor="#00FF00"stopOpacity={0} />
 </linearGradient>
 <linearGradient id="colorCpc"x1="0"y1="0"x2="0"y2="1">
 <stop offset="5%"stopColor="#FF00FF"stopOpacity={0.3} />
 <stop offset="95%"stopColor="#FF00FF"stopOpacity={0} />
 </linearGradient>
 </defs>
 <CartesianGrid
 strokeDasharray="3 3"
 stroke={theme === 'dark' ?"#ffffff10":"#00000010"}
 vertical={false}
 />
 <XAxis
 dataKey="time"
 stroke={theme === 'dark' ?"#ffffff40":"#00000040"}
 fontSize={12}
 tickLine={false}
 axisLine={false}
 dy={10}
 minTickGap={30}
 />
 <YAxis
 yAxisId="left"
 stroke={theme === 'dark' ?"#ffffff40":"#00000040"}
 fontSize={12}
 tickLine={false}
 axisLine={false}
 tickFormatter={(value) =>
 value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value
 }
 />
 <YAxis
 yAxisId="right"
 orientation="right"
 stroke={theme === 'dark' ?"#ffffff40":"#00000040"}
 fontSize={12}
 tickLine={false}
 axisLine={false}
 tickFormatter={(value) => `$${value.toFixed(2)}`}
 />
 <Tooltip
 content={<CustomTooltip />}
 cursor={{
 stroke: theme === 'dark' ?"#ffffff20":"#00000020",
 strokeWidth: 1,
 strokeDasharray:"4 4",
 }}
 isAnimationActive={false}
 />
 <Area
 yAxisId="left"
 key={`volume-${timeframe}-${zoomedData ? 'zoomed' : 'full'}`}
 type="monotone"
 dataKey="volume"
 stroke="#00FF00"
 strokeWidth={3}
 fillOpacity={1}
 fill="url(#colorVolume)"
 animationDuration={zoomedData ? 300 : 1000}
 animationEasing="ease-out"
 />
 <Area
 yAxisId="right"
 key={`cpc-${timeframe}-${zoomedData ? 'zoomed' : 'full'}`}
 type="monotone"
 dataKey="cpc"
 stroke="#FF00FF"
 strokeWidth={3}
 fillOpacity={1}
 fill="url(#colorCpc)"
 animationDuration={zoomedData ? 300 : 1000}
 animationEasing="ease-out"
 />
 {refAreaLeft && refAreaRight ? (
 <ReferenceArea
 yAxisId="left"
 x1={refAreaLeft}
 x2={refAreaRight}
 strokeOpacity={0.3}
 fill="#00FF00"
 fillOpacity={0.1}
 />
 ) : null}
 </AreaChart>
 </ResponsiveContainer>
 ) : (
 <div className="w-full h-full flex items-center justify-center text-muted-foreground">
 No trend data available
 </div>
 )}
 </div>
 </motion.div>
 );
});
