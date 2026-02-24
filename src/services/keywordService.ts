import { Type } from "@google/genai";
import { generateWithRetry } from "./geminiClient";

export interface KeywordData {
  volume: number;
  kd: number;
  cpc: number;
  intent: "Info" | "Nav" | "Com" | "Tx";
  intentBreakdown: {
    info: number;
    nav: number;
    com: number;
    tx: number;
  };
  trends: {
    '1h': { time: string; volume: number }[];
    '24h': { time: string; volume: number }[];
    '7d': { time: string; volume: number }[];
    '30d': { time: string; volume: number }[];
    '1y': { time: string; volume: number }[];
    '5y': { time: string; volume: number }[];
  };
  relatedKeywords: {
    id: string;
    keyword: string;
    volume: number;
    kd: number;
    cpc: number;
    intent: "Info" | "Nav" | "Com" | "Tx";
    trend: number[];
  }[];
  competitors: {
    domain: string;
    traffic: number;
    overlap: number;
    topKeywords: string[];
    domainAuthority: number;
  }[];
  serpFeatures: string[];
  topPages: {
    title: string;
    url: string;
    traffic: number;
    backlinks: number;
    wordCount: number;
  }[];
  analysis: {
    summary: string;
    opportunities: string[];
    threats: string[];
  };
  regionalInterest: {
    country: string;
    volume: number;
    percentage: number;
  }[];
}

const cache = new Map<string, { data: KeywordData; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

export async function fetchKeywordData(
  keyword: string,
  location?: string,
  latLng?: { latitude: number; longitude: number } | null,
): Promise<KeywordData> {
  const cacheKey = `${keyword.toLowerCase()}_${(location || 'global').toLowerCase()}_${latLng ? `${latLng.latitude}_${latLng.longitude}` : ''}`;
  
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  let locationContext = "";
  if (location === "Current Location" && latLng) {
    locationContext = ` Specifically tailor the data, search volume, CPC, and related keywords for the user's current location at coordinates: Latitude ${latLng.latitude}, Longitude ${latLng.longitude}.`;
  } else if (location && location !== "Current Location") {
    locationContext = ` Specifically tailor the data, search volume, CPC, and related keywords for the location: ${location}.`;
  }
  const prompt = `Act as an expert SEO tool like SEMrush. Provide highly accurate, realistic estimated SEO metrics for the keyword "${keyword}".${locationContext} Include total monthly search volume, keyword difficulty (0-100), average CPC in USD, primary search intent, a breakdown of search intent percentages (must sum to 100), trend data for multiple timeframes (1 hour, 24 hours, 7 days, 30 days, 1 year, 5 years) where each timeframe is an array of objects with 'time' and 'volume' properties, a list of AT LEAST 50 highly relevant related keywords with their metrics (including a 12-month trend array of numbers), a list of top 5 competitor domains ranking for this keyword with their estimated monthly traffic, keyword overlap percentage, top 3 keywords they rank for, and estimated domain authority (0-100), a list of SERP features present (e.g., 'Featured Snippet', 'People Also Ask', 'Video', 'Local Pack'), a list of the top 3 ranking pages with their title, URL, estimated traffic, backlinks, and estimated word count, an in-depth analysis object containing a brief summary of the keyword landscape, a list of 2-3 SEO opportunities, and a list of 1-2 potential threats or challenges, and finally, a regional interest breakdown showing the top 10 countries with the highest search volume for this keyword, including the country name, estimated volume, and percentage of total global volume.`;

  const response = await generateWithRetry({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          volume: {
            type: Type.NUMBER,
            description: "Estimated monthly search volume",
          },
          kd: { type: Type.NUMBER, description: "Keyword difficulty (0-100)" },
          cpc: {
            type: Type.NUMBER,
            description: "Estimated Cost Per Click in USD",
          },
          intent: {
            type: Type.STRING,
            description: "Search intent: 'Info', 'Nav', 'Com', or 'Tx'",
          },
          intentBreakdown: {
            type: Type.OBJECT,
            properties: {
              info: { type: Type.NUMBER },
              nav: { type: Type.NUMBER },
              com: { type: Type.NUMBER },
              tx: { type: Type.NUMBER },
            },
            required: ["info", "nav", "com", "tx"],
          },
          trends: {
            type: Type.OBJECT,
            properties: {
              '1h': { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.STRING }, volume: { type: Type.NUMBER } }, required: ["time", "volume"] } },
              '24h': { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.STRING }, volume: { type: Type.NUMBER } }, required: ["time", "volume"] } },
              '7d': { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.STRING }, volume: { type: Type.NUMBER } }, required: ["time", "volume"] } },
              '30d': { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.STRING }, volume: { type: Type.NUMBER } }, required: ["time", "volume"] } },
              '1y': { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.STRING }, volume: { type: Type.NUMBER } }, required: ["time", "volume"] } },
              '5y': { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.STRING }, volume: { type: Type.NUMBER } }, required: ["time", "volume"] } }
            },
            required: ["1h", "24h", "7d", "30d", "1y", "5y"],
            description: "Trend data for various timeframes",
          },
          relatedKeywords: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                keyword: { type: Type.STRING },
                volume: { type: Type.NUMBER },
                kd: { type: Type.NUMBER },
                cpc: { type: Type.NUMBER },
                intent: {
                  type: Type.STRING,
                  description: "'Info', 'Nav', 'Com', or 'Tx'",
                },
                trend: {
                  type: Type.ARRAY,
                  items: { type: Type.NUMBER },
                  description: "12 months of volume data",
                },
              },
              required: ["keyword", "volume", "kd", "cpc", "intent", "trend"],
            },
          },
          competitors: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                domain: { type: Type.STRING },
                traffic: { type: Type.NUMBER },
                overlap: {
                  type: Type.NUMBER,
                  description: "Percentage overlap 0-100",
                },
                topKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                domainAuthority: { type: Type.NUMBER },
              },
              required: [
                "domain",
                "traffic",
                "overlap",
                "topKeywords",
                "domainAuthority",
              ],
            },
          },
          serpFeatures: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          topPages: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                url: { type: Type.STRING },
                traffic: { type: Type.NUMBER },
                backlinks: { type: Type.NUMBER },
                wordCount: { type: Type.NUMBER },
              },
              required: ["title", "url", "traffic", "backlinks", "wordCount"],
            },
          },
          analysis: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              opportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
              threats: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["summary", "opportunities", "threats"],
          },
          regionalInterest: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                country: {
                  type: Type.STRING,
                  description: "Full country name, e.g., 'United States'",
                },
                volume: { type: Type.NUMBER },
                percentage: { type: Type.NUMBER },
              },
              required: ["country", "volume", "percentage"],
            },
          },
        },
        required: [
          "volume",
          "kd",
          "cpc",
          "intent",
          "intentBreakdown",
          "trends",
          "relatedKeywords",
          "competitors",
          "serpFeatures",
          "topPages",
          "analysis",
          "regionalInterest",
        ],
      },
    },
  });

  const jsonStr = response.text;
  if (!jsonStr) throw new Error("No data returned");
  const data = JSON.parse(jsonStr);

  // Add IDs to related keywords
  data.relatedKeywords = data.relatedKeywords.map((k: any, i: number) => ({
    ...k,
    id: String(i + 1),
  }));

  cache.set(cacheKey, { data, timestamp: Date.now() });

  return data as KeywordData;
}

