import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchKeywordData, KeywordData } from '../services/keywordService';
import KeywordTable from './KeywordTable';

interface KeywordMagicToolProps {
 keyword: string;
 location?: string;
 latLng?: { latitude: number; longitude: number } | null;
}

export default function KeywordMagicTool({ keyword, location, latLng }: KeywordMagicToolProps) {
 const [data, setData] = useState<KeywordData | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);

 useEffect(() => {
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
 setError(err.message ||"Failed to fetch accurate data. Please try again.");
 setLoading(false);
 }
 });

 return () => {
 isMounted = false;
 };
 }, [keyword, location, latLng]);

 if (loading) {
 return (
 <div className="w-full h-64 flex items-center justify-center bg-card/30 backdrop-blur-sm border border-border rounded-3xl">
 <Loader2 className="w-8 h-8 text-accent animate-spin"/>
 </div>
 );
 }

 if (error) {
 return (
 <div className="w-full p-6 bg-red-500/10 border border-red-500/20 rounded-3xl text-red-500 text-center font-bold">
 {error}
 </div>
 );
 }

 if (!data) return null;

 return (
 <div className="space-y-6">
 <h2 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-3">
 Keyword Magic Tool for{""}
 <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-purple-500 drop-shadow-sm">
"{keyword}"
 </span>
 </h2>
 <KeywordTable data={data.relatedKeywords} loading={loading} />
 </div>
 );
}
