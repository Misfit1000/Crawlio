import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Target, Plus, Loader2, Trash2, X, Globe } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getCompetitors, addCompetitor, deleteCompetitor, Competitor } from '../services/firestoreService';

export default function TrackedCompetitors() {
 const { user } = useAuth();
 const [competitors, setCompetitors] = useState<Competitor[]>([]);
 const [loading, setLoading] = useState(true);
 const [isModalOpen, setIsModalOpen] = useState(false);
 const [isSubmitting, setIsSubmitting] = useState(false);
 
 const [domainUrl, setDomainUrl] = useState('');
 const [niche, setNiche] = useState('');
 const [error, setError] = useState<string | null>(null);

 useEffect(() => {
 if (user) {
 loadData();
 }
 }, [user]);

 const loadData = async () => {
 try {
 if (!user) return;
 const data = await getCompetitors(user.id);
 setCompetitors(data);
 } catch (error) {
 console.error("Failed to load competitors", error);
 } finally {
 setLoading(false);
 }
 };

 const handleAddCompetitor = async (e: React.FormEvent) => {
 e.preventDefault();
 setError(null);
 if (!user || !domainUrl.trim()) return;

 // Basic URL validation
 let formattedUrl = domainUrl.trim().toLowerCase();
 if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
 formattedUrl = 'https://' + formattedUrl;
 }

 try {
 new URL(formattedUrl);
 } catch (_) {
 setError("Please enter a valid domain URL");
 return;
 }

 setIsSubmitting(true);
 try {
 const compData: any = {
 domainUrl: formattedUrl
 };
 
 if (niche.trim()) {
 compData.niche = niche.trim();
 }

 const newCompetitor = await addCompetitor(user.id, compData);
 setCompetitors([newCompetitor, ...competitors]);
 setIsModalOpen(false);
 setDomainUrl('');
 setNiche('');
 } catch (error) {
 console.error("Failed to add competitor", error);
 setError("Failed to add competitor");
 } finally {
 setIsSubmitting(false);
 }
 };

 const handleDelete = async (id: string) => {
 if (!user) return;
 try {
 await deleteCompetitor(user.id, id);
 setCompetitors(competitors.filter(c => c.id !== id));
 } catch (error) {
 console.error("Failed to delete competitor", error);
 }
 };

 return (
 <div className="space-y-6">
 <div className="flex items-center justify-between">
 <h3 className="text-2xl font-bold text-foreground flex items-center gap-2">
 <Target className="w-6 h-6 text-accent"/>
 Tracked Competitors
 </h3>
 <button
 onClick={() => setIsModalOpen(true)}
 className="flex items-center gap-2 px-4 py-2 bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 shadow-sm rounded-xl text-sm font-bold transition-colors"
 >
 <Plus className="w-4 h-4"/>
 Add Competitor
 </button>
 </div>

 {loading ? (
 <div className="flex justify-center py-8">
 <Loader2 className="w-8 h-8 text-accent animate-spin"/>
 </div>
 ) : competitors.length === 0 ? (
 <div className="bg-card/30 border border-border border-dashed rounded-2xl p-8 text-center">
 <Target className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-50"/>
 <p className="text-muted-foreground">No competitors tracked yet. Keep an eye on your rivals.</p>
 </div>
 ) : (
 <div className="bg-card border border-border rounded-3xl overflow-hidden shadow-lg">
 <div className="overflow-x-auto">
 <table className="w-full text-sm text-left">
 <thead className="text-xs text-muted-foreground font-bold bg-muted/20 border-b border-border">
 <tr>
 <th className="px-6 py-4">Domain</th>
 <th className="px-6 py-4">Niche</th>
 <th className="px-6 py-4">Added</th>
 <th className="px-6 py-4 text-right">Actions</th>
 </tr>
 </thead>
 <tbody>
 <AnimatePresence>
 {competitors.map((comp) => (
 <motion.tr
 key={comp.id}
 initial={{ opacity: 0, y: -10 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -10 }}
 className="border-b border-border/50 hover:bg-muted/30 transition-colors group"
 >
 <td className="px-6 py-4 font-bold text-foreground flex items-center gap-2">
 <Globe className="w-4 h-4 text-accent"/>
 <a href={comp.domainUrl} target="_blank"rel="noopener noreferrer"className="hover:text-accent transition-colors">
 {comp.domainUrl.replace(/^https?:\/\//, '')}
 </a>
 </td>
 <td className="px-6 py-4 text-muted-foreground">
 {comp.niche ? (
 <span className="inline-flex items-center px-2 py-1 rounded-md bg-accent/10 text-accent text-[10px] font-bold border border-accent/20">
 {comp.niche}
 </span>
 ) : (
 <span className="text-muted-foreground/50">-</span>
 )}
 </td>
 <td className="px-6 py-4 text-muted-foreground font-bold">
 {new Date(comp.createdAt?.seconds ? comp.createdAt.seconds * 1000 : comp.createdAt).toLocaleDateString()}
 </td>
 <td className="px-6 py-4 text-right">
 <button
 onClick={() => handleDelete(comp.id)}
 className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-md opacity-0 group-hover:opacity-100 transition-all"
 >
 <Trash2 className="w-4 h-4"/>
 </button>
 </td>
 </motion.tr>
 ))}
 </AnimatePresence>
 </tbody>
 </table>
 </div>
 </div>
 )}

 {/* Modal */}
 <AnimatePresence>
 {isModalOpen && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
 <motion.div
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: 20 }}
 className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl"
 >
 <div className="flex items-center justify-between mb-4">
 <h3 className="text-2xl font-bold text-foreground">Add Competitor</h3>
 <button onClick={() => setIsModalOpen(false)} className="text-muted-foreground hover:text-foreground">
 <X className="w-5 h-5"/>
 </button>
 </div>
 {error && (
 <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm font-bold">
 {error}
 </div>
 )}
 <form onSubmit={handleAddCompetitor} className="space-y-4">
 <div>
 <label className="block text-sm font-bold text-muted-foreground mb-1">Domain URL</label>
 <input
 type="text"
 value={domainUrl}
 onChange={(e) => setDomainUrl(e.target.value)}
 className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
 placeholder="e.g., ahrefs.com"
 required
 autoFocus
 />
 </div>
 <div>
 <label className="block text-sm font-bold text-muted-foreground mb-1">Niche (Optional)</label>
 <input
 type="text"
 value={niche}
 onChange={(e) => setNiche(e.target.value)}
 className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
 placeholder="e.g., SEO Tools"
 />
 </div>
 <div className="flex justify-end gap-3 pt-2">
 <button
 type="button"
 onClick={() => setIsModalOpen(false)}
 className="px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
 >
 Cancel
 </button>
 <button
 type="submit"
 disabled={isSubmitting || !domainUrl.trim()}
 className="flex items-center gap-2 px-6 py-2 bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50 rounded-xl text-sm font-bold transition-all shadow-lg shadow-accent/20"
 >
 {isSubmitting && <Loader2 className="w-4 h-4 animate-spin"/>}
 Track Competitor
 </button>
 </div>
 </form>
 </motion.div>
 </div>
 )}
 </AnimatePresence>
 </div>
 );
}