const mapCache = new Map<string, { data: any[]; timestamp: number }>();

export async function fetchLocalMapData(
  keyword: string,
  location?: string,
  latLng?: { latitude: number; longitude: number } | null,
): Promise<any[]> {
  const cacheKey = `${keyword.toLowerCase()}_${(location || 'global').toLowerCase()}_${latLng ? `${latLng.latitude}_${latLng.longitude}` : ''}`;
  
  const cached = mapCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const prompt = `Find the top local businesses or places related to "${keyword}" in ${location || 'the world'}.`;
  
  const config: any = {
    tools: [{ googleMaps: {} }],
  };

  if (latLng) {
    config.toolConfig = {
      retrievalConfig: {
        latLng: {
          latitude: latLng.latitude,
          longitude: latLng.longitude
        }
      }
    };
  }

  const response = await generateWithRetry({
    model: "gemini-2.5-flash",
    contents: prompt,
    config
  });

  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  const mapResults: any[] = [];

  if (chunks) {
    chunks.forEach((chunk: any) => {
      if (chunk.maps) {
        mapResults.push({
          title: chunk.maps.title || 'Unknown Place',
          uri: chunk.maps.uri || '#',
        });
      }
    });
  }

  const uniqueResults = Array.from(new Map(mapResults.map(item => [item.uri, item])).values());
  mapCache.set(cacheKey, { data: uniqueResults, timestamp: Date.now() });

  return uniqueResults;
}
