import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Loader2, Link as LinkIcon, ExternalLink, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { generateWithRetry } from '../services/geminiClient';
import { Type } from '@google/genai';

interface BacklinkAnalyticsProps {
 keyword: string;
}

interface BacklinkData {
 sourceUrl: string;
 targetUrl: string;
 anchorText: string;
 domainAuthority: number;
 isDofollow: boolean;
 firstSeen: string;
}

export default function BacklinkAnalytics({ keyword }: BacklinkAnalyticsProps) {
 const [data, setData] = useState<BacklinkData[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 const fetchData = async () => {
 setLoading(true);
 try {
 const prompt = `Act as an expert SEO tool like Ahrefs. Provide realistic, highly accurate estimated backlink profile data for a top-ranking page for the keyword"${keyword}". Return an array of 10 objects, each containing: 'sourceUrl' (string, the URL linking to the page), 'targetUrl' (string, the page being linked to, e.g., '/blog/guide-to-topic'), 'anchorText' (string, the clickable text), 'domainAuthority' (number, 0-100), 'isDofollow' (boolean), and 'firstSeen' (string, date like '2023-10-15'). Make the data look like a real SEO campaign tracking dashboard.`;
 
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
 sourceUrl: { type: Type.STRING },
 targetUrl: { type: Type.STRING },
 anchorText: { type: Type.STRING },
 domainAuthority: { type: Type.NUMBER },
 isDofollow: { type: Type.BOOLEAN },
 firstSeen: { type: Type.STRING },
 },
 required: ["sourceUrl","targetUrl","anchorText","domainAuthority","isDofollow","firstSeen"]
 }
 }
 }
 });

 if (response.text) {
 setData(JSON.parse(response.text));
 }
 } catch (error) {
 console.error("Error fetching backlink data:", error);
 } finally {
 setLoading(false);
 }
 };

 if (keyword) {
 fetchData();
 }
 }, [keyword]);

 if (loading) {
 return (
 <div className="w-full h-64 flex items-center justify-center bg-card/30 backdrop-blur-sm border border-border rounded-3xl">
 <Loader2 className="w-8 h-8 text-accent animate-spin"/>
 </div>
 );
 }

 const totalBacklinks = data.length * 125; // Mock total
 const referringDomains = Math.floor(totalBacklinks * 0.3); // Mock referring domains
 const dofollowPercentage = Math.round((data.filter(d => d.isDofollow).length / data.length) * 100);

 return (
 <div className="space-y-6">
 <motion.div
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.5 }}
 >
 <h2 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-3">
 Backlink Analytics for{""}
 <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-purple-500 drop-shadow-sm">
"{keyword}"
 </span>
 </h2>
 <p className="text-muted-foreground text-sm">
 Analyze the link profile of top-ranking pages.
 </p>
 </motion.div>

 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 <div className="bg-card border border-border rounded-3xl p-6 shadow-lg hover:shadow-accent/10 hover:border-accent/30 transition-all group">
 <div className="flex items-center gap-3 mb-2">
 <div className="p-2 bg-accent/10 rounded-lg text-accent group-hover:scale-110 transition-transform shadow-sm">
 <LinkIcon className="w-5 h-5"/>
 </div>
 <h3 className="text-lg font-bold text-foreground">Total Backlinks</h3>
 </div>
 <p className="text-4xl font-bold text-foreground drop-shadow-sm">{totalBacklinks.toLocaleString()}</p>
 <p className="text-xs text-muted-foreground mt-1">Estimated total links</p>
 </div>
 <div className="bg-card border border-border rounded-3xl p-6 shadow-lg hover:shadow-purple-500/10 hover:border-purple-500/30 transition-all group">
 <div className="flex items-center gap-3 mb-2">
 <div className="p-2 bg-purple-500/10 rounded-lg text-purple-500 group-hover:scale-110 transition-transform shadow-sm">
 <ExternalLink className="w-5 h-5"/>
 </div>
 <h3 className="text-lg font-bold text-foreground">Referring Domains</h3>
 </div>
 <p className="text-4xl font-bold text-foreground drop-shadow-sm">{referringDomains.toLocaleString()}</p>
 <p className="text-xs text-muted-foreground mt-1">Unique linking domains</p>
 </div>
 <div className="bg-card border border-border rounded-3xl p-6 shadow-lg hover:shadow-emerald-500/10 hover:border-emerald-500/30 transition-all group">
 <div className="flex items-center gap-3 mb-2">
 <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500 group-hover:scale-110 transition-transform shadow-sm">
 <CheckCircle2 className="w-5 h-5"/>
 </div>
 <h3 className="text-lg font-bold text-foreground">Dofollow Links</h3>
 </div>
 <p className="text-4xl font-bold text-foreground drop-shadow-sm">{dofollowPercentage}%</p>
 <p className="text-xs text-muted-foreground mt-1">Percentage of dofollow links</p>
 </div>
 </div>

 <div className="bg-card border border-border rounded-3xl overflow-hidden shadow-lg">
 <div className="p-6 border-b border-border flex items-center justify-between bg-muted/10">
 <h3 className="text-xl font-bold text-foreground">Recent Backlinks</h3>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full text-left border-collapse">
 <thead>
 <tr className="border-b border-border text-xs text-muted-foreground bg-muted/30 font-bold">
 <th className="p-4">Source URL</th>
 <th className="p-4">Anchor Text</th>
 <th className="p-4 text-right">DA</th>
 <th className="p-4 text-center">Type</th>
 <th className="p-4 text-right">First Seen</th>
 </tr>
 </thead>
 <tbody>
 {data.map((row, index) => (
 <motion.tr
 key={index}
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: index * 0.05 }}
 className="border-b border-border hover:bg-muted/50 transition-colors group"
 >
 <td className="p-4 text-foreground font-bold group-hover:text-accent transition-colors truncate max-w-[250px]">
 <a href={row.sourceUrl} target="_blank"rel="noopener noreferrer"className="hover:underline flex items-center gap-2">
 {row.sourceUrl}
 <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity"/>
 </a>
 </td>
 <td className="p-4 text-xs text-muted-foreground truncate max-w-[200px]">
"{row.anchorText}"
 </td>
 <td className="p-4 text-right text-muted-foreground">
 <div className="flex items-center justify-end gap-2">
 <div className="w-12 bg-muted rounded-full h-1.5 overflow-hidden shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]">
 <div 
 className={`h-full rounded-full shadow-sm ${row.domainAuthority > 70 ? 'bg-emerald-500 shadow-[#00FF00]/50' : row.domainAuthority > 40 ? 'bg-amber-500 shadow-amber-500/50' : 'bg-red-500 shadow-red-500/50'}`}
 style={{ width: `${row.domainAuthority}%` }}
 />
 </div>
 <span className="w-6 font-bold">{row.domainAuthority}</span>
 </div>
 </td>
 <td className="p-4 text-center">
 {row.isDofollow ? (
 <span className="inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
 Dofollow
 </span>
 ) : (
 <span className="inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold bg-slate-500/10 text-slate-500 border border-slate-500/20">
 Nofollow
 </span>
 )}
 </td>
 <td className="p-4 text-right text-xs text-muted-foreground font-bold">
 {row.firstSeen}
 </td>
 </motion.tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 );
}
