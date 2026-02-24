import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Loader2,
  RefreshCw,
  LayoutTemplate,
  Link as LinkIcon,
  Eye,
  Lightbulb,
  AlertTriangle,
  FileText,
} from "lucide-react";
import MetricsCards from "./MetricsCards";
import { isRateLimitError } from "../services/geminiClient";
import { fetchKeywordData, KeywordData } from "../services/keywordService";

// Lazy load heavy components
const TrendChart = lazy(() => import("./TrendChart"));
const KeywordTable = lazy(() => import("./KeywordTable"));
const CompetitorsList = lazy(() => import("./CompetitorsList"));
const LocalMapResults = lazy(() => import("./LocalMapResults"));
const WorldMap = lazy(() => import("./WorldMap"));

const ComponentLoader = () => (
  <div className="w-full h-64 flex items-center justify-center bg-card/30 backdrop-blur-sm border border-border rounded-3xl">
    <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
  </div>
);

// We need to map the TopoJSON country names to our LOCATIONS codes
const COUNTRY_NAME_MAP: Record<string, string> = {
  "United States of America": "US",
  "United States": "US",
  "United Kingdom": "UK",
  Canada: "CA",
  Australia: "AU",
  India: "IN",
  Germany: "DE",
  France: "FR",
  Japan: "JP",
  Brazil: "BR",
  Mexico: "MX",
  Italy: "IT",
  Spain: "ES",
  Netherlands: "NL",
  Sweden: "SE",
  Singapore: "SG",
  "South Africa": "ZA",
  "New Zealand": "NZ",
  Ireland: "IE",
  Switzerland: "CH",
  Austria: "AT",
  Belgium: "BE",
  Denmark: "DK",
  Finland: "FI",
  Norway: "NO",
  Portugal: "PT",
  Poland: "PL",
  Turkey: "TR",
  "United Arab Emirates": "AE",
  "Saudi Arabia": "SA",
  "South Korea": "KR",
  Indonesia: "ID",
  Malaysia: "MY",
  Philippines: "PH",
  Thailand: "TH",
  Vietnam: "VN",
  Argentina: "AR",
  Colombia: "CO",
  Chile: "CL",
  Peru: "PE",
  Egypt: "EG",
  Nigeria: "NG",
  Kenya: "KE",
  Nepal: "NP",
};

