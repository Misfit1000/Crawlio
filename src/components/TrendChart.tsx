import { motion, AnimatePresence } from "motion/react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useState, useEffect, memo } from "react";
import { Loader2 } from "lucide-react";
import { KeywordData } from "../services/keywordService";

import { useTheme } from "../contexts/ThemeContext";

const CustomTooltip = ({ active, payload, label }: any) => {
  const { theme } = useTheme();
  return (
    <AnimatePresence>
      {active && payload && payload.length && (
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="bg-slate-900/90 dark:bg-slate-900/90 light:bg-white/90 backdrop-blur-md border border-white/10 dark:border-white/10 light:border-slate-200 p-4 rounded-xl shadow-2xl"
        >
          <p className="text-slate-400 dark:text-slate-400 light:text-slate-500 text-sm mb-1">{label}</p>
          <p className="text-blue-400 dark:text-blue-400 light:text-blue-600 font-bold text-xl">
            {payload[0].value.toLocaleString()}{" "}
            <span className="text-sm font-normal text-slate-300 dark:text-slate-300 light:text-slate-500">searches</span>
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

type Timeframe = "1h" | "24h" | "7d" | "30d" | "1y" | "5y";

const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: "1H", value: "1h" },
  { label: "24H", value: "24h" },
  { label: "7D", value: "7d" },
  { label: "30D", value: "30d" },
  { label: "1Y", value: "1y" },
  { label: "5Y", value: "5y" },
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

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const chartData = data?.[timeframe] || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.6 }}
      whileHover={{ y: -5 }}
      className="bg-card/50 backdrop-blur-xl border border-border rounded-3xl p-6 h-[450px] flex flex-col relative overflow-hidden group hover:border-blue-500/30 transition-colors shadow-sm"
    >
      {loading && (
        <div className="absolute inset-0 z-50 bg-background/50 backdrop-blur-sm flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      )}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent opacity-50 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h3 className="text-lg font-bold text-foreground group-hover:text-blue-400 transition-colors">
            Search Volume Trend
          </h3>
          <p className="text-xs text-slate-500">Historical search interest over selected timeframe.</p>
        </div>

        <div className="flex items-center bg-slate-950/50 dark:bg-slate-950/50 light:bg-slate-100 border border-white/10 dark:border-white/10 light:border-slate-200 rounded-lg p-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                timeframe === tf.value
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "text-slate-500 dark:text-slate-400 hover:text-white dark:hover:text-white light:hover:text-blue-600 hover:bg-white/5 dark:hover:bg-white/5 light:hover:bg-white border border-transparent"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 w-full h-full min-h-0">
        {isMounted && chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 0, left: -20, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={theme === 'dark' ? "#ffffff10" : "#00000010"}
                vertical={false}
              />
              <XAxis
                dataKey="time"
                stroke={theme === 'dark' ? "#ffffff40" : "#00000040"}
                fontSize={12}
                tickLine={false}
                axisLine={false}
                dy={10}
              />
              <YAxis
                stroke={theme === 'dark' ? "#ffffff40" : "#00000040"}
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) =>
                  value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value
                }
              />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{
                  stroke: theme === 'dark' ? "#ffffff20" : "#00000020",
                  strokeWidth: 1,
                  strokeDasharray: "4 4",
                }}
                isAnimationActive={false}
              />
              <Area
                key={timeframe} // Force re-animation on timeframe change
                type="monotone"
                dataKey="volume"
                stroke="#3b82f6"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorVolume)"
                animationDuration={1000}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-500">
            No trend data available
          </div>
        )}
      </div>
    </motion.div>
  );
});
