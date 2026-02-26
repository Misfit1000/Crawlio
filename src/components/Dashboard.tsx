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
  Info,
  CheckCircle2,
  Search,
  Image as ImageIcon,
  Video,
  MapPin,
  ShoppingBag,
  Newspaper,
  HelpCircle,
} from "lucide-react";
import MetricsCards from "./MetricsCards";
import { isRateLimitError } from "../services/geminiClient";
import { fetchKeywordData, KeywordData } from "../services/keywordService";
import KeywordProjects from "./KeywordProjects";
import SavedKeywords from "./SavedKeywords";
import TrackedCompetitors from "./TrackedCompetitors";

// Lazy load heavy components
const TrendChart = lazy(() => import("./TrendChart"));
const KeywordTable = lazy(() => import("./KeywordTable"));
const CompetitorsList = lazy(() => import("./CompetitorsList"));
const LocalMapResults = lazy(() => import("./LocalMapResults"));
const WorldMap = lazy(() => import("./WorldMap"));
const SerpAnalysisTable = lazy(() => import("./SerpAnalysisTable"));
const KeywordStrategyBuilder = lazy(() => import("./KeywordStrategyBuilder"));

const ComponentLoader = () => (
  <div className="w-full h-64 flex items-center justify-center bg-card/30 backdrop-blur-sm border border-border rounded-3xl">
    <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
  </div>
);

const getSerpFeatureIcon = (feature: string) => {
  const f = feature.toLowerCase();
  if (f.includes("snippet")) return <LayoutTemplate className="w-4 h-4" />;
  if (f.includes("people also ask") || f.includes("question")) return <HelpCircle className="w-4 h-4" />;
  if (f.includes("video")) return <Video className="w-4 h-4" />;
  if (f.includes("local") || f.includes("map")) return <MapPin className="w-4 h-4" />;
  if (f.includes("image")) return <ImageIcon className="w-4 h-4" />;
  if (f.includes("shop") || f.includes("product")) return <ShoppingBag className="w-4 h-4" />;
  if (f.includes("news") || f.includes("top stories")) return <Newspaper className="w-4 h-4" />;
  if (f.includes("link")) return <LinkIcon className="w-4 h-4" />;
  if (f.includes("knowledge")) return <Info className="w-4 h-4" />;
  return <Eye className="w-4 h-4" />;
};

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
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-indigo-400">
            "{keyword}"
          </span>
        </h2>
        <p className="text-muted-foreground">
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
          <p className="text-muted-foreground text-xs mb-6 relative z-10">Deep dive into keyword opportunities, threats, and market summary generated by AI.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10">
            <div className="md:col-span-1 space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Summary
              </h4>
              <p className="text-foreground leading-relaxed text-sm">
                {data.analysis.summary}
              </p>
            </div>

            <div className="md:col-span-1 space-y-4">
              <h4 className="text-sm font-semibold text-emerald-500 uppercase tracking-wider flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Opportunities
              </h4>
              <ul className="space-y-3">
                {data.analysis.opportunities.map((opp, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-foreground"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0" />
                    <span>{opp}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="md:col-span-1 space-y-4">
              <h4 className="text-sm font-semibold text-orange-500 uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Threats & Challenges
              </h4>
              <ul className="space-y-3">
                {data.analysis.threats.map((threat, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-foreground"
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

            {/* SERP Features */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.7 }}
            >
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
                <p className="text-muted-foreground text-xs mb-6">Special elements appearing on the Search Engine Results Page.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {data.serpFeatures.map((feature, i) => (
                    <motion.div
                      key={i}
                      whileHover={{ scale: 1.02, x: 4 }}
                      className="p-3 bg-muted/50 border border-border rounded-xl text-sm text-foreground flex items-center gap-3 hover:bg-purple-500/10 hover:text-purple-600 hover:border-purple-500/30 transition-all cursor-default group/feature"
                    >
                      <div className="p-1.5 bg-card rounded-lg text-muted-foreground group-hover/feature:text-purple-500 shadow-sm transition-colors">
                        {getSerpFeatureIcon(feature)}
                      </div>
                      <span className="font-medium">{feature}</span>
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

        <SerpAnalysisTable data={data.topPages} loading={loading} />

        <KeywordStrategyBuilder data={data.relatedKeywords} />

        <LocalMapResults keyword={keyword} location={location} latLng={latLng} />

        <KeywordTable data={data.relatedKeywords} loading={loading} />
      </Suspense>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-12">
        <KeywordProjects />
        <SavedKeywords />
      </div>
      
      <div className="mt-8">
        <TrackedCompetitors />
      </div>
    </div>
  );
}