export default function Dashboard({
  keyword,
  location,
  latLng,
  onLocationChange,
}: {
  keyword: string;
  location?: string;
  latLng?: { latitude: number; longitude: number } | null;
  onLocationChange?: (code: string) => void;
}) {
  const [data, setData] = useState<KeywordData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = () => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    fetchKeywordData(keyword, location, latLng)
      .then((res) => {
        if (isMounted) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error(err);
          if (isRateLimitError(err)) {
            setError("API rate limit exceeded. Please wait a moment and try again.");
          } else {
            setError("Failed to fetch accurate data. Please try again.");
          }
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  };

  useEffect(() => {
    const cleanup = loadData();
    return cleanup;
  }, [keyword, location, latLng]);

  const handleMapClick = useCallback((countryName: string) => {
    if (onLocationChange) {
      const code = COUNTRY_NAME_MAP[countryName];
      if (code) {
        onLocationChange(code);
      } else {
        console.warn(`Country ${countryName} not found in LOCATIONS map.`);
      }
    }
  }, [onLocationChange]);

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-6">
        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-red-400" />
        </div>
        <div className="text-center">
          <h3 className="text-xl font-bold text-white mb-2">Analysis Failed</h3>
          <p className="text-slate-400 max-w-md">{error}</p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-colors shadow-lg shadow-blue-500/20"
        >
          <RefreshCw className="w-4 h-4" />
          Retry Analysis
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-4">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
        >
          <Loader2 className="w-12 h-12 text-blue-500" />
        </motion.div>
        <p className="text-blue-400 font-medium animate-pulse">
          Analyzing real-time data for "{keyword}"
          {location ? ` in ${location}` : ""}...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20 relative">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <h2 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-3">
          Overview for{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 dark:from-blue-400 dark:to-indigo-400 light:from-blue-600 light:to-indigo-600">
            "{keyword}"
          </span>
        </h2>
        <p className="text-slate-500 dark:text-slate-400 light:text-slate-500">
          Real-time search volume, difficulty, and trends
          {location ? ` in ${location}` : ""}.
        </p>
      </motion.div>

      <MetricsCards data={data} loading={loading} />

      <Suspense fallback={<ComponentLoader />}>
        {/* AI Analysis Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="bg-card/50 backdrop-blur-xl border border-border rounded-3xl p-6 lg:p-8 relative overflow-hidden group shadow-sm"
        >
          {loading && (
            <div className="absolute inset-0 z-50 bg-background/50 backdrop-blur-sm flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

          <div className="flex items-center gap-3 mb-2 relative z-10">
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <Lightbulb className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-foreground">
              AI Landscape Analysis
            </h3>
          </div>
          <p className="text-slate-500 text-xs mb-6 relative z-10">Deep dive into keyword opportunities, threats, and market summary generated by AI.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10">
            <div className="md:col-span-1 space-y-4">
              <h4 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Summary
              </h4>
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-sm">
                {data.analysis.summary}
              </p>
            </div>

            <div className="md:col-span-1 space-y-4">
              <h4 className="text-sm font-semibold text-emerald-500 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Opportunities
              </h4>
              <ul className="space-y-3">
                {data.analysis.opportunities.map((opp, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0" />
                    <span>{opp}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="md:col-span-1 space-y-4">
              <h4 className="text-sm font-semibold text-orange-500 dark:text-orange-400 uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Threats & Challenges
              </h4>
              <ul className="space-y-3">
                {data.analysis.threats.map((threat, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 flex-shrink-0" />
                    <span>{threat}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <TrendChart data={data.trends} loading={loading} />

            <WorldMap
              currentLocation={location}
              onLocationSelect={handleMapClick}
              loading={loading}
              regionalInterest={data.regionalInterest}
            />

            {/* SERP Features & Top Pages */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.7 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-8"
            >
              {/* SERP Features */}
              <motion.div
                whileHover={{ y: -5 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                className="bg-card/50 backdrop-blur-xl border border-border rounded-3xl p-6 hover:border-purple-500/30 transition-colors group relative overflow-hidden shadow-sm"
              >
                {loading && (
                  <div className="absolute inset-0 z-50 bg-background/50 backdrop-blur-sm flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                  </div>
                )}
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400 group-hover:scale-110 transition-transform duration-300">
                    <LayoutTemplate className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-foreground">SERP Features</h3>
                </div>
                <p className="text-slate-500 text-xs mb-6">Special elements appearing on the Search Engine Results Page.</p>
                <div className="flex flex-wrap gap-2">
                  {data.serpFeatures.map((feature, i) => (
                    <motion.span
                      key={i}
                      whileHover={{ scale: 1.05 }}
                      className="px-3 py-1.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2 hover:bg-purple-500/10 hover:text-purple-600 dark:hover:text-purple-300 hover:border-purple-500/30 transition-colors cursor-default"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 group-hover:text-purple-500 dark:group-hover:text-purple-400 transition-colors" />
                      {feature}
                    </motion.span>
                  ))}
                </div>
              </motion.div>

              {/* Top Pages */}
              <motion.div
                whileHover={{ y: -5 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                className="bg-card/50 backdrop-blur-xl border border-border rounded-3xl p-6 hover:border-emerald-500/30 transition-colors group relative overflow-hidden shadow-sm"
              >
                {loading && (
                  <div className="absolute inset-0 z-50 bg-background/50 backdrop-blur-sm flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                  </div>
                )}
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400 group-hover:scale-110 transition-transform duration-300">
                    <LinkIcon className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-foreground">
                    Top Ranking Pages
                  </h3>
                </div>
                <p className="text-slate-500 text-xs mb-6">The highest performing organic results currently ranking for this term.</p>
                <div className="space-y-4">
                  {data.topPages.map((page, i) => (
                    <motion.div
                      key={i}
                      whileHover={{ x: 5 }}
                      className="group/item"
                    >
                      <a
                        href={page.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.02] border border-transparent hover:border-border transition-all"
                      >
                        <h4 className="text-sm font-medium text-blue-600 dark:text-blue-400 group-hover/item:text-blue-500 dark:group-hover/item:text-blue-300 transition-colors line-clamp-1 mb-1">
                          {page.title}
                        </h4>
                        <p className="text-xs text-slate-500 truncate mb-2">
                          {page.url}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                          <span title="Estimated Monthly Traffic">
                            Traffic:{" "}
                            <strong className="text-slate-700 dark:text-slate-300">
                              {page.traffic.toLocaleString()}
                            </strong>
                          </span>
                          <span title="Backlinks">
                            Links:{" "}
                            <strong className="text-slate-700 dark:text-slate-300">
                              {page.backlinks.toLocaleString()}
                            </strong>
                          </span>
                          <span
                            title="Estimated Word Count"
                            className="flex items-center gap-1"
                          >
                            <FileText className="w-3 h-3" />{" "}
                            <strong className="text-slate-700 dark:text-slate-300">
                              {page.wordCount.toLocaleString()}
                            </strong>
                          </span>
                        </div>
                      </a>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          </div>

          <div className="lg:col-span-1">
            <CompetitorsList data={data.competitors} loading={loading} />
          </div>
        </div>

        <LocalMapResults keyword={keyword} location={location} latLng={latLng} />

        <KeywordTable data={data.relatedKeywords} loading={loading} />
      </Suspense>
    </div>
  );
}
