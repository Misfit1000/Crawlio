import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Loader2, TrendingUp, TrendingDown, Minus, Search } from 'lucide-react';
import { generateWithRetry } from '../services/geminiClient';
import { Type } from '@google/genai';

interface PositionTrackingProps {
 keyword: string;
 location?: string;
}

interface PositionData {
 keyword: string;
 position: number;
 previousPosition: number;
 volume: number;
 url: string;
}

export default function PositionTracking({ keyword, location }: PositionTrackingProps) {
 const [data, setData] = useState<PositionData[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 const fetchData = async () => {
 setLoading(true);
 try {
 const prompt = `Act as an expert SEO tool. Provide realistic, highly accurate estimated position tracking data for a website ranking for the keyword"${keyword}"and related terms${location ? ` in ${location}` : ''}. Return an array of 10 objects, each containing: 'keyword' (string, the search term), 'position' (number, current ranking position 1-100), 'previousPosition' (number, previous ranking position 1-100), 'volume' (number, monthly search volume), and 'url' (string, a realistic URL path like '/blog/guide-to-topic'). Make the data look like a real SEO campaign tracking dashboard.`;
 
 const response = await generateWithRetry({
 model:"gemini-3-flash-preview",
 contents: prompt,
 config: {
 responseMimeType:"application/json",
 responseSchema: {
 type: Type.ARRAY,
 items: {
 type: Type.OBJECT,
 properties: {
 keyword: { type: Type.STRING },
 position: { type: Type.NUMBER },
 previousPosition: { type: Type.NUMBER },
 volume: { type: Type.NUMBER },
 url: { type: Type.STRING },
 },
 required: ["keyword","position","previousPosition","volume","url"]
 }
 }
 }
 });

 if (response.text) {
 setData(JSON.parse(response.text));
 }
 } catch (error) {
 console.error("Error fetching position data:", error);
 } finally {
 setLoading(false);
 }
 };

 if (keyword) {
 fetchData();
 }
 }, [keyword, location]);

 if (loading) {
 return (
 <div className="w-full h-64 flex items-center justify-center bg-card/30 backdrop-blur-sm border border-border rounded-3xl">
 <Loader2 className="w-8 h-8 text-accent animate-spin"/>
 </div>
 );
 }

 const improved = data.filter(d => d.position < d.previousPosition).length;
 const declined = data.filter(d => d.position > d.previousPosition).length;
 const unchanged = data.filter(d => d.position === d.previousPosition).length;

 return (
 <div className="space-y-6">
 <motion.div
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.5 }}
 >
 <h2 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-3">
 Position Tracking for{""}
 <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-purple-500 drop-shadow-sm">
"{keyword}"
 </span>
 </h2>
 <p className="text-muted-foreground text-sm">
 Monitor your daily rankings and visibility{location ? ` in ${location}` :""}.
 </p>
 </motion.div>

 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 <div className="bg-card border border-border rounded-3xl p-6 shadow-lg hover:shadow-accent/10 hover:border-accent/30 transition-all group">
 <div className="flex items-center gap-3 mb-2">
 <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500 group-hover:scale-110 transition-transform shadow-sm">
 <TrendingUp className="w-5 h-5"/>
 </div>
 <h3 className="text-lg font-bold text-foreground">Improved</h3>
 </div>
 <p className="text-4xl font-bold text-foreground drop-shadow-sm">{improved}</p>
 <p className="text-xs text-muted-foreground mt-1">Keywords moved up</p>
 </div>
 <div className="bg-card border border-border rounded-3xl p-6 shadow-lg hover:shadow-orange-500/10 hover:border-orange-500/30 transition-all group">
 <div className="flex items-center gap-3 mb-2">
 <div className="p-2 bg-orange-500/10 rounded-lg text-orange-500 group-hover:scale-110 transition-transform shadow-sm">
 <TrendingDown className="w-5 h-5"/>
 </div>
 <h3 className="text-lg font-bold text-foreground">Declined</h3>
 </div>
 <p className="text-4xl font-bold text-foreground drop-shadow-sm">{declined}</p>
 <p className="text-xs text-muted-foreground mt-1">Keywords moved down</p>
 </div>
 <div className="bg-card border border-border rounded-3xl p-6 shadow-lg hover:shadow-slate-500/10 hover:border-slate-500/30 transition-all group">
 <div className="flex items-center gap-3 mb-2">
 <div className="p-2 bg-slate-500/10 rounded-lg text-slate-500 group-hover:scale-110 transition-transform shadow-sm">
 <Minus className="w-5 h-5"/>
 </div>
 <h3 className="text-lg font-bold text-foreground">Unchanged</h3>
 </div>
 <p className="text-4xl font-bold text-foreground drop-shadow-sm">{unchanged}</p>
 <p className="text-xs text-muted-foreground mt-1">Keywords maintained position</p>
 </div>
 </div>

 <div className="bg-card border border-border rounded-3xl overflow-hidden shadow-lg">
 <div className="p-6 border-b border-border flex items-center justify-between bg-muted/10">
 <h3 className="text-xl font-bold text-foreground">Rankings Overview</h3>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full text-left border-collapse">
 <thead>
 <tr className="border-b border-border text-xs text-muted-foreground bg-muted/30 font-bold">
 <th className="p-4">Keyword</th>
 <th className="p-4">URL</th>
 <th className="p-4 text-right">Volume</th>
 <th className="p-4 text-right">Position</th>
 <th className="p-4 text-right">Diff</th>
 </tr>
 </thead>
 <tbody>
 {data.map((row, index) => {
 const diff = row.previousPosition - row.position;
 return (
 <motion.tr
 key={index}
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: index * 0.05 }}
 className="border-b border-border hover:bg-muted/50 transition-colors group"
 >
 <td className="p-4 text-foreground font-bold group-hover:text-accent transition-colors">
 {row.keyword}
 </td>
 <td className="p-4 text-xs text-muted-foreground truncate max-w-[200px]">
 {row.url}
 </td>
 <td className="p-4 text-right text-muted-foreground font-bold">
 {row.volume.toLocaleString()}
 </td>
 <td className="p-4 text-right font-bold text-foreground">
 {row.position}
 </td>
 <td className="p-4 text-right">
 {diff > 0 ? (
 <span className="inline-flex items-center gap-1 text-emerald-500 text-xs font-bold bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">
 <TrendingUp className="w-3 h-3"/> +{diff}
 </span>
 ) : diff < 0 ? (
 <span className="inline-flex items-center gap-1 text-orange-500 text-xs font-bold bg-orange-500/10 px-2 py-1 rounded-md border border-orange-500/20">
 <TrendingDown className="w-3 h-3"/> {diff}
 </span>
 ) : (
 <span className="inline-flex items-center gap-1 text-slate-500 text-xs font-bold bg-slate-500/10 px-2 py-1 rounded-md border border-slate-500/20">
 <Minus className="w-3 h-3"/> 0
 </span>
 )}
 </td>
 </motion.tr>
 );
 })}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 );
}
